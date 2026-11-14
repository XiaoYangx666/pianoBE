/**
 * 用本地 SAPI-Pro 工作区生成联调用 tarball。
 *
 * SAPI-Pro 的 DDUI 改动还在开发分支上，PianoBE 需要在不发布 npm 包的前提下使用它：
 *   node tools/sync-sapipro.mjs [SAPI-Pro 检出路径] [--no-install]
 * 默认读取 ../SAPI-Pro，先构建 stable 渠道，再把 tarball 写到 vendor/sapi-pro-dev.tgz，
 * 最后在仓库根目录执行 npm install。
 *
 * 反复迭代：改 SAPI-Pro → 运行本脚本 → 跑 PianoBE 测试/构建。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const install = !process.argv.includes("--no-install");
const checkout = resolve(root, args[0] ?? "../SAPI-Pro");
const variant = join(checkout, "variants/stable");
const vendor = join(root, "vendor");
const target = join(vendor, "sapi-pro-dev.tgz");

if (!existsSync(join(checkout, "core/src/Form/ddui/page.ts"))) {
    throw new Error(
        `未找到带 DDUI 的 SAPI-Pro 检出：${checkout}（可传入路径：node tools/sync-sapipro.mjs <path>）`
    );
}

const sapiPackage = JSON.parse(readFileSync(join(variant, "package.json"), "utf8"));
const addonPackage = JSON.parse(readFileSync(join(root, "packages/addon/package.json"), "utf8"));
const dependency = addonPackage.dependencies["sapi-pro"];

if (dependency !== "file:../../vendor/sapi-pro-dev.tgz") {
    throw new Error(
        `packages/addon 未把 sapi-pro 指向联调 tarball，当前为：${dependency}\n` +
            '期望："sapi-pro": "file:../../vendor/sapi-pro-dev.tgz"'
    );
}

console.log(`[sapipro] ${checkout} (${sapiPackage.version})`);
execSync("npm run build:stable", { cwd: checkout, stdio: "inherit" });

const packed = join(vendor, `sapi-pro-${sapiPackage.version}.tgz`);
rmSync(packed, { force: true });
execSync(`npm pack "${variant}" --pack-destination "${vendor}"`, {
    cwd: root,
    stdio: "inherit",
});
if (!existsSync(packed)) throw new Error(`npm pack 未生成 ${packed}`);
renameSync(packed, target);
console.log(`[sapipro] 已写入 ${target}`);

if (install) {
    // npm 按 lockfile 里的 integrity 使用内容缓存，同版本 tarball 重新打包后仍可能装回旧内容。
    // 这里先移除 lock 条目与已安装目录，确保真正读取新 tarball。
    const lockPath = join(root, "package-lock.json");
    if (existsSync(lockPath)) {
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        if (lock.packages?.["node_modules/sapi-pro"]) {
            delete lock.packages["node_modules/sapi-pro"];
            writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
        }
    }
    const installed = join(root, "node_modules/sapi-pro");
    rmSync(installed, { recursive: true, force: true });
    execSync("npm install", { cwd: root, stdio: "inherit" });
    const scopeFile = join(installed, "dist/Form/ddui/scope.js");
    const marker = existsSync(scopeFile) && readFileSync(scopeFile, "utf8").includes("source.getData");
    if (!marker) {
        throw new Error("npm install 后 sapi-pro 仍是旧构建（dist 缺少 DDUI 标记），请检查 tarball");
    }
    console.log("[sapipro] 已更新 node_modules/sapi-pro");
}
