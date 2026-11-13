// 同步可选钢琴音色包到 public/timbres（vite 构建/开发时自动带上）。
// 每个可选音色会打成一个独立 zip，生成器只按需下载用户勾选的包。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAddonArchiveFile } from "@bepack/addon/node";
import { PIANO_SAMPLE_KEYS, PIANO_SOUND_LAYERS, PIANO_TIMBRES, pianoSoundId } from "@piano/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const soundsRoot = path.resolve(here, "../../addon/rp/sounds");
const outDir = path.resolve(here, "../public/timbres");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const index = [];
let totalBytes = 0;
let optionalCount = 0;

for (const timbre of PIANO_TIMBRES) {
    const dirs = Object.fromEntries(
        PIANO_SOUND_LAYERS.map((layer) => [layer, pianoSoundId(timbre.value, layer)])
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
        layers: PIANO_SOUND_LAYERS,
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
    for (const layer of PIANO_SOUND_LAYERS) {
        const dir = dirs[layer];
        const stereoDir = pianoSoundId(timbre.value, layer, true);
        for (const note of PIANO_SAMPLE_KEYS) {
            const file = path.join(soundsRoot, dir, `${note}.ogg`);
            if (!fs.existsSync(file)) {
                throw new Error(`缺少采样 ${file}，请先执行 npm run build:timbres`);
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
    }
    entries.push({
        path: "sound_definitions.json",
        // Bedrock 要求 min_distance / max_distance 是浮点数；JSON.stringify 会把 8.0 写成 8，
        // 整数会被静默忽略，所以在文本层补上小数点。
        bytes: encoder.encode(JSON.stringify({ sound_definitions: definitions })
            .replace(/"min_distance": (-?\d+)(?![\d.])/g, '"min_distance": $1.0')
            .replace(/"max_distance": (-?\d+)(?![\d.])/g, '"max_distance": $1.0')),
    });
    entries.push({
        path: "meta.json",
        bytes: encoder.encode(
            JSON.stringify({
                id: timbre.id,
                dirs,
                notes: PIANO_SAMPLE_KEYS,
                layers: PIANO_SOUND_LAYERS,
            })
        ),
    });

    const file = `${timbre.id}.zip`;
    const { bytes } = await writeAddonArchiveFile(path.join(outDir, file), entries, {
        // 与旧实现一致：音色包不压缩，直接 STORE。
        storedExtensions: /.*/,
    });
    entry.file = file;
    entry.size = bytes;
    totalBytes += bytes;
    optionalCount++;
    index.push(entry);
}

fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(
    `✅ 音色包已同步（${optionalCount} 个可选包，${(totalBytes / 1048576).toFixed(2)} MB）`
);
