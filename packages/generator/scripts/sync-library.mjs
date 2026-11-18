// 同步曲库（midis/library 二进制 + index.json）到 public/library，vite 开发/构建时自动带上。
// 只同步转换后的二进制数据，不入库原始 .mid（midis/files 不入库）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../../../midis/library");
const dstDir = path.resolve(here, "../public/library");

if (fs.existsSync(srcDir)) {
    fs.rmSync(dstDir, { recursive: true, force: true });
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, "index.json"), path.join(dstDir, "index.json"));
    const bins = fs
        .readdirSync(srcDir)
        .filter((f) => f.endsWith(".pbe3"));
    for (const file of bins) fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
    const index = JSON.parse(fs.readFileSync(path.join(dstDir, "index.json"), "utf8"));
    const size = fs.readdirSync(dstDir).reduce(
        (s, f) => s + fs.statSync(path.join(dstDir, f)).size,
        0
    );
    console.log(
        `✓ 曲库已同步：${index.length} 首 / ${bins.length} 个二进制（${(size / 1048576).toFixed(2)} MB）`
    );
    if (index.length !== bins.length) {
        console.warn(`⚠ index.json 曲目数（${index.length}）与二进制数（${bins.length}）不一致！`);
    }
} else {
    console.warn("⚠ 未找到 midis/library，曲库将为空。请先执行 npm run convert 或迁移脚本。");
}
