/**
 * 从本地 tabletop 检出重新打包 vendor 依赖。
 *
 * @begame/tabletop 是私有包，不发布到 npm，也不随本仓库公开（vendor/*.tgz 已被忽略）。
 * 构建 addon 前需要自行准备 tarball：node tools/pack-tabletop.mjs [tabletop 检出路径]
 * 默认读取 ../tabletop；npm pack 的 prepack 会先执行 tabletop 的 build。
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkout = resolve(root, process.argv[2] ?? "../tabletop");
const addonPackage = JSON.parse(
    readFileSync(join(root, "packages/addon/package.json"), "utf8")
);
const dependency = addonPackage.dependencies["@begame/tabletop"];

if (!dependency?.startsWith("file:")) {
    throw new Error(`packages/addon 未把 @begame/tabletop 声明为 file: 依赖：${dependency}`);
}

const target = resolve(root, join("packages/addon", dependency.slice("file:".length)));
if (basename(dirname(target)) !== "vendor") {
    throw new Error(`期望 tarball 落在 vendor/ 下，实际为 ${target}`);
}
if (!existsSync(join(checkout, "package.json"))) {
    throw new Error(
        `未找到 tabletop 检出：${checkout}（可传入路径：node tools/pack-tabletop.mjs <path>）`
    );
}

const tabletopPackage = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
const packed = `${tabletopPackage.name.replace(/^@/, "").replace("/", "-")}-${tabletopPackage.version}.tgz`;
if (basename(target) !== packed) {
    throw new Error(
        `packages/addon 期望 ${basename(target)}，但 tabletop 检出会打包出 ${packed}；` +
            "请同步更新 packages/addon/package.json 与 package-lock.json"
    );
}

const commit = git(["rev-parse", "--short", "HEAD"]);
const dirty = git(["status", "--porcelain"]).trim();

console.log(`[tabletop] ${checkout} @ ${commit} (${tabletopPackage.version})`);
if (dirty) {
    console.warn("[tabletop] 检出中存在未提交改动，生成的 tarball 不对应任何提交");
}

execSync(`npm pack --pack-destination "${dirname(target)}"`, {
    cwd: checkout,
    stdio: "inherit",
});

if (!existsSync(target)) {
    throw new Error(`npm pack 未生成 ${target}`);
}
console.log(`[tabletop] 已写入 ${target}`);

function git(args) {
    return execSync(`git ${args.join(" ")}`, { cwd: checkout, encoding: "utf8" });
}
