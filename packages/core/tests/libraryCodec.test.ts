import { describe, expect, it } from "vitest";
import {
    decodeSongFromBinary,
    encodeSongToBinary,
} from "../src/index.js";
import type { MidiSong } from "../src/types.js";

const songA: MidiSong = {
    id: "4beea226",
    name: "Beyond - 海阔天空",
    duration: 14007,
    tracks: [
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [60, 0, 100, 80, 62, 40, 100, 60, 127, 65535, 65535, 100],
        },
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [48, 1000, 500, 30],
        },
    ],
};

describe("libraryCodec 二进制编解码", () => {
    it("往返一致（含重复乐器去重、unicode 名称、边界值）", () => {
        const bin = encodeSongToBinary(songA);
        // 体积：id/name 头 + 12 音符 × 6B + 表；应远小于等价 JS 文本
        const decoded = decodeSongFromBinary(bin);
        expect(decoded).toEqual(songA);
        // 6B/音符验证：12 + 4 个音符
        expect(bin.length).toBeLessThan(songA.tracks[0].notes.length * 6 + 200);
    });

    it("多乐器表 + 空音符轨", () => {
        const song: MidiSong = {
            id: "abc",
            name: "多乐器与空轨",
            duration: 0,
            tracks: [
                { instrument: { family: "guitar", number: 24, name: "acoustic guitar (nylon)" }, notes: [] },
                { instrument: { family: "piano", number: 0, name: "acoustic grand piano" }, notes: [60, 1, 2, 3] },
                { instrument: { family: "guitar", number: 24, name: "acoustic guitar (nylon)" }, notes: [] },
            ],
        };
        expect(decodeSongFromBinary(encodeSongToBinary(song))).toEqual(song);
    });

    it("版本不兼容报错", () => {
        const bin = encodeSongToBinary(songA);
        bin[0] = 99;
        expect(() => decodeSongFromBinary(bin)).toThrow(/版本不兼容/);
    });

    it("225 首真实曲库可整体编解码（回归）", async () => {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = path.resolve(process.cwd(), "midis/library");
        if (!fs.existsSync(dir)) return; // 未生成曲库时跳过
        const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
        expect(index.length).toBeGreaterThan(200);
        let notes = 0;
        for (const meta of index) {
            const bin = fs.readFileSync(path.join(dir, `${meta.id}.bin`));
            const song = decodeSongFromBinary(new Uint8Array(bin));
            expect(song.id).toBe(meta.id);
            expect(song.name).toBe(meta.name);
            expect(song.duration).toBe(meta.duration);
            notes += song.tracks.reduce((s, t) => s + t.notes.length / 4, 0);
        }
        expect(notes).toBeGreaterThan(100_000);
    });
});