// 把 AMT 运行时（amt-cli + ONNX Runtime + int8 模型）同步到 packages/server/amt/。
//
// 支持 Windows 与 Linux：
//   - 默认按当前平台同步：优先 rust/target/release，其次 AMT_DIR/dist 下的预编译包
//   - AMT_PLATFORM=linux|win32 可交叉准备，例如在 Windows 上为 Docker 准备 Linux 版
//   - Linux 的预编译包会自动从 dist/*-linux-x64.tar.gz 解压
//
// 源目录优先取 AMT_DIR，其次尝试仓库内 vendor/ 与同级目录。找不到时只警告，不阻断开发。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const outDir = path.resolve(here, "../amt");

// 模型优先级：静态 int8（默认，约 3.9 MB）→ fp32 回退（约 15 MB）
const MODEL_NAMES = ["run4_int8.onnx", "run4_best.onnx"];
const DEVICE_TAG = { win32: "-win-x64", linux: "-linux-x64" };

function findAmtDir() {
    const candidates = [
        process.env.AMT_DIR,
        path.join(repoRoot, "vendor", "Automated-Music-Transcription"),
        path.join(repoRoot, "..", "Automated-Music-Transcription"),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (
            fs.existsSync(path.join(dir, "rust", "target", "release")) ||
            fs.existsSync(path.join(dir, "models")) ||
            fs.existsSync(path.join(dir, "dist"))
        ) {
            return dir;
        }
    }
    return null;
}

const amtDir = findAmtDir();
if (!amtDir) {
    console.warn(
        "⚠ 未找到 AMT 源码/构建产物，跳过 amt 同步。\n" +
            "  请设置 AMT_DIR 指向 Automated-Music-Transcription，例如：\n" +
            "  $env:AMT_DIR='E:\\Project\\muscriptor\\Automated-Music-Transcription'; npm run sync:amt -w @piano/server"
    );
    process.exit(0);
}

const platform =
    process.env.AMT_PLATFORM === "linux"
        ? "linux"
        : process.env.AMT_PLATFORM === "win32" || process.env.AMT_PLATFORM === "windows"
          ? "win32"
          : process.platform === "linux"
            ? "linux"
            : "win32";
const isWindows = platform === "win32";
const exeName = isWindows ? "amt-cli.exe" : "amt-cli";
const releaseDir = path.join(amtDir, "rust", "target", "release");
const distDir = path.join(amtDir, "dist");

