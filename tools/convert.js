import fs from "fs";
import path from "path";
import pkg from "@tonejs/midi";
import { crc32 } from "crc";

const { Midi } = pkg;

// ===== 1. 读取路径 =====
const inputDir = path.resolve(process.argv[2] || "./midis/files");
const outputDir = path.resolve(process.argv[3] || "./midis/js");

// ===== scale 定义 =====
const TIME_SCALE = 40;
const OTHER_SCALE = 100;

// ===== encode 函数 =====
function encTime(v) {
    return Math.floor(v * TIME_SCALE);
}
function enc(v) {
    return Math.round(v * OTHER_SCALE);
}

// 清空输出
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const files = fs.readdirSync(inputDir).filter((f) => /\.midi?$/i.test(f));

const metaList = [];

// ===== 2. 转换 MIDI =====
for (const file of files) {
    const filePath = path.join(inputDir, file);
    const buffer = fs.readFileSync(filePath);

    const midi = new Midi(buffer);

    // ===== CRC32 作为唯一 ID =====
    const fileId = (crc32(buffer) >>> 0).toString(16);
    const outFile = `${fileId}.js`;

    const tracksCode = midi.tracks
        .map((track) => {
            const flat = [];

            for (const n of track.notes) {
                flat.push(
                    n.midi, // 0~127 不变
                    encTime(n.time), // /20
                    enc(n.duration), // /100
                    enc(n.velocity) // /100
                );
            }

            return `{instrument:${JSON.stringify(track.instrument)},notes:new Uint16Array([${flat.join(",")}])}`;
        })
        .join(",");

    // ===== export default =====
    const content =
        `export default {` +
        `id:${JSON.stringify(fileId)},` +
        `name:${JSON.stringify(file.replace(/\.midi?$/i, ""))},` +
        `duration:${Math.round(midi.duration * TIME_SCALE)},` + // 统一 /20
        `tracks:[${tracksCode}]` +
        `};`;

    fs.writeFileSync(path.join(outputDir, outFile), content, "utf-8");

    metaList.push({
        id: fileId,
        name: file.replace(/\.midi?$/i, ""),
        duration: Math.round(midi.duration * TIME_SCALE),
    });
}

// ===== 3. 生成 index.js =====
let indexContent = "export const midis=[";

for (const item of metaList) {
    indexContent +=
        `{` +
        `id:${JSON.stringify(item.id)},` +
        `name:${JSON.stringify(item.name)},` +
        `duration:${item.duration},` +
        `value:async()=> (await import("./${item.id}.js")).default` +
        `},`;
}

indexContent += "];";

fs.writeFileSync(path.join(outputDir, "index.js"), indexContent, "utf-8");

// ===== 4. 日志 =====
console.log(`✅ 已转换 ${files.length} 个 MIDI 文件`);
console.log(`📥 输入: ${inputDir}`);
console.log(`📤 输出: ${outputDir}`);
