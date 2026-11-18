// 把 AMT 运行时（amt-cli + onnxruntime.dll + ONNX 模型）同步到 packages/server/amt/。
// 源目录优先取 AMT_DIR，其次尝试仓库内 vendor/ 与同级目录。找不到时只警告，不阻断开发。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const outDir = path.resolve(here, "../amt");

function findAmtDir() {
    const candidates = [
        process.env.AMT_DIR,
        path.join(repoRoot, "vendor", "Automated-Music-Transcription"),
        path.join(repoRoot, "..", "Automated-Music-Transcription"),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, "rust", "target", "release"))) return dir;
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

const releaseDir = path.join(amtDir, "rust", "target", "release");
const exeName = process.platform === "win32" ? "amt-cli.exe" : "amt-cli";
const exe = path.join(releaseDir, exeName);
const model = path.join(amtDir, "models", "run4_best.onnx");

if (!fs.existsSync(exe)) {
    console.warn(`⚠ 未找到 ${exe}，请先在 rust/ 目录执行 cargo build --release`);
    process.exit(0);
}
if (!fs.existsSync(model)) {
    console.warn(`⚠ 未找到模型 ${model}`);
    process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(exe, path.join(outDir, exeName));
fs.copyFileSync(model, path.join(outDir, "run4_best.onnx"));

if (process.platform === "win32") {
    // ONNX Runtime 动态加载：dll 必须与 exe 同目录
    for (const dll of ["onnxruntime.dll", "DirectML.dll"]) {
        const src = path.join(releaseDir, dll);
        if (fs.existsSync(src) && fs.statSync(src).size > 0) {
            fs.copyFileSync(src, path.join(outDir, dll));
        }
    }
}

const size = fs
    .readdirSync(outDir)
    .reduce((sum, name) => sum + fs.statSync(path.join(outDir, name)).size, 0);
console.log(`✓ AMT 运行时已同步 → ${path.relative(repoRoot, outDir)} (${(size / 1048576).toFixed(1)} MB)`);
