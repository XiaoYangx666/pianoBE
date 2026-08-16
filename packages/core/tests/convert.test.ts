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

describe("midi convert", () => {
    it("最小 SMF 转换：id/名称/时长/音符四元组", () => {
        const bytes = minimalMidi();
        const song = midiBufferToSong(bytes, "测试");
        expect(song.id).toBe(crc32Hex(bytes));
        expect(song.name).toBe("测试");
        expect(song.tracks).toHaveLength(1);
        // 120BPM、division 96：96 ticks = 0.5s → time*40=0；duration*100=50
        // velocity：tonejs 归一化为 100/127≈0.79 → round(0.79*100)=79（历史行为一致）
        expect(song.tracks[0].notes).toEqual([60, 0, 50, 79]);
        // duration: 0.5s * 40 = 20
        expect(song.duration).toBe(20);
    });

    it("转换结果可直接生成 addon 模块文本（互操作）", async () => {
        const { midiBufferToSong: convert } = await import("../src/convert.js");
        const { songToAddonModule } = await import("../src/index.js");
        const song = convert(minimalMidi(), "测试");
        const text = songToAddonModule(song);
        expect(text).toContain('id:"' + song.id + '"');
        expect(text).toContain("new Uint16Array([60,0,50,79])");
    });
});