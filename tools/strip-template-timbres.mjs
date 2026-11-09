/**
 * 将 template.mcaddon 裁剪为“基础模板”：只保留经典 P-88。
 *
 * 生成器会把用户勾选的音色包按需合并进导出包；开发构建（npm run build）
 * 仍然直接从 rp/sounds 打包全部音色，不经过这里。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { PIANO_SOUND_LAYERS, PIANO_TIMBRES, pianoSoundId } from "@piano/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(root, process.argv[2] ?? "packages/addon/dist/template.mcaddon");
const optional = PIANO_TIMBRES.filter((timbre) => timbre.id !== "piano");
const optionalDirs = new Set(
    optional.flatMap((timbre) =>
        PIANO_SOUND_LAYERS.map((layer) => pianoSoundId(timbre.value, layer))
    )
);

const zip = await JSZip.loadAsync(await readFile(templatePath));
const files = Object.keys(zip.files);
const bpManifest = files.find((f) => f.endsWith("manifest.json") && (f.includes("bp") || f.includes("behavior")));
const rpManifest = files.find((f) => f.endsWith("manifest.json") && (f.includes("rp") || f.includes("resource")));
if (!bpManifest || !rpManifest) throw new Error("模板不完整：未找到 bp/rp manifest");
const bpPath = bpManifest.replace("manifest.json", "");
const rpPath = rpManifest.replace("manifest.json", "");

let removedFiles = 0;
for (const dir of optionalDirs) {
    const prefix = `${rpPath}sounds/${dir}/`;
    for (const file of Object.keys(zip.files)) {
        if (file.startsWith(prefix)) {
            zip.remove(file);
            removedFiles++;
        }
    }
}

const definitionsPath = `${rpPath}sounds/sound_definitions.json`;
const definitionsFile = zip.file(definitionsPath);
if (definitionsFile) {
    const definitions = JSON.parse(await definitionsFile.async("string"));
    for (const key of Object.keys(definitions.sound_definitions ?? {})) {
        const dir = key.split(".")[0];
        if (optionalDirs.has(dir)) delete definitions.sound_definitions[key];
    }
    zip.file(definitionsPath, `${JSON.stringify(definitions, null, 4)}\n`);
}

const timbresPath = `${bpPath}scripts/piano/timbres.js`;
if (zip.file(timbresPath)) {
    zip.file(timbresPath, `export const ENABLED_PIANO_TIMBRES = ["piano"];\n`);
}

const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await writeFile(templatePath, output);
console.log(
    `[timbres] 基础模板已裁剪：移除 ${removedFiles} 个可选采样，` +
    `${optionalDirs.size} 个音色目录，模板 ${(output.length / 1048576).toFixed(2)} MiB`
);
