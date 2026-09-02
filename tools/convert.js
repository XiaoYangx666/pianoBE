import fs from "fs";
import path from "path";
import {
    countNotes,
    encodeSongToBinary,
    metasToAddonIndex,
    songToAddonModule,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

// ===== 1. 读取路径 =====
// 用法：
//   node tools/convert.js [--force]           # 全量重建：midis/files → midis/js + midis/library
//   （注意：全量会清空重建曲库！只用于本地拥有完整 midis/files 的情况；
//     增量添加单首/批量请用 npm run add-song）
// const 单文件参数不再支持：请用 npm run add-song -- <xx.mid>
const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const inputArg = positionalArgs[0] || "./midis/files";
const force = process.argv.includes("--force");
const jsDir = path.resolve(process.argv[3] || "./midis/js");
const libDir = path.resolve(process.argv[4] || "./midis/library");

const inputPath = path.resolve(inputArg);
const inputIsDir = fs.statSync(inputPath).isDirectory();
if (!inputIsDir) {
    console.error(`❌ 单文件模式已移除：请用 npm run add-song -- ${inputArg}`);
    process.exit(1);
}
const inputDir = inputPath;
const files = fs
    .readdirSync(inputDir)
    .filter((f) => /\.midi?$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "zh"));
if (files.length === 0) {
    console.error(`❌ 没有可转换的 .mid/.midi 文件: ${inputPath}`);
    console.error("   增量添加请用: npm run add-song -- <xx.mid>");
    process.exit(1);
}

// 防误清空保护：全量重建会删除现有曲库，若输入文件数远少于现有曲库，
// 说明本机没有完整 midis/files（clone 后原始 midi 不入库），应改用 add-song。
const indexPath = path.join(libDir, "index.json");
if (fs.existsSync(indexPath) && !force) {
    const existing = JSON.parse(fs.readFileSync(indexPath, "utf8")).length;
    if (files.length < existing) {
        console.error(
            `❌ 保护：midis/files 只有 ${files.length} 个文件，现有曲库 ${existing} 首。\n` +
                `   全量重建会把曲库清空成 ${files.length} 首！\n` +
                `   · 只想添加新歌 → 用 npm run add-song -- <xx.mid>\n` +
                `   · 确认要全量重建 → 加 --force 重试`
        );
        process.exit(1);
    }
}

// ===== 2. 清空输出 =====
fs.rmSync(jsDir, { recursive: true, force: true });
fs.mkdirSync(jsDir, { recursive: true });
fs.rmSync(libDir, { recursive: true, force: true });
fs.mkdirSync(libDir, { recursive: true });

// ===== 3. 转换（解析逻辑统一在 @piano/core） =====
// 每首同时产出：
//   midis/js/<id>.js        addon 运行时模块文本（构建期拷入 bp/scripts/midis，不入库）
//   midis/library/<id>.bin  曲库二进制（入库；生成器按需加载，只含转换后数据）
const metas = [];
let notes = 0;
let jsBytes = 0;
let binBytes = 0;

for (const file of files) {
    const buffer = fs.readFileSync(path.join(inputDir, file));
    const song = midiBufferToSong(buffer, file.replace(/\.midi?$/i, ""));

    fs.writeFileSync(path.join(jsDir, `${song.id}.js`), songToAddonModule(song), "utf-8");
    fs.writeFileSync(path.join(libDir, `${song.id}.bin`), encodeSongToBinary(song));

    metas.push({
        id: song.id,
        name: song.name,
        duration: song.duration,
        noteCount: countNotes(song),
    });
    notes += countNotes(song);
    jsBytes += songToAddonModule(song).length;
    binBytes += encodeSongToBinary(song).length;
}

// ===== 4. index.js（addon 运行时）+ index.json（生成器曲库目录） =====
fs.writeFileSync(path.join(jsDir, "index.js"), metasToAddonIndex(metas), "utf-8");
// index.json 按名称排序，便于 git diff 审查新增曲目
const sorted = [...metas].sort((a, b) => a.name.localeCompare(b.name, "zh"));
fs.writeFileSync(path.join(libDir, "index.json"), JSON.stringify(sorted, null, 1) + "\n", "utf-8");

// ===== 5. 日志 =====
console.log(`✅ 已转换 ${files.length} 个 MIDI 文件（共 ${Math.round(notes).toLocaleString()} 音符）`);
console.log(`📥 输入: ${inputArg}`);
console.log(`📤 addon 模块: ${jsDir}（${(jsBytes / 1048576).toFixed(1)} MB，不入库）`);
console.log(`📦 曲库二进制: ${libDir}（${(binBytes / 1048576).toFixed(2)} MB，入库）`);
console.log(`💾 压缩比: ${(jsBytes / binBytes).toFixed(1)}×`);