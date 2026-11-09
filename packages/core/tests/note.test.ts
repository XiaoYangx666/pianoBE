import { describe, expect, it } from "vitest";
import {
    processNote,
    midiToNoteName,
    noteNameToMidi,
    getSoundIdByDuration,
    getSoundLayerByDuration,
    pianoSoundId,
    PIANO_TIMBRES,
    DEFAULT_PIANO_TIMBRE,
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

    it("音色档位映射到独立采样目录", () => {
        expect(PIANO_TIMBRES[0].value).toBe(DEFAULT_PIANO_TIMBRE);
        expect(pianoSoundId(0, "short")).toBe("piano_short");
        expect(pianoSoundId(0, "standard")).toBe("piano");
        expect(pianoSoundId(0, "long")).toBe("piano_long");
        for (const timbre of PIANO_TIMBRES.slice(1)) {
            expect(pianoSoundId(timbre.value, "short")).toBe(`${timbre.id}_short`);
            expect(pianoSoundId(timbre.value, "standard")).toBe(timbre.id);
            expect(pianoSoundId(timbre.value, "long")).toBe(`${timbre.id}_long`);
        }
        expect(getSoundIdByDuration(2, 1)).toBe("meta_piano");
    });

    it("未知音色编号回退到默认音色", () => {
        expect(pianoSoundId(999, "short")).toBe("piano_short");
    });

    it("getSoundLayerByDuration 的边界", () => {
        expect(getSoundLayerByDuration(0.99)).toBe("short");
        expect(getSoundLayerByDuration(1)).toBe("standard");
        expect(getSoundLayerByDuration(4)).toBe("standard");
        expect(getSoundLayerByDuration(4.01)).toBe("long");
    });
});
