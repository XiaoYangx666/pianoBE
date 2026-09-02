// 增量添加/更新曲目到曲库（贡献者主入口：不碰现有曲目，git diff 干净）
// 用法:
//   npm run add-song -- <文件或目录> [<文件或目录>...]
//   例: npm run add-song -- ~/Desktop/新歌.mid
//       npm run add-song -- ./my-midis/ ./one.mid ./two.mid
// 效果: 每首生成/更新 midis/library/<id>.bin，合并进 index.json，
//       同步 midis/js/<id>.js 与 index.js（addon 构建源，不入库）。
// 防重复: id = crc32(midi 内容)，内容相同自动幂等；同名不同内容会警告。
import fs from "node:fs";
import path from "node:path";
import { countNotes, encodeSongToBinary, metasToAddonIndex, songToAddonModule } from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

const libDir = path.resolve("./midis/library");
const jsDir = path.resolve("./midis/js");

// ---------- 1. 收集待转换文件 ----------
const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (args.length === 0) {
    console.error("用法: npm run add-song -- <文件或目录> [<文件或目录>...]");
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
fs.mkdirSync(jsDir, { recursive: true });
const indexPath = path.join(libDir, "index.json");
const index = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : [];

let added = 0;
let updated = 0;
let skipped = 0;
for (const file of [...files].sort((a, b) => a.localeCompare(b))) {
    const song = midiBufferToSong(
        new Uint8Array(fs.readFileSync(file)),
        path.basename(file).replace(/\.midi?$/i, "")
    );
    const entry = { id: song.id, name: song.name, duration: song.duration, noteCount: countNotes(song) };
    const pos = index.findIndex((m) => m.id === song.id);
    let status;
    const sameName = index.some((m) => m.name === song.name && m.id !== song.id);
    if (sameName) {
        console.warn(`⚠️  同名不同内容: 「${song.name}」曲库已有另一首 (${index.find((m) => m.name === song.name && m.id !== song.id).id})，仍会添加 (${song.id})`);
    }
    if (pos >= 0) {
        if (index[pos].name === song.name && index[pos].noteCount === entry.noteCount) {
            status = "跳过"; // 内容与元数据完全一致 → 幂等跳过
            skipped++;
        } else {
            index[pos] = entry;
            status = "更新";
            updated++;
        }
    } else {
        index.push(entry);
        status = "新增";
        added++;
    }
    fs.writeFileSync(path.join(libDir, `${song.id}.bin`), encodeSongToBinary(song));
    fs.writeFileSync(path.join(jsDir, `${song.id}.js`), songToAddonModule(song), "utf-8");
    console.log(`  [${status}] ${song.name} (${song.id})`);
}

// ---------- 3. 统一写 index（按名称排序，便于 git diff 审查） ----------
index.sort((a, b) => a.name.localeCompare(b.name, "zh"));
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n", "utf-8");
fs.writeFileSync(path.join(jsDir, "index.js"), metasToAddonIndex(index), "utf-8");

// ---------- 4. 汇总 ----------
console.log(`\n✅ 完成：新增 ${added} · 更新 ${updated} · 跳过(重复) ${skipped} · 曲库现有 ${index.length} 首`);
console.log("💾 提交（只提交曲库，原始 midi 不入库）:");
console.log("   git add midis/library && git commit -m \"曲库: 新增歌曲\"");
console.log("📋 可选检查: npm run show-song -- <曲名关键词>");