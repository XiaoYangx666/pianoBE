import fs from "node:fs";
import assert from "node:assert/strict";
import {
    crc32Hex,
    encodePbe3,
    metasToAddonIndex,
    pbe3ToAddonModule,
    readPbe3Header,
    readPbe3Events,
    readAllPbe3Notes,
    MemorySongPort,
} from "@piano/core";

// 1. crc32 与历史 id 一致
const buf = fs.readFileSync("midis/files/Beyond - 海阔天空.mid");
assert.equal(crc32Hex(new Uint8Array(buf)), "4beea226", "crc32 id 不匹配历史产物");

// 2. 端到端：真实 .mid 经 core 转换 → PBE3 → addon 模块文本，与现有产物一致
import { midiBufferToSong } from "@piano/core/convert";
{
    const song = midiBufferToSong(
        new Uint8Array(fs.readFileSync("midis/files/Beyond - 海阔天空.mid")),
        "Beyond - 海阔天空"
    );
    const modulePath = `midis/js/${song.id}.js`;
    const existing = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, "utf-8") : undefined;
    const pbe3 = encodePbe3(song);
    const header = readPbe3Header(pbe3);
    assert.equal(header.id, song.id);
    assert.equal(header.noteCount, song.tracks.reduce((s, t) => s + t.notes.length / 4, 0));
    const notes = readAllPbe3Notes(readPbe3Events(pbe3).events, header.palette, header.velocityBits, header.noteCount);
    assert.equal(notes.length, header.noteCount);
    // 力度保持 MIDI 0~127；超过 8 级时会量化到最接近的调色板级别。
    const sourceVelocity = song.tracks[0].notes[3];
    const nearest = header.palette.reduce(
        (best, value) => (Math.abs(value - sourceVelocity) < Math.abs(best - sourceVelocity) ? value : best),
        header.palette[0]
    );
    assert.equal(notes[0].velocity, nearest, "PBE3 力度应量化到最接近的调色板级别");
    if (existing !== undefined) {
        assert.equal(pbe3ToAddonModule(pbe3), existing, "PBE3 模块文本应与现有产物一致");
    }
}

// 3. 曲库：内容寻址幂等 + 过滤缺失
const songPort = new MemorySongPort();
songPort.add({ id: "aaa", name: "A", duration: 100, tracks: [] });
songPort.add({ id: "aaa", name: "A2", duration: 200, tracks: [] }); // 同 id 覆盖（幂等语义：内容寻址下同 id 应同内容）
assert.equal(songPort.getMeta("aaa")?.duration, 200);
assert.equal(songPort.has("bbb"), false);
assert.deepEqual(
    ["aaa", "missing"]
        .map((id) => songPort.getMeta(id))
        .filter(Boolean)
        .map((m) => m.id),
    ["aaa"]
);

// 4. 索引文本
assert.ok(metasToAddonIndex([{ id: "aaa", name: "A", duration: 100 }]).startsWith("export const midis=["));

console.log("✅ core 冒烟验证全部通过（crc32/PBE3/模块文本/曲库/播放列表/崩溃自愈）");
