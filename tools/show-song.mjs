// 查看曲库曲目信息（调试/审查添加结果用）
// 用法: node tools/show-song.mjs <id 或 名称关键词>
import fs from "node:fs";
import path from "node:path";

const libDir = path.resolve("./midis/library");
const indexPath = path.join(libDir, "index.json");
if (!fs.existsSync(indexPath)) {
    console.error("❌ 曲库不存在，请先 run npm run convert");
    process.exit(1);
}
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

const kw = (process.argv[2] ?? "").trim().toLowerCase();
const items = kw
    ? index.filter(
          (m) => m.id === kw || m.name.toLowerCase().includes(kw)
      )
    : index.slice(0, 20);

if (items.length === 0) {
    console.log(`曲库 ${index.length} 首，无匹配「${kw}」。不带参数可查看前 20 首。`);
    process.exit(0);
}
for (const m of items) {
    const binPath = path.join(libDir, `${m.id}.bin`);
    const size = fs.existsSync(binPath) ? fs.statSync(binPath).size : 0;
    const sec = (m.duration / 40).toFixed(0);
    console.log(
        `${m.id}  ${m.name}   ${sec}s  ${Math.round(m.noteCount).toLocaleString()} notes  ${size.toLocaleString()} B${fs.existsSync(binPath) ? "" : " ⚠️ 缺 bin"}`
    );
}
if (!kw) console.log(`…（共 ${index.length} 首，显示前 ${items.length} 首）`);