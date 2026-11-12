// PBE2 全曲库性能基准：编码体积、解压/索引耗时、SongCache 常驻内存、多钢琴共享。
// 用法：npm run bench:pbe2
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
    EventCursor,
    SongCache,
    buildSeekIndex,
    planImportChunks,
    readPbe2Events,
    readPbe2Header,
} from "@piano/core";

const libDir = path.resolve("./midis/library");
const jsDir = path.resolve("./midis/js");
const index = JSON.parse(fs.readFileSync(path.join(libDir, "index.json"), "utf8"));

const rows = [];
let totalPacked = 0;
let totalRaw = 0;
let totalNotes = 0;
let totalModule = 0;
let totalInflateMs = 0;
let totalIndexMs = 0;
let totalChunks = 0;
let maxChunks = 0;
let maxPacked = 0;
let maxPackedName = "";

for (const meta of index) {
    const pbe2 = new Uint8Array(fs.readFileSync(path.join(libDir, `${meta.id}.bin`)));
    const header = readPbe2Header(pbe2);
    const inflateStart = performance.now();
    const { events } = readPbe2Events(pbe2);
    const inflateMs = performance.now() - inflateStart;
    const indexStart = performance.now();
    const seek = buildSeekIndex(events, header.hasVelocity);
    const indexMs = performance.now() - indexStart;
    const modulePath = path.join(jsDir, `${meta.id}.js`);
    const moduleSize = fs.existsSync(modulePath) ? fs.statSync(modulePath).size : 0;

    totalPacked += pbe2.length;
    totalRaw += events.length;
    totalNotes += header.noteCount;
    totalModule += moduleSize;
    totalInflateMs += inflateMs;
    totalIndexMs += indexMs;
    const chunks = planImportChunks(pbe2, 4800);
    totalChunks += chunks.length;
    maxChunks = Math.max(maxChunks, chunks.length);
    if (pbe2.length > maxPacked) {
        maxPacked = pbe2.length;
        maxPackedName = meta.name;
    }
    rows.push({ meta, pbe2, header, seek, inflateMs, indexMs });
}

console.log("=== PBE2 曲库基准 ===");
console.log(`曲目数量        : ${index.length}`);
console.log(`PBE2 总体积     : ${(totalPacked / 1048576).toFixed(2)} MB`);
console.log(`事件流未压缩    : ${(totalRaw / 1048576).toFixed(2)} MB`);
console.log(`内嵌模块文本    : ${(totalModule / 1048576).toFixed(2)} MB`);
console.log(`压缩率          : ${(totalRaw / totalPacked).toFixed(2)}×`);
console.log(`音符总数        : ${totalNotes.toLocaleString()}`);
console.log(`平均每音符      : ${(totalPacked / totalNotes).toFixed(2)} B（压缩后）`);
console.log(`最大单曲        : ${(maxPacked / 1024).toFixed(1)} KB（${maxPackedName}）`);
const legacyEstimate = totalNotes * 6 + index.length * 200;
console.log(`旧 v1 估算体积   : ${(legacyEstimate / 1048576).toFixed(2)} MB（6B/音符 + 头部，仅用于对比）`);
console.log(`相对旧 v1        : ${((1 - totalPacked / legacyEstimate) * 100).toFixed(1)}% 更小`);
console.log(`解压+校验总耗时 : ${totalInflateMs.toFixed(1)} ms（平均 ${(totalInflateMs / index.length).toFixed(2)} ms/首）`);
console.log(`索引构建总耗时  : ${totalIndexMs.toFixed(1)} ms（平均 ${(totalIndexMs / index.length).toFixed(2)} ms/首）`);
console.log(`游戏内导入码    : ${totalChunks} 段（平均 ${(totalChunks / index.length).toFixed(1)} 段/首，最多 ${maxChunks} 段）`);

// SongCache 首次加载全部曲目
const started = performance.now();
let cache = new SongCache(async (id) => {
    const row = rows.find((item) => item.meta.id === id);
    return row?.pbe2;
});
let handles = [];
for (const row of rows) {
    const handle = await cache.acquire(row.meta.id);
    if (handle) handles.push(handle);
}
const loadMs = performance.now() - started;
console.log(`SongCache 全量加载: ${loadMs.toFixed(1)} ms，常驻 ${(cache.bytes / 1048576).toFixed(2)} MB，${cache.size} 首`);
handles.forEach((handle) => handle.release());
console.log(`释放引用后常驻  : ${(cache.bytes / 1048576).toFixed(2)} MB，${cache.size} 首（LRU 预算内保留）`);

// 10 个钢琴共享同一首歌
const big = rows.reduce((a, b) => (a.pbe2.length >= b.pbe2.length ? a : b));
const shared = await cache.acquire(big.meta.id);
const cursors = Array.from({ length: 10 }, () =>
    new EventCursor(shared.song.events, shared.song.index, shared.song.header.hasVelocity)
);
const playStart = performance.now();
let played = 0;
for (let tick = 0; tick <= shared.song.duration; tick++) {
    for (const cursor of cursors) {
        while (cursor.peekTime() <= tick) {
            if (!cursor.next()) break;
            played++;
        }
    }
}
const playMs = performance.now() - playStart;
shared.release();
console.log(`10 钢琴同曲调度  : ${playMs.toFixed(1)} ms，${played.toLocaleString()} 次音符事件（共享 1 份事件流）`);

console.log("=== 完成 ===");
cache = null;
