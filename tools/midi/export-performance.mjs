import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { attachSongPerformance, validateSong } from "@piano/core";
import { readPerformance } from "./performance.mjs";

const songId = process.argv[2] ?? "e1563b03";
if (!/^[a-f0-9]{1,8}$/.test(songId)) throw new Error("无效的曲库曲目 ID");
const cues = readPerformance(songId, process.argv[3]);
if (!cues?.length) throw new Error(`找不到 ${songId} 的演出提示`);

const songPath = new URL(`../../midis/library/${songId}.pbe3`, import.meta.url);
const outputDir = new URL("../../build/performances/", import.meta.url);
const label = process.argv[3] ? basename(process.argv[3], ".json") : "performance";
const output = new URL(`${songId}-${encodeURIComponent(label)}.pbe3`, outputDir);
const data = attachSongPerformance(readFileSync(songPath), cues);
const { header } = validateSong(data);
if (header.id !== songId) throw new Error("曲目 ID 不匹配");
mkdirSync(outputDir, { recursive: true });
writeFileSync(output, data);
console.log(`${header.name} · ${cues.length} 提示 · ${data.length} 字节 · ${output.pathname}`);
