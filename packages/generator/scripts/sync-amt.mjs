// 同步浏览器端 AMT 资源到 packages/generator/public/amt/：
//   cqt_meta.json + run4_best_fp16.onnx（来自 AMT 仓库）
//   ORT WebGPU/WASM 运行时（来自 node_modules/onnxruntime-web）
// 源目录优先取 AMT_DIR；找不到时保留已有文件并警告。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const outDir = path.resolve(here, "../public/amt");

function findAmtDir() {
    const candidates = [
        process.env.AMT_DIR,
        path.join(repoRoot, "vendor", "Automated-Music-Transcription"),
        path.join(repoRoot, "..", "Automated-Music-Transcription"),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, "web_demo", "cqt_meta.json"))) return dir;
    }
    return null;
}

fs.mkdirSync(outDir, { recursive: true });

const amtDir = findAmtDir();
if (amtDir) {
    for (const name of ["cqt_meta.json", "run4_best_fp16.onnx"]) {
        const src = path.join(amtDir, "web_demo", name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
    }
} else if (!fs.existsSync(path.join(outDir, "run4_best_fp16.onnx"))) {
    console.warn(
        "⚠ 未找到 AMT web_demo 资源，音频转 MIDI 页面暂时不可用。\n" +
            "  请设置 AMT_DIR 指向 Automated-Music-Transcription 后重新运行：\n" +
            "  $env:AMT_DIR='E:\\Project\\muscriptor\\Automated-Music-Transcription'; npm run sync:amt -w @piano/generator"
    );
}

// ORT WASM-only external 构建：约 15 MB，满足 Cloudflare 单文件 25 MiB 上限。
// 复制前清掉旧的 jsep/asyncify 资源，避免 dist 越滚越大。
const ortDist = path.resolve(repoRoot, "node_modules", "onnxruntime-web", "dist");
const ortFiles = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
if (ortFiles.every((name) => fs.existsSync(path.join(ortDist, name)))) {
    for (const name of fs.readdirSync(outDir)) {
        if (name.startsWith("ort-wasm-")) fs.rmSync(path.join(outDir, name), { force: true });
    }
    for (const name of ortFiles) {
        fs.copyFileSync(path.join(ortDist, name), path.join(outDir, name));
    }
} else {
    console.warn(`⚠ 未找到 onnxruntime-web/dist 运行时，请先在仓库根目录 npm install`);
}

const files = fs.readdirSync(outDir);
const size = files.reduce((sum, name) => sum + fs.statSync(path.join(outDir, name)).size, 0);
console.log(
    `✓ AMT 浏览器资源已同步（${files.length} 个文件，${(size / 1048576).toFixed(1)} MB）`
);
