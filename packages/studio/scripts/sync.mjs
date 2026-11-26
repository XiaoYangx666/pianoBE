/**
 * 同步 PianoBE Studio 运行与构建所需的静态资源到 packages/studio/public/：
 * - public/template.mcaddon（bare 模板）
 * - public/plugins/（内置 VFX 与官方曲库 .pbeplugin 及轻量 index.json）
 * - public/timbres/（可选钢琴音色包）
 * - public/amt/（浏览器端音频转 MIDI 模型与 ORT 运行时）
 * - public/piano/（服务器模式在线试听用钢琴采样）
 *
 * 服务器版构建加 --server：只同步 public-server/piano/（试听采样），
 * 不包含本地模式使用的模板、内置插件与浏览器端 AMT 运行时。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPbePluginArchive } from "@piano/vfx/package";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repoRoot = path.resolve(here, "../../..");
const serverOnly = process.argv.includes("--server");
const pubDir = path.join(pkgDir, serverOnly ? "public-server" : "public");

fs.mkdirSync(pubDir, { recursive: true });

// 1. template.mcaddon（仅本地/完整版，零插件纯净基础模板）
if (!serverOnly) {
    const src = path.join(repoRoot, "packages/addon/dist/template.mcaddon");
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(pubDir, "template.mcaddon"));
        console.log("✓ template.mcaddon");
    } else {
        console.warn("⚠ 未找到 packages/addon/dist/template.mcaddon");
    }
}

const PREVIEW_MIME = {
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
};

function previewBytesToDataUrl(filePath, bytes) {
    if (!filePath || !bytes?.length) return undefined;
    const ext = path.extname(filePath).toLowerCase();
    const mime = PREVIEW_MIME[ext] ?? "image/png";
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

// 2. built-in .pbeplugin packages (from build/plugins)（仅本地/完整版）
if (!serverOnly) {
    const srcDir = path.join(repoRoot, "build/plugins");
    const dstDir = path.join(pubDir, "plugins");
    fs.rmSync(dstDir, { recursive: true, force: true });
    fs.mkdirSync(dstDir, { recursive: true });
    const files = fs.existsSync(srcDir)
        ? fs.readdirSync(srcDir).filter((name) => name.endsWith(".pbeplugin")).sort()
        : [];
    const index = [];
    for (const file of files) {
        const srcPath = path.join(srcDir, file);
        const bytes = new Uint8Array(fs.readFileSync(srcPath));
        const archive = readPbePluginArchive(bytes);
        const { manifest } = archive;
        const iconPath =
            (typeof manifest.icon === "string" ? manifest.icon : undefined) ??
            manifest.preview?.thumbnail;
        const previewEntry =
            (iconPath && archive.previews.has(iconPath)
                ? [iconPath, archive.previews.get(iconPath)]
                : undefined) ?? [...archive.previews.entries()][0];
        const previewDataUrl = previewEntry ? previewBytesToDataUrl(previewEntry[0], previewEntry[1]) : undefined;
        fs.copyFileSync(srcPath, path.join(dstDir, file));
        index.push({
            id: manifest.id,
            manifest,
            size: bytes.byteLength,
            file,
            source: "builtin",
            hasExecutableCode: archive.hasExecutableCode,
            ...(previewDataUrl ? { previewDataUrl } : {}),
            contents: {
                songs: archive.songs.size,
                performances: archive.performances.length,
                libraries: archive.libraries.length,
                timbres: archive.timbres.length,
                effects: manifest.provides.effects?.length ?? 0,
                themes: manifest.provides.themes?.length ?? 0,
                keyStyles: manifest.provides.keyStyles?.length ?? 0,
                particles: manifest.provides.particles?.length ?? 0,
                stageProps: archive.stageProps.length,
            },
            ...(archive.timbres.length > 0
                ? {
                      timbreEntries: archive.timbres.map(({ soundDefinitions: _defs, ...meta }) => meta),
                  }
                : {}),
        });
    }
    fs.writeFileSync(path.join(dstDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    console.log(`✓ plugins (${index.length} built-in .pbeplugin packages)`);
}

// 清理旧版散装在线曲库与旧版散装音色目录（均已统一由 .pbeplugin 分包分发）
fs.rmSync(path.join(pubDir, "library"), { recursive: true, force: true });
fs.rmSync(path.join(pubDir, "performances"), { recursive: true, force: true });
fs.rmSync(path.join(pubDir, "timbres"), { recursive: true, force: true });
console.log("✓ timbres (distributed as official .pbeplugin packages)");

// 6. AMT browser runtime + model（仅本地/完整版）
if (!serverOnly) {
    const outDir = path.join(pubDir, "amt");
    fs.mkdirSync(outDir, { recursive: true });
    const candidates = [
        process.env.AMT_DIR ? path.join(process.env.AMT_DIR, "web_demo") : null,
        path.join(repoRoot, "vendor", "Automated-Music-Transcription", "web_demo"),
        path.join(repoRoot, "..", "Automated-Music-Transcription", "web_demo"),
    ].filter(Boolean);
    const modelDir = candidates.find((d) => fs.existsSync(path.join(d, "run4_best_fp16.onnx")));
    if (modelDir) {
        for (const name of ["cqt_meta.json", "run4_best_fp16.onnx"]) {
            const src = path.join(modelDir, name);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
        }
    }
    const ortDist = path.join(repoRoot, "node_modules/onnxruntime-web/dist");
    for (const name of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
        const src = path.join(ortDist, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
    }
    console.log(`✓ amt (${fs.readdirSync(outDir).length} files)`);
}

// 7. server preview piano samples
{
    const source = path.join(repoRoot, "packages/addon/rp/sounds");
    const target = path.join(pubDir, "piano");
    if (fs.existsSync(source)) {
        const webName = (file) => file.replace(/#/g, "sharp");
        const packs = fs
            .readdirSync(source, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((pack) => pack.startsWith("piano_v") && fs.readdirSync(path.join(source, pack)).some((f) => f.endsWith(".ogg")));
        let count = 0;
        for (const pack of packs) {
            const dstPack = path.join(target, pack);
            fs.mkdirSync(dstPack, { recursive: true });
            for (const file of fs.readdirSync(path.join(source, pack))) {
                if (!file.endsWith(".ogg")) continue;
                fs.copyFileSync(path.join(source, pack, file), path.join(dstPack, webName(file)));
                count++;
            }
        }
        console.log(`✓ piano preview samples (${packs.length} packs, ${count} files)`);
    }
}
