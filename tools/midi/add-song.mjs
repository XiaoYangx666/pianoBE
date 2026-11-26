// 增量添加曲目到公共曲库。
// 用法:
//   npm run midi -- add-song <文件或目录> [<文件或目录>...]
//   例: npm run midi -- add-song ~/Desktop/新歌.mid
//       npm run midi -- add-song ./my-midis/ ./one.mid ./two.mid
// 按播放内容归并并保留已有曲目。编排通过独立演出文件交付。
import fs from "node:fs";
import path from "node:path";
import {
    collectSongNoteCount,
    encodeSong,
    findFreeSongId,
    reidentifySong,
    sameSongMusic,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

const libDir = path.resolve("./midis/library");

// ---------- 1. 收集待转换文件 ----------
const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (args.length === 0) {
    console.error("用法: npm run midi -- add-song <文件或目录> [<文件或目录>...]");
    process.exit(1);
}
const files = new Set();
for (const arg of args) {
    const p = path.resolve(arg);
    if (!fs.existsSync(p)) {
        console.error(`❌ 不存在: ${arg}`);
        continue;
    }
    if (fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p)) {
            if (/\.midi?$/i.test(f)) files.add(path.join(p, f));
        }
    } else if (/\.midi?$/i.test(p)) {
        files.add(p);
    } else {
        console.error(`❌ 跳过非 midi 文件: ${arg}`);
    }
}
if (files.size === 0) {
    console.error("❌ 没有可转换的 .mid/.midi 文件");
    process.exit(1);
}

// ---------- 2. 转换 + 防重复合并 ----------
fs.mkdirSync(libDir, { recursive: true });
const indexPath = path.join(libDir, "index.json");
const index = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : [];

let added = 0;
let skipped = 0;
for (const file of [...files].sort((a, b) => a.localeCompare(b))) {
    const song = midiBufferToSong(
        new Uint8Array(fs.readFileSync(file)),
        path.basename(file).replace(/\.midi?$/i, "")
    );
    const data = encodeSong(song);
    const noteCount = collectSongNoteCount(song);
    const existing = index.find(meta => meta.duration === song.duration && meta.noteCount === noteCount
        && sameSongMusic(fs.readFileSync(path.join(libDir, `${meta.id}.pbe3`)), data));
    if (existing) {
        skipped++;
        console.log(`  [已存在] ${existing.name} (${existing.id})`);
        continue;
    }
    const id = findFreeSongId(data, candidate => index.some(meta => meta.id === candidate));
    const pbe3 = id === song.id ? data : reidentifySong(data, id);
    fs.writeFileSync(path.join(libDir, `${id}.pbe3`), pbe3);
    index.push({ id, name: song.name, duration: song.duration, noteCount, bytes: pbe3.length });
    added++;
    console.log(`  [新增] ${song.name} (${id})`);
}

// ---------- 3. 统一写 index（按名称排序，便于 git diff 审查） ----------
index.sort((a, b) => a.name.localeCompare(b.name, "zh"));
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n", "utf-8");
// ---------- 4. 汇总 ----------
console.log(`\n✅ 完成：新增 ${added} · 跳过(重复) ${skipped} · 曲库现有 ${index.length} 首`);
console.log("💾 提交（只提交曲库，原始 midi 不入库）:");
console.log("   git add midis/library && git commit -m \"曲库: 新增歌曲\"");
console.log("📋 可选检查: npm run midi -- show-song <曲名关键词>");
