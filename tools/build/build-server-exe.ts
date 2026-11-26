#!/usr/bin/env bun
/**
 * 构建单文件服务端（服务器版，仅含后端 API + 精简管理页 + 零插件 server.mcaddon）。
 * 插件（plugins/）、数据（data/）、日志（logs/）与按需下载的 AMT 均保存在外部运行目录。
 *
 *   bun tools/build/build-server-exe.ts [--skip-build] [--outfile <path>]
 *
 * 步骤：
 *   1. vite build --mode server 构建精简服务器版前端（dist-server，不含本地模式/ONNX/前端装配）
 *   2. 若缺少零插件 server.mcaddon 则构建之
 *   3. Bun.build AOT + trim 编译单文件：内嵌精简前端与零插件 server.mcaddon
 *
 * 需要带 --aot/--trim 的 Bun（1.4.5-canary 及以上；稳定版 1.4.5 不生效）。
 * AOT 只能构建当前平台；Windows 版需在 Windows 上执行同一脚本。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const version = (
    JSON.parse(readFileSync(join(root, "packages/server/package.json"), "utf8")) as { version?: string }
).version ?? "0.0.0";
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const outfileArg = args[args.indexOf("--outfile") + 1];
const ext = process.platform === "win32" ? ".exe" : "";
const outfile =
    args.includes("--outfile") && outfileArg
        ? resolve(outfileArg)
        : join(root, "build/server-exe", `pianobe-server-${process.platform}-${process.arch}${ext}`);

function run(command: string, commandArgs: string[], env: Record<string, string> = {}): void {
    execFileSync(command, commandArgs, {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, ...env },
    });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (!skipBuild) {
    console.log("▶ 构建 Studio（服务器版：dist-server）");
    run(npm, ["run", "build:studio:server"]);
    if (!existsSync(join(root, "packages/addon/dist/server.mcaddon"))) {
        console.log("▶ 构建服务器附加包（npm run build:server）");
        run(npm, ["run", "build:server"]);
    }
}

const studioDist = join(root, "packages/studio/dist-server");
if (!existsSync(join(studioDist, "index.html"))) {
    throw new Error(`缺少服务器版 Studio 产物：${studioDist}（先去掉 --skip-build）`);
}

const remove = [
    // 服务器端不使用的 Bun/Node 能力；trim 的保守分析会把它们全留下
    "archive", "brotli", "color", "cookie", "crypto-hasher", "dialogs", "diff", "fs-router",
    "glob", "hash", "html-rewriter", "http2", "http3", "image", "ipc", "markdown",
    "native-addons", "password", "plugin", "redis", "s3", "secrets", "semver", "shell",
    "temporal", "terminal", "url-pattern", "websocket", "interpreter",
] as const;

const serverAddonPath = join(root, "packages/addon/dist/server.mcaddon");
if (!existsSync(serverAddonPath)) {
    throw new Error(`缺少零插件服务器底包：${serverAddonPath}（先去掉 --skip-build 或运行 npm run build:server）`);
}

const stage = join(tmpdir(), `pianobe-server-exe-${process.pid}`);
rmSync(stage, { recursive: true, force: true });
const webDir = join(stage, "web");
cpSync(studioDist, webDir, { recursive: true });
console.log(`▶ 前端资源：${webDir}`);

try {
    console.log("▶ 编译单文件（AOT + trim）");
    const result = await Bun.build({
        entrypoints: [join(root, "packages/server/src/index.ts")],
        // 内嵌前端目录在产物里的位置：$bunfs/root/web，而入口是 $bunfs/root/server/src，
        // 所以相对入口是 ../../web。构建结束后脚本会用 --check-web 自检，改了布局会直接构建失败。
        define: {
            __PIANOBE_WEB__: JSON.stringify("../../web"),
            __PIANOBE_VERSION__: JSON.stringify(version),
            __PIANOBE_TEMPLATE__: JSON.stringify("../../../addon/dist/server.mcaddon"),
        },
        compile: {
            outfile,
            aot: true,
            trim: { remove: [...remove] },
            assets: [webDir, serverAddonPath],
            functionSource: false,
        },
    });
    for (const log of result.logs) console.log(String(log));
    if (!result.success) throw new Error("编译失败");
} finally {
    rmSync(stage, { recursive: true, force: true });
}

const size = statSync(outfile).size;
console.log(`✔ ${outfile}`);
console.log(`  v${version} · ${(size / 1024 / 1024).toFixed(1)} MiB（${size} 字节）`);

// 立即自检内嵌资源（前端 + 服务器底包）：布局写错（Bun 改了 $bunfs 结构、assets 改名）
// 就在构建阶段失败，而不是部署后才白屏/装不出包。在空目录里跑，确保不读到仓库里的文件。
const checkDir = mkdtempSync(join(tmpdir(), "pianobe-assets-check-"));
try {
    const check = spawnSync(outfile, ["--check-assets"], {
        cwd: checkDir,
        env: { ...process.env, WEB_ROOT: "" },
        encoding: "utf8",
    });
    if (check.status !== 0) {
        throw new Error(
            `内嵌资源自检失败：${(check.stderr || check.stdout).trim() || `exit ${check.status}`}`,
        );
    }
    console.log(check.stdout.trim().replace(/^/gm, "  "));
} finally {
    rmSync(checkDir, { recursive: true, force: true });
}
