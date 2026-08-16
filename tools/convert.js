import fs from "fs";
import path from "path";
import { metasToAddonIndex, songToAddonModule } from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

// ===== 1. 读取路径 =====
const inputDir = path.resolve(process.argv[2] || "./midis/files");
const outputDir = path.resolve(process.argv[3] || "./midis/js");

// 清空输出
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const files = fs
    .readdirSync(inputDir)
    .filter((f) => /\.midi?$/i.test(f));

const metaList = [];

// ===== 2. 转换 MIDI（逻辑统一在 @piano/core） =====
for (const file of files) {
    const filePath = path.join(inputDir, file);
    const buffer = fs.readFileSync(filePath);

    const song = midiBufferToSong(buffer, file.replace(/\.midi?$/i, ""));

    fs.writeFileSync(path.join(outputDir, `${song.id}.js`), songToAddonModule(song), "utf-8");

    metaList.push({ id: song.id, name: song.name, duration: song.duration });
}

// ===== 3. 生成 index.js =====
fs.writeFileSync(path.join(outputDir, "index.js"), metasToAddonIndex(metaList), "utf-8");

// ===== 4. 日志 =====
console.log(`✅ 已转换 ${files.length} 个 MIDI 文件`);
console.log(`📥 输入: ${inputDir}`);
console.log(`📤 输出: ${outputDir}`);