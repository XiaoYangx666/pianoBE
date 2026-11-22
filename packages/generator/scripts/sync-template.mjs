// 同步 addon 构建产物 template.mcaddon 到 public/（vite 构建/开发时自动带上）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bareSrc = path.resolve(here, "../../addon/dist/template-bare.mcaddon");
const fullSrc = path.resolve(here, "../../addon/dist/template.mcaddon");
const src = fs.existsSync(bareSrc) ? bareSrc : fullSrc;
const dstDir = path.resolve(here, "../public");
const dst = path.join(dstDir, "template.mcaddon");

if (fs.existsSync(src)) {
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(src, dst);
    console.log(`✅ ${path.basename(src)} 已同步为 public/template.mcaddon (${(fs.statSync(src).size / 1024).toFixed(0)} KB)`);
} else {
    console.warn("⚠️ 未找到 template-bare.mcaddon 或 template.mcaddon，请先执行 npm run build:template（addon 包）");
}