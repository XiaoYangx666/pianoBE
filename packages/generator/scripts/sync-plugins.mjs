// 同步内置 .pbeplugin 包到 public/plugins（vite 开发/构建时自动带上）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../../../build/plugins");
const outDir = path.resolve(here, "../public/plugins");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const files = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((name) => name.endsWith(".pbeplugin")).sort()
    : [];

if (files.length === 0) {
    fs.writeFileSync(path.join(outDir, "index.json"), "[]\n");
    console.warn("⚠️ 未找到 build/plugins/*.pbeplugin，请先执行 npm run pack:plugins");
    process.exit(0);
}

const decoder = new TextDecoder();
const index = [];
let totalBytes = 0;

for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const bytes = new Uint8Array(fs.readFileSync(srcPath));
    const entries = unzipSync(bytes);
    const manifestRaw = entries["plugin.json"];
    if (!manifestRaw) {
        throw new Error(`[sync-plugins] ${file} 缺少 plugin.json`);
    }
    const manifest = JSON.parse(decoder.decode(manifestRaw));
    fs.copyFileSync(srcPath, path.join(outDir, file));
    index.push({
        id: manifest.id,
        manifest,
        size: bytes.byteLength,
        file,
        source: "builtin",
    });
    totalBytes += bytes.byteLength;
}

fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(
    `✅ VFX 插件包已同步（${index.length} 个插件，${(totalBytes / 1024).toFixed(1)} KB）`
);
