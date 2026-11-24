/**
 * 同步 PianoBE Studio 运行与构建所需的静态资源到 packages/studio/public/：
 * - public/template.mcaddon（bare 模板）
 * - public/plugins/（内置 .pbeplugin 与 index.json）
 * - public/library/（官方曲库 .pbe3、index.json 与 catalog.json）
 * - public/performances/（官方精选演出 JSON）
 * - public/timbres/（可选钢琴音色包）
 * - public/amt/（浏览器端音频转 MIDI 模型与 ORT 运行时）
 * - public/piano/（服务器模式在线试听用钢琴采样）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAddonArchiveFile } from "@bepack/addon/node";
import { PIANO_SAMPLE_KEYS, PIANO_TIMBRES, pianoSoundId, pianoSoundLayers } from "@piano/core";
import { unzipSync, zipSync } from "fflate";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repoRoot = path.resolve(here, "../../..");
const pubDir = path.join(pkgDir, "public");

fs.mkdirSync(pubDir, { recursive: true });

// 1. template.mcaddon
{
    const bareSrc = path.join(repoRoot, "packages/addon/dist/template-bare.mcaddon");
    const fullSrc = path.join(repoRoot, "packages/addon/dist/template.mcaddon");
    const bare = fs.statSync(bareSrc, { throwIfNoEntry: false });
    const full = fs.statSync(fullSrc, { throwIfNoEntry: false });
    const src = bare && (!full || bare.mtimeMs >= full.mtimeMs) ? bareSrc : fullSrc;
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(pubDir, "template.mcaddon"));
        console.log(`✓ template.mcaddon (${path.basename(src)})`);
    } else {
        console.warn("⚠ 未找到 template-bare.mcaddon 或 template.mcaddon");
    }
}

// 2. built-in .pbeplugin packages (from build/plugins)
{
    const srcDir = path.join(repoRoot, "build/plugins");
    const dstDir = path.join(pubDir, "plugins");
    fs.rmSync(dstDir, { recursive: true, force: true });
    fs.mkdirSync(dstDir, { recursive: true });
    const files = fs.existsSync(srcDir)
        ? fs.readdirSync(srcDir).filter((name) => name.endsWith(".pbeplugin")).sort()
        : [];
    const decoder = new TextDecoder();
    const index = [];
    for (const file of files) {
        const srcPath = path.join(srcDir, file);
        const bytes = new Uint8Array(fs.readFileSync(srcPath));
        const entries = unzipSync(bytes);
        const manifestRaw = entries["plugin.json"];
        if (!manifestRaw) continue;
        const manifest = JSON.parse(decoder.decode(manifestRaw));
        fs.copyFileSync(srcPath, path.join(dstDir, file));
        index.push({
            id: manifest.id,
            manifest,
            size: bytes.byteLength,
            file,
            source: "builtin",
        });
    }
    fs.writeFileSync(path.join(dstDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    console.log(`✓ plugins (${index.length} built-in .pbeplugin packages)`);
}

// 3. official library (.pbe3 + index.json + catalog.json)
{
    const srcDir = path.join(repoRoot, "midis/library");
    const dstDir = path.join(pubDir, "library");
    fs.rmSync(dstDir, { recursive: true, force: true });
    fs.mkdirSync(dstDir, { recursive: true });
    if (fs.existsSync(srcDir)) {
        for (const name of fs.readdirSync(srcDir)) {
            if (name === "index.json" || name === "catalog.json" || name.endsWith(".pbe3")) {
                fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
            }
        }
        console.log(`✓ library (${fs.readdirSync(dstDir).length} files)`);
    } else {
        console.warn("⚠ 未找到 midis/library");
    }

    // 3b. 单文件曲库包：整库/多选导入时一次下载，避免逐曲请求
    const packEntries = {};
    for (const name of fs.readdirSync(dstDir)) {
        if (!name.endsWith(".pbe3")) continue;
        packEntries[name] = new Uint8Array(fs.readFileSync(path.join(dstDir, name)));
    }
    const packNames = Object.keys(packEntries);
    if (packNames.length > 0) {
        const pack = zipSync(packEntries, { level: 0 });
        fs.writeFileSync(path.join(dstDir, "official.pack.zip"), pack);
        console.log(
            `✓ library pack (${packNames.length} songs, ${(pack.byteLength / 1024 / 1024).toFixed(1)} MB)`,
        );
    }
}

// 4. official performances
{
    const srcDir = path.join(repoRoot, "midis/performances");
    const dstDir = path.join(pubDir, "performances");
    fs.rmSync(dstDir, { recursive: true, force: true });
    fs.mkdirSync(dstDir, { recursive: true });
    if (fs.existsSync(srcDir)) {
        for (const name of fs.readdirSync(srcDir)) {
            if (name.endsWith(".json")) {
                fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
            }
        }
        console.log(`✓ performances (${fs.readdirSync(dstDir).length} files)`);
    }
}

// 5. optional timbres
{
    const soundsRoot = path.join(repoRoot, "packages/addon/rp/sounds");
    const outDir = path.join(pubDir, "timbres");
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const index = [];
    for (const timbre of PIANO_TIMBRES) {
        const layers = pianoSoundLayers(timbre.value);
        const dirs = Object.fromEntries(
            layers.map((layer) => [`v${layer + 1}`, pianoSoundId(timbre.value, layer)]),
        );
        const bundled = timbre.id === "piano";
        const entry = {
            id: timbre.id,
            value: timbre.value,
            label: timbre.label,
            description: timbre.description,
            required: bundled,
            bundled,
            dirs,
            notes: PIANO_SAMPLE_KEYS,
            layers: layers.map((layer) => `v${layer + 1}`),
            size: 0,
            file: null,
        };
        if (bundled) {
            index.push(entry);
            continue;
        }
        const entries = [];
        const definitions = {};
        const encoder = new TextEncoder();
        let missing = false;
        for (const layer of layers) {
            const dir = dirs[`v${layer + 1}`];
            const stereoDir = pianoSoundId(timbre.value, layer, true);
            for (const note of PIANO_SAMPLE_KEYS) {
                const file = path.join(soundsRoot, dir, `${note}.ogg`);
                if (!fs.existsSync(file)) {
                    missing = true;
                    break;
                }
                const data = fs.readFileSync(file);
                entries.push({ path: `sounds/${dir}/${note}.ogg`, bytes: data });
                const sound = `sounds/${dir}/${note}`;
                definitions[`${dir}.${note}`] = {
                    category: "record",
                    sounds: [{ name: sound, is3D: true }],
                    min_distance: 8,
                    max_distance: 32,
                };
                definitions[`${stereoDir}.${note}`] = {
                    category: "record",
                    sounds: [{ name: sound, is3D: false }],
                };
            }
            if (missing) break;
        }
        if (missing) {
            console.warn(`⚠ 缺少音色采样 ${timbre.id}，跳过生成`);
            continue;
        }
        entries.push({
            path: "sound_definitions.json",
            bytes: encoder.encode(
                JSON.stringify({ sound_definitions: definitions })
                    .replace(/"min_distance": (-?\d+)(?![\d.])/g, '"min_distance": $1.0')
                    .replace(/"max_distance": (-?\d+)(?![\d.])/g, '"max_distance": $1.0'),
            ),
        });
        entries.push({
            path: "meta.json",
            bytes: encoder.encode(
                JSON.stringify({
                    id: timbre.id,
                    dirs,
                    notes: PIANO_SAMPLE_KEYS,
                    layers: layers.map((layer) => `v${layer + 1}`),
                }),
            ),
        });
        const file = `${timbre.id}.zip`;
        const { bytes } = await writeAddonArchiveFile(path.join(outDir, file), entries, {
            storedExtensions: /.*/,
        });
        entry.file = file;
        entry.size = bytes;
        index.push(entry);
    }
    fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2));
    console.log(`✓ timbres (${index.length} entries)`);
}

// 6. AMT browser runtime + model
{
    const outDir = path.join(pubDir, "amt");
    fs.mkdirSync(outDir, { recursive: true });
    const candidates = [
        process.env.AMT_DIR ? path.join(process.env.AMT_DIR, "web_demo") : null,
        path.join(repoRoot, "vendor", "Automated-Music-Transcription", "web_demo"),
        path.join(repoRoot, "..", "Automated-Music-Transcription", "web_demo"),
        path.join(repoRoot, "packages/generator/public/amt"),
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
