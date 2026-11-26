#!/usr/bin/env node
/**
 * 一键把服务器专用附加包部署到 BDS：
 *   1. npm run build:server 产出 packages/addon/dist/server.mcaddon
 *   2. 装配插件/音色/曲谱并写入 BDS 目录
 *
 * 默认走本地直连：直接调用本机后端代码写文件，不经过 HTTP、不上传产物，
 * 也不需要令牌。只有部署到远端后端时才用 --url 走 HTTP 上传。
 *
 * 用法：
 *   npm run deploy:bds                     # 构建 + 本地直接部署
 *   npm run deploy:bds -- --skip-build     # 用现有 dist/server.mcaddon
 *   npm run deploy:bds -- --file <mcaddon> # 指定其他产物
 *   npm run deploy:bds -- --url http://host:35050 --token <admin 令牌>   # 远端
 * 远端模式也可用环境变量 PIANOBE_URL / PIANOBE_TOKEN；
 * 令牌缺省时读取 packages/server/.env 的 BOOTSTRAP_TOKEN。
 *
 * 部署只写文件，不会重启 BDS；重进世界或重启实例后新包才生效。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverDir = join(root, "packages/server");
const defaultTemplate = join(root, "packages/addon/dist/server.mcaddon");
const envFile = join(serverDir, ".env");

/** 极简参数解析：--key value 或 --flag */
function parseArgs(argv) {
    const options = { flags: new Set() };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;
        const [, key, inline] = arg.match(/^--([^=]+)(?:=(.*))?$/) ?? [];
        if (!key) continue;
        if (inline !== undefined) options[key] = inline;
        else if (argv[i + 1] && !argv[i + 1].startsWith("--")) options[key] = argv[++i];
        else options.flags.add(key);
    }
    return options;
}

/** 读 .env 里的单行值；找不到返回 undefined */
function envValue(key) {
    if (!existsSync(envFile)) return undefined;
    const line = readFileSync(envFile, "utf8")
        .split(/\r?\n/)
        .find((item) => item.trim().startsWith(`${key}=`));
    if (!line) return undefined;
    return line.slice(line.indexOf("=") + 1).trim() || undefined;
}

function fail(message) {
    console.error(`\x1b[31m✖ ${message}\x1b[0m`);
    process.exit(1);
}

const options = parseArgs(process.argv.slice(2));
if (options.flags.has("help") || options.flags.has("h")) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0] + "*/");
    process.exit(0);
}

const templateFile = options.file ? resolve(options.file) : defaultTemplate;
const remoteUrl = options.url ?? process.env.PIANOBE_URL;

if (options.flags.has("skip-build")) {
    console.log("\x1b[90m跳过构建，使用现有产物\x1b[0m");
} else {
    console.log("\x1b[36m▶ 构建服务器专用包（npm run build:server）\x1b[0m");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    try {
        execFileSync(npm, ["run", "build:server"], { cwd: root, stdio: "inherit" });
    } catch {
        fail("构建失败，未部署");
    }
}

if (!existsSync(templateFile)) {
    fail(`找不到构建产物：${templateFile}`);
}
const meta = statSync(templateFile);
const sizeText = `${(meta.size / 1024 / 1024).toFixed(1)} MB, ${meta.mtime.toLocaleString("zh-CN")}`;

if (!remoteUrl) {
    // 本地模式：后端和 BDS 都在本机，直接调服务代码写文件
    console.log(`\x1b[36m▶ 本地部署\x1b[0m ${templateFile.replace(`${root}/`, "")} (${sizeText})`);
    try {
        execFileSync("bun", ["src/cli/deploy.ts", "--file", templateFile], {
            cwd: serverDir,
            stdio: "inherit",
        });
    } catch {
        fail("部署失败");
    }
    process.exit(0);
}

// 远端模式：走 HTTP 上传模板 + 触发部署
const baseUrl = remoteUrl.replace(/\/+$/, "");
const token = options.token ?? process.env.PIANOBE_TOKEN ?? process.env.BOOTSTRAP_TOKEN ?? envValue("BOOTSTRAP_TOKEN");
if (!token) {
    fail("远端模式缺少管理员令牌：用 --token、PIANOBE_TOKEN 或 packages/server/.env 的 BOOTSTRAP_TOKEN 提供");
}

async function request(path, init, label) {
    let response;
    try {
        response = await fetch(`${baseUrl}${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        });
    } catch (error) {
        fail(`${label}失败：无法连接 ${baseUrl}（${error instanceof Error ? error.message : String(error)}）`);
    }
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : undefined;
    } catch {
        body = text;
    }
    if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body ? body.error : text;
        fail(`${label}失败：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
    }
    return body;
}

const bytes = readFileSync(templateFile);
console.log(`\x1b[36m▶ 上传模板\x1b[0m ${templateFile.replace(`${root}/`, "")} (${sizeText}) → ${baseUrl}`);
await request(
    "/api/addon/template",
    { method: "POST", body: bytes, headers: { "content-type": "application/octet-stream" } },
    "上传模板",
);

console.log("\x1b[36m▶ 装配并部署到 BDS\x1b[0m");
const status = await request("/api/addon/deploy", { method: "POST" }, "部署");

const issues = status?.issues ?? [];
const warnings = status?.warnings ?? [];
console.log(
    `\x1b[32m✔ 部署完成\x1b[0m status=${status?.status ?? "-"} configHash=${status?.deployedConfigHash ?? "-"} ` +
        `plugins=${status?.deployedPlugins?.length ?? 0} warnings=${warnings.length}`,
);
if (status?.bdsConfig) {
    const { bdsDir, bdsWorld, bdsPackMode, bdsBpName, bdsRpName } = status.bdsConfig;
    console.log(`  目标：${bdsDir} · 世界 ${bdsWorld ?? "-"} · ${bdsPackMode} · ${bdsBpName}/${bdsRpName}`);
}
for (const issue of issues) console.log(`  \x1b[31m问题：${issue}\x1b[0m`);
for (const warning of warnings) console.log(`  \x1b[33m提示：${warning}\x1b[0m`);
console.log("\x1b[90m部署只写文件；重启 BDS 实例或重进世界后新包才会加载。\x1b[0m");
