import { describe, expect, it } from "vitest";
import { midiBufferToSong } from "../src/convert.js";
import { crc32Hex } from "../src/index.js";

/** 手工构造最小 SMF：format 0、1 轨道、division 96；120BPM 下 96 ticks = 0.5s */
function minimalMidi(): Uint8Array {
    const events: number[] = [
        0x00, 0x90, 0x3c, 0x64, // delta0 音符开 60@100
        0x60, 0x80, 0x3c, 0x40, // delta96 音符关 60
        0x00, 0xff, 0x2f, 0x00, // 轨道结束
    ];
    const trackLen = events.length;
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60];
    const track = [
        0x4d, 0x54, 0x72, 0x6b,
        (trackLen >>> 24) & 0xff, (trackLen >>> 16) & 0xff, (trackLen >>> 8) & 0xff, trackLen & 0xff,
        ...events,
    ];
    return new Uint8Array([...header, ...track]);
}

/** 手工构造带 CC64 的最小 SMF：踏板在 Note Off 后 0.25s 抬起 */
function pedaledMidi(): Uint8Array {
    const events: number[] = [
        0x00, 0x90, 0x3c, 0x64, // delta0 音符开 60@100
        0x00, 0xb0, 0x40, 0x7f, // delta0 CC64 踏板踩下
        0x30, 0x80, 0x3c, 0x40, // delta48 音符关 60（0.25s）
        0x30, 0xb0, 0x40, 0x00, // delta48 CC64 踏板抬起（0.5s）
        0x00, 0xff, 0x2f, 0x00, // 轨道结束
    ];
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60];
    const track = [
        0x4d, 0x54, 0x72, 0x6b,
        (events.length >>> 24) & 0xff, (events.length >>> 16) & 0xff,
        (events.length >>> 8) & 0xff, events.length & 0xff,
        ...events,
    ];
    return new Uint8Array([...header, ...track]);
}

describe("midi convert", () => {
    it("最小 SMF 转换：id/名称/时长/音符四元组", () => {
        const bytes = minimalMidi();
        const song = midiBufferToSong(bytes, "测试");
        expect(song.id).toBe(crc32Hex(bytes));
        expect(song.name).toBe("测试");
        expect(song.tracks).toHaveLength(1);
        // 120BPM、division 96：96 ticks = 0.5s → time*40=0；duration*100=50
        // velocity：tonejs 归一化为 100/127 → round(100/127*127)=100（MIDI 标准 0~127）
        expect(song.tracks[0].notes).toEqual([60, 0, 50, 100]);
        // duration: 0.5s * 40 = 20
        expect(song.duration).toBe(20);
    });

    it("带 CC64 踏板时把 Note Off 延长到踏板抬起", () => {
        const song = midiBufferToSong(pedaledMidi(), "踏板测试");
        // 原本 0.25s，踏板在 0.5s 抬起 → duration=50；曲目时长同步到 20 tick
        expect(song.tracks[0].notes).toEqual([60, 0, 50, 100]);
        expect(song.duration).toBe(20);
    });

    it("转换结果可直接编码为 PBE3 模块文本（互操作）", async () => {
        const { midiBufferToSong: convert } = await import("../src/convert.js");
        const { encodePbe3, pbe3ToAddonModule, readPbe3Header } = await import("../src/index.js");
        const { decodeBase64Url } = await import("../src/binary/base64url.js");
        const song = convert(minimalMidi(), "测试");
        const pbe3 = encodePbe3(song);
        const text = pbe3ToAddonModule(pbe3);
        const encoded = JSON.parse(text.slice("export default ".length).replace(/;$/, "")) as string;
        const header = readPbe3Header(decodeBase64Url(encoded));
        expect(header.id).toBe(song.id);
        expect(header.noteCount).toBe(1);
    });
});