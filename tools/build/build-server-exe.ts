#!/usr/bin/env bun
/**
 * 构建 Linux x64 单文件服务端（服务器版，不含浏览器本地转录/本地工作区）。
 *
 *   bun tools/build/build-server-exe.ts [--skip-build] [--outfile <path>]
 *
 * 步骤：
 *   1. STUDIO_SERVER_ONLY=1 构建 Studio（去掉本地模式入口）
 *   2. 收集精简后的前端资源（排除 amt/、plugins/、template.mcaddon）
 *   3. Bun.build AOT + trim 编译单文件：内嵌前端、内置插件、server.mcaddon
 *
 * 需要带 --aot/--trim 的 Bun（1.4.5-canary 及以上；稳定版 1.4.5 不生效）。
 * AOT 只能构建当前平台；Windows 版需在 Windows 上执行同一脚本。
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const outfileArg = args[args.indexOf("--outfile") + 1];
const outfile =
    args.includes("--outfile") && outfileArg
        ? resolve(outfileArg)
        : join(root, "build/server-exe", `pianobe-server-${process.platform}-${process.arch}`);

function run(command: string, commandArgs: string[], env: Record<string, string> = {}): void {
    execFileSync(command, commandArgs, {
        cwd: root,
        stdio: "inherit",
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

const stage = join(tmpdir(), `pianobe-server-exe-${process.pid}`);
rmSync(stage, { recursive: true, force: true });
const webDir = join(stage, "web");
cpSync(studioDist, webDir, { recursive: true });
console.log(`▶ 前端资源：${webDir}`);


const remove = [
    // 服务器端不使用的 Bun/Node 能力；trim 的保守分析会把它们全留下
    "archive", "brotli", "color", "cookie", "crypto-hasher", "dialogs", "diff", "fs-router",
    "glob", "hash", "html-rewriter", "http2", "http3", "image", "ipc", "markdown",
    "native-addons", "password", "plugin", "redis", "s3", "secrets", "semver", "shell",
    "temporal", "terminal", "url-pattern", "websocket", "interpreter",
] as const;

console.log("▶ 编译单文件（AOT + trim）");
const result = await Bun.build({
    entrypoints: [join(root, "packages/server/src/index.ts")],
    compile: {
        outfile,
        aot: true,
        trim: { remove: [...remove] },
        assets: [webDir, join(root, "build/plugins"), join(root, "packages/addon/dist/server.mcaddon")],
        functionSource: false,
    },
});
for (const log of result.logs) console.log(String(log));
if (!result.success) throw new Error("编译失败");
rmSync(stage, { recursive: true, force: true });

const size = statSync(outfile).size;
console.log(`✔ ${outfile}`);
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MiB（${size} 字节）`);