function newest(entries, base) {
    return (
        entries
            .map((name) => ({ name, mtime: fs.statSync(path.join(base, name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)[0]?.name ?? null
    );
}

/** AMT_DIR/dist 下已解压的当前平台预编译目录 */
function findPrebuiltDir() {
    if (!fs.existsSync(distDir)) return null;
    const suffix = DEVICE_TAG[platform];
    const entries = fs
        .readdirSync(distDir)
        .filter((name) => name.endsWith(suffix) && fs.statSync(path.join(distDir, name)).isDirectory());
    return newest(entries, distDir);
}

/** 没有解压目录时，尝试从 dist/*-linux-x64.tar.gz 解压（Windows 的 zip 不自动解） */
function ensurePrebuiltDir() {
    const existing = findPrebuiltDir();
    if (existing) return existing;
    if (!fs.existsSync(distDir)) return null;

    const suffix = DEVICE_TAG[platform];
    const entries = fs.readdirSync(distDir).filter((name) => name.endsWith(`${suffix}.tar.gz`));
    const tarball = newest(entries, distDir);
    if (!tarball) return null;

    try {
        execFileSync("tar", ["-xzf", path.join(distDir, tarball), "-C", distDir], { stdio: "pipe" });
        return findPrebuiltDir();
    } catch (error) {
        console.warn(`⚠ 解压 ${tarball} 失败：${error.message}`);
        return null;
    }
}

const prebuilt = ensurePrebuiltDir();
const sourceDirs = [];
if (platform === process.platform) sourceDirs.push(releaseDir);
if (prebuilt) sourceDirs.push(path.join(distDir, prebuilt));

function firstExisting(paths) {
    return paths.find((p) => {
        const stat = fs.statSync(p, { throwIfNoEntry: false });
        return stat?.isFile();
    });
}

const cli = firstExisting(sourceDirs.map((dir) => path.join(dir, exeName)));
if (!cli) {
    const hint = isWindows
        ? "请先在 rust/ 下 cargo build --release，或准备 dist/amt-cli-*-win-x64/"
        : "请先在 Linux 上 cargo build --release，或准备 dist/amt-cli-*-linux-x64.tar.gz";
    console.warn(`⚠ 未找到 ${platform} 版 ${exeName}，跳过 amt 同步。\n  ${hint}`);
    process.exit(0);
}

function findOrtFiles() {
    for (const dir of sourceDirs) {
        if (isWindows) {
            const file = path.join(dir, "onnxruntime.dll");
            if (fs.existsSync(file)) return [file];
            continue;
        }
        const names = fs
            .readdirSync(dir)
            .filter((name) => /^libonnxruntime\.so(\.\d+)*$/.test(name));
        // 只拷带版本号的实体文件，避免把 .so 与 .so.1.31.1 各拷一份（大小翻倍）。
        const versioned = names.filter((name) => /^libonnxruntime\.so\.\d/.test(name));
        const files = (versioned.length ? versioned : names)
            .map((name) => path.join(dir, name))
            .filter((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile());
        if (files.length) return files;
    }
    return [];
}

const ortFiles = findOrtFiles();
if (!ortFiles.length) {
    console.warn(
        `⚠ 未找到 ${isWindows ? "onnxruntime.dll" : "libonnxruntime.so"}，跳过 amt 同步。\n` +
            "  请把 ONNX Runtime 1.31 放到 amt-cli 旁边，或使用上游 dist/ 预编译包。"
    );
    process.exit(0);
}

function findModel() {
    const dirs = [];
    for (const dir of sourceDirs) dirs.push(dir, path.join(dir, "models"));
    dirs.push(path.join(amtDir, "models"));
    for (const name of MODEL_NAMES) {
        for (const dir of dirs) {
            const file = path.join(dir, name);
            if (fs.existsSync(file)) return file;
        }
    }
    return null;
}

const model = findModel();
if (!model) {
    console.warn(`⚠ 未找到模型（${MODEL_NAMES.join(" / ")}），跳过 amt 同步。`);
    process.exit(0);
}

// 清理上一次同步的托管文件，避免 Windows/Linux 二进制或新旧模型混在一起。
fs.mkdirSync(outDir, { recursive: true });
for (const name of fs.readdirSync(outDir)) {
    const managed =
        name === "amt-cli" ||
        name === "amt-cli.exe" ||
        name === "DirectML.dll" ||
        name === "onnxruntime.dll" ||
        name.startsWith("libonnxruntime.so") ||
        MODEL_NAMES.includes(name);
    if (managed) fs.rmSync(path.join(outDir, name), { force: true });
}

fs.copyFileSync(cli, path.join(outDir, exeName));
if (!isWindows) fs.chmodSync(path.join(outDir, exeName), 0o755);

const copiedOrt = ortFiles.map((file) => path.basename(file));
for (const file of ortFiles) fs.copyFileSync(file, path.join(outDir, path.basename(file)));
// Linux 上补一个不带版本号的符号链接；交叉准备（Windows 主机）下由 Dockerfile 创建。
if (platform === "linux" && process.platform === "linux" && !copiedOrt.includes("libonnxruntime.so")) {
    const versioned = copiedOrt.find((name) => /^libonnxruntime\.so\.\d/.test(name));
    if (versioned) {
        const alias = path.join(outDir, "libonnxruntime.so");
        fs.rmSync(alias, { force: true });
        fs.symlinkSync(versioned, alias);
    }
}

const modelName = path.basename(model);
fs.copyFileSync(model, path.join(outDir, modelName));

const total = fs
    .readdirSync(outDir)
    .reduce((sum, name) => sum + fs.statSync(path.join(outDir, name)).size, 0);
console.log(`✓ AMT 运行时已同步（${platform}） → ${path.relative(repoRoot, outDir)}`);
console.log(`  cli:   ${exeName}`);
console.log(
    `  model: ${modelName}${modelName === "run4_int8.onnx" ? "（int8 默认）" : "（fp32 回退，建议先生成 int8）"}`
);
console.log(`  size:  ${(total / 1048576).toFixed(1)} MB`);

if (platform !== process.platform) {
    console.warn(
        `⚠ 当前主机是 ${process.platform}，本次输出为 ${platform} 版，仅用于交叉打包/容器；` +
            "本机运行请重新执行一次不带 AMT_PLATFORM 的同步。"
    );
}
