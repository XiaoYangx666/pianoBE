import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { attachSongPerformance, metasToAddonIndex, songToAddonModule, validateSong } from "@piano/core";
import { readPerformance } from "./performance.mjs";

const songId = process.argv[2] ?? "e1563b03";
if (!/^[a-f0-9]{1,8}$/.test(songId)) throw new Error("无效的曲库曲目 ID");
const cues = readPerformance(songId);
if (!cues) throw new Error(`找不到 ${songId} 的演出源文件`);
const indexPath = new URL("../../midis/library/index.json", import.meta.url);
const songPath = new URL(`../../midis/library/${songId}.pbe3`, import.meta.url);
const addonIndex = new URL("../../midis/js/index.js", import.meta.url);
const index = JSON.parse(readFileSync(indexPath, "utf8"));
const entry = index.find(song => song.id === songId);
if (!entry) throw new Error(`曲库没有 ${songId}`);
const data = attachSongPerformance(readFileSync(songPath), cues);
const { header } = validateSong(data);
if (header.id !== songId) throw new Error("曲目 ID 不匹配");
entry.bytes = data.length;
writeFileSync(songPath, data);
writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n");
if (existsSync(addonIndex)) {
    writeFileSync(new URL(`./${songId}.js`, addonIndex), songToAddonModule(data));
    writeFileSync(addonIndex, metasToAddonIndex(index));
}
console.log(`${header.name} · ${cues.length} 提示 · ${data.length - header.performanceBytes} → ${data.length} 字节 (+${header.performanceBytes})`);
