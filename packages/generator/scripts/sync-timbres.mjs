// 同步可选钢琴音色包到 public/timbres（vite 构建/开发时自动带上）。
// 每个可选音色会打成一个独立 zip，生成器只按需下载用户勾选的包。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
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

    const zip = new JSZip();
    const definitions = {};
    for (const layer of PIANO_SOUND_LAYERS) {
        const dir = dirs[layer];
        for (const note of PIANO_SAMPLE_KEYS) {
            const file = path.join(soundsRoot, dir, `${note}.ogg`);
            if (!fs.existsSync(file)) {
                throw new Error(`缺少采样 ${file}，请先执行 npm run build:timbres`);
            }
            const data = fs.readFileSync(file);
            zip.file(`sounds/${dir}/${note}.ogg`, data);
            definitions[`${dir}.${note}`] = {
                category: "record",
                sounds: [`sounds/${dir}/${note}`],
                min_distance: 8,
                max_distance: 32,
            };
        }
    }
    zip.file("sound_definitions.json", JSON.stringify({ sound_definitions: definitions }));
    zip.file("meta.json", JSON.stringify({
        id: timbre.id,
        dirs,
        notes: PIANO_SAMPLE_KEYS,
        layers: PIANO_SOUND_LAYERS,
    }));

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const file = `${timbre.id}.zip`;
    fs.writeFileSync(path.join(outDir, file), buffer);
    entry.file = file;
    entry.size = buffer.length;
    totalBytes += buffer.length;
    optionalCount++;
    index.push(entry);
}

fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(
    `✅ 音色包已同步（${optionalCount} 个可选包，${(totalBytes / 1048576).toFixed(2)} MB）`
);
