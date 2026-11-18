/**
 * 一次性迁移：midis/library/*.pbe2 → *.pbe3 + midis/js/*.js。
 *
 * 602 首有源 MIDI 的重新从源文件转换；剩余 4 首从 PBE2 解码后重编码，
 * keyDuration 取 min(soundDuration, 1s) 作为视觉兜底。
 *
 * 用法：node tools/midi/migrate-pbe3.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    collectSongNoteCount,
    decodePbe3,
    encodePbe3,
    metasToAddonIndex,
    pbe3ToAddonModule,
} from "@piano/core";
import { decodePbe2 } from "@piano/core/pbe2";
import { midiBufferToSong } from "@piano/core/convert";
import { crc32Hex } from "@piano/core";

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = statSync(path);
        if (stat.isDirectory()) out.push(...walk(path));
        else if (/\.midi?$/i.test(name)) out.push(path);
    }
    return out;
}

const roots = [
    "midis/files",
    "E:/Project/muscriptor/Automated-Music-Transcription/out/library/midi",
];
const sources = new Map();
for (const root of roots) {
    for (const path of walk(root)) {
        const id = crc32Hex(new Uint8Array(readFileSync(path)));
        if (!sources.has(id)) sources.set(id, path);
    }
}

const library = JSON.parse(readFileSync("midis/library/index.json", "utf8"));
const metas = [];
let sourceCount = 0;
let fallbackCount = 0;
let notes = 0;
let pbe3Bytes = 0;

for (const meta of library) {
    const source = sources.get(meta.id);
    let song;
    if (source) {
        sourceCount++;
        song = midiBufferToSong(new Uint8Array(readFileSync(source)), meta.name);
    } else {
        const pbe2Path = `midis/library/${meta.id}.pbe2`;
        const pbe3Path = `midis/library/${meta.id}.pbe3`;
        if (existsSync(pbe2Path)) {
            fallbackCount++;
            song = decodePbe2(new Uint8Array(readFileSync(pbe2Path)));
            song.name = meta.name;
            for (const track of song.tracks) {
                track.keyDurations = [];
                for (let i = 0; i + 3 < track.notes.length; i += 4) {
                    track.keyDurations.push(Math.min(track.notes[i + 2], 100));
                }
            }
        } else {
            fallbackCount++;
            song = decodePbe3(new Uint8Array(readFileSync(pbe3Path)));
            song.name = meta.name;
        }
    }
    // 兜底歌曲可能带着旧的 duration；按最后一个音的结束时间补齐。
    let maxEndTicks = 0;
    for (const track of song.tracks) {
        for (let i = 0; i + 3 < track.notes.length; i += 4) {
            const end = track.notes[i + 1] + Math.round((track.notes[i + 2] / 100) * 40);
            maxEndTicks = Math.max(maxEndTicks, end);
        }
    }
    song.duration = Math.max(song.duration, maxEndTicks);
    const pbe3 = encodePbe3(song);
    writeFileSync(`midis/library/${meta.id}.pbe3`, pbe3);
    writeFileSync(`midis/js/${meta.id}.js`, pbe3ToAddonModule(pbe3), "utf-8");
    const noteCount = collectSongNoteCount(song);
    metas.push({
        id: song.id,
        name: song.name,
        duration: song.duration,
        noteCount,
        bytes: pbe3.length,
    });
    notes += noteCount;
    pbe3Bytes += pbe3.length;
}

writeFileSync("midis/js/index.js", metasToAddonIndex(metas), "utf-8");
const sorted = [...metas].sort((a, b) => a.name.localeCompare(b.name, "zh"));
writeFileSync("midis/library/index.json", JSON.stringify(sorted, null, 1) + "\n", "utf-8");

console.log({
    songs: metas.length,
    sourceCount,
    fallbackCount,
    notes,
    pbe3Bytes,
    pbe3MiB: (pbe3Bytes / 1048576).toFixed(2),
});
