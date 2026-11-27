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
import { createHash } from "node:crypto";
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

// 6. 浏览器端 AMT 模型、CQT 参数与 ORT 运行时（仅本地/完整版）
// 模型与服务端同源：直接使用 amt-cli npm 包内的 int8 权重，不再从外部 AMT 仓库复制。
if (!serverOnly) {
    const outDir = path.join(pubDir, "amt");
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const modelSrc = path.join(repoRoot, "node_modules/amt-cli/models/run4_int8.onnx");
    if (!fs.existsSync(modelSrc)) {
        throw new Error(
            `缺少浏览器端 AMT 模型：${modelSrc}\n` +
                "请在仓库根目录执行 npm install（模型由 @piano/server 依赖的 amt-cli 提供）。",
        );
    }
    fs.copyFileSync(modelSrc, path.join(outDir, "run4_int8.onnx"));

    const cqtMetaSrc = path.join(repoRoot, "assets/amt/cqt_meta.json");
    if (!fs.existsSync(cqtMetaSrc)) {
        throw new Error(`缺少浏览器端 CQT 参数：${cqtMetaSrc}`);
    }
    fs.copyFileSync(cqtMetaSrc, path.join(outDir, "cqt_meta.json"));

    const ortDist = path.join(repoRoot, "node_modules/onnxruntime-web/dist");
    for (const name of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
        const src = path.join(ortDist, name);
        if (!fs.existsSync(src)) {
            throw new Error(`缺少 ONNX Runtime Web 运行时：${src}（请先在仓库根目录 npm install）`);
        }
        fs.copyFileSync(src, path.join(outDir, name));
    }
    let size = 0;
    const manifest = {};
    for (const name of fs.readdirSync(outDir)) {
        const source = path.join(outDir, name);
        const bytes = fs.readFileSync(source);
        const hash = createHash("sha256").update(bytes).digest("hex");
        const versionDir = path.join(outDir, "v", hash);
        fs.mkdirSync(versionDir, { recursive: true });
        fs.renameSync(source, path.join(versionDir, name));
        manifest[name] = { hash, size: bytes.length };
        size += bytes.length;
    }
    fs.writeFileSync(path.join(pkgDir, "public", "amt", "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(
        path.join(pubDir, "_headers"),
        "/amt/v/*\n  Cache-Control: public, max-age=31536000, immutable\n",
    );
    console.log(`✓ amt (${Object.keys(manifest).length} files, ${(size / 1048576).toFixed(1)} MB)`);
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
