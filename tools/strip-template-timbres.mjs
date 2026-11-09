/**
 * 将 template.mcaddon 裁剪为“基础模板”：只保留经典 P-88。
 *
 * 生成器会把用户勾选的音色包按需合并进导出包；开发构建（npm run build）
 * 仍然直接从 rp/sounds 打包全部音色，不经过这里。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAddonFile, writeAddonFile } from "@bepack/addon/node";
import { PIANO_SOUND_LAYERS, PIANO_TIMBRES, pianoSoundId } from "@piano/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(root, process.argv[2] ?? "packages/addon/dist/template.mcaddon");
const optional = PIANO_TIMBRES.filter((timbre) => timbre.id !== "piano");
const optionalDirs = new Set(
    optional.flatMap((timbre) =>
        PIANO_SOUND_LAYERS.map((layer) => pianoSoundId(timbre.value, layer))
    )
);

const addon = await readAddonFile(templatePath);
const bp = addon.packs.bp;
const rp = addon.packs.rp;
if (!bp || !rp) throw new Error("模板不完整：未找到 bp/rp manifest");
const bpPath = bp.root;
const rpPath = rp.root;

let removedFiles = 0;
for (const dir of optionalDirs) {
    const prefix = `${rpPath}sounds/${dir}/`;
    removedFiles += addon.entries().filter((file) => file.path.startsWith(prefix)).length;
    addon.removeTree(prefix);
}

const definitionsPath = `${rpPath}sounds/sound_definitions.json`;
const definitionsText = addon.readTextSync(definitionsPath);
if (definitionsText) {
    const definitions = JSON.parse(definitionsText);
    for (const key of Object.keys(definitions.sound_definitions ?? {})) {
        const dir = key.split(".")[0];
        if (optionalDirs.has(dir)) delete definitions.sound_definitions[key];
    }
    addon.writeText(definitionsPath, `${JSON.stringify(definitions, null, 4)}\n`);
}

const timbresPath = `${bpPath}scripts/piano/timbres.js`;
if (addon.has(timbresPath)) {
    addon.writeText(timbresPath, `export const ENABLED_PIANO_TIMBRES = ["piano"];\n`);
}

// 与旧实现一致：模板走 DEFLATE，包括已压缩的 .ogg。
const { bytes } = await writeAddonFile(templatePath, addon, {
    level: 6,
    storedExtensions: /$^/,
});
console.log(
    `[timbres] 基础模板已裁剪：移除 ${removedFiles} 个可选采样，` +
    `${optionalDirs.size} 个音色目录，模板 ${(bytes / 1048576).toFixed(2)} MiB`
);
