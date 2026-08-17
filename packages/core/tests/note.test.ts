import { describe, expect, it } from "vitest";
import {
    processNote,
    midiToNoteName,
    noteNameToMidi,
    getSoundIdByDuration,
} from "../src/midi/note.js";

describe("note.ts（采样映射，addon/前端共用）", () => {
    it("midiToNoteName / noteNameToMidi 互逆", () => {
        for (const midi of [21, 40, 60, 69, 84, 108]) {
            expect(noteNameToMidi(midiToNoteName(midi))).toBe(midi);
        }
    });

    it("C4(60) 直接命中基准采样 C4，pitch=1", () => {
        const r = processNote(60, false);
        expect(r.sample).toBe("C4");
        expect(r.pitch).toBe(1);
        expect(r.midi).toBe(60);
    });

    it("基准采样为 C/D#/F#/A：任意音映射到最近的基准", () => {
        const bases = ["C", "D#", "F#", "A"];
        for (let midi = 21; midi <= 108; midi++) {
            const r = processNote(midi, false);
            const name = r.sample.replace(/\d/, "");
            expect(bases).toContain(name);
            // pitch 是 2^(±k/12)，最大变调不超过 3 个半音
            expect(Math.log2(r.pitch)).toBeLessThanOrEqual(3 / 12 + 1e-9);
            expect(Math.log2(r.pitch)).toBeGreaterThanOrEqual(-3 / 12 - 1e-9);
        }
    });

    it("shift=true 升八度（音名 +12）", () => {
        expect(processNote(48, true).midi).toBe(60);
        expect(processNote(48, true).name).toBe("C4");
    });

    it("getSoundIdByDuration 按时长分档", () => {
        expect(getSoundIdByDuration(0.5)).toBe("piano_short");
        expect(getSoundIdByDuration(2)).toBe("piano");
        expect(getSoundIdByDuration(5)).toBe("piano_long");
    });
});
