import { describe, expect, it } from "vitest";
import {
    processNote,
    midiToNoteName,
    noteNameToMidi,
    getSoundIdByVelocity,
    velocityLayerIndex,
    velocityVolume,
    pianoSoundId,
    pianoSoundLayers,
    pianoSoundDirs,
    PIANO_TIMBRES,
    PIANO_TIMBRE_VELOCITY,
    DEFAULT_PIANO_TIMBRE,
} from "../src/midi/note.js";

describe("note.ts：音符映射，addon/前端共用", () => {
    it("midiToNoteName / noteNameToMidi 互逆", () => {
        for (const midi of [21, 40, 60, 69, 84, 108]) {
            expect(noteNameToMidi(midiToNoteName(midi))).toBe(midi);
        }
    });

    it("C4(60) 直接命中采样基准音 C4，pitch=1", () => {
        const r = processNote(60, false);
        expect(r.sample).toBe("C4");
        expect(r.pitch).toBe(1);
        expect(r.midi).toBe(60);
    });

    it("采样基准为 C/D#/F#/A，任意音符映射到最近的基准", () => {
        const bases = ["C", "D#", "F#", "A"];
        for (let midi = 21; midi <= 108; midi++) {
            const r = processNote(midi, false);
            const name = r.sample.replace(/\d/, "");
            expect(bases).toContain(name);
            // pitch 在 2^(-3/12) 与 2^(3/12) 之间
            expect(Math.log2(r.pitch)).toBeLessThanOrEqual(3 / 12 + 1e-9);
            expect(Math.log2(r.pitch)).toBeGreaterThanOrEqual(-3 / 12 - 1e-9);
        }
    });

    it("shift=true 升八度，即 +12", () => {
        expect(processNote(48, true).midi).toBe(60);
        expect(processNote(48, true).name).toBe("C4");
    });

    it("力度层分界与音色层数一致", () => {
        // classic_grand：三层 42/84
        expect(velocityLayerIndex(1, 1)).toBe(0);
        expect(velocityLayerIndex(42, 1)).toBe(0);
        expect(velocityLayerIndex(43, 1)).toBe(1);
        expect(velocityLayerIndex(84, 1)).toBe(1);
        expect(velocityLayerIndex(85, 1)).toBe(2);
        expect(velocityLayerIndex(127, 1)).toBe(2);

        // upright：两层 64
        expect(velocityLayerIndex(64, 3)).toBe(0);
        expect(velocityLayerIndex(65, 3)).toBe(1);

        // bright_grand：单层永远落在 0
        expect(velocityLayerIndex(1, 2)).toBe(0);
        expect(velocityLayerIndex(127, 2)).toBe(0);
    });

    it("力度音量以 90 为参考，弱奏更轻、强奏更响", () => {
        expect(velocityVolume(90)).toBeCloseTo(1, 6);
        expect(velocityVolume(45)).toBeLessThan(0.5);
        expect(velocityVolume(127)).toBeGreaterThan(1.5);
        expect(velocityVolume(0)).toBe(0);
    });

    it("音色 + 力度层映射到采样目录", () => {
        expect(PIANO_TIMBRES[0].value).toBe(DEFAULT_PIANO_TIMBRE);
        expect(pianoSoundId(0, 0)).toBe("piano_v1");
        expect(pianoSoundId(0, 1)).toBe("piano_v2");
        expect(pianoSoundId(0, 2)).toBe("piano_v3");
        expect(pianoSoundId(1, 1)).toBe("classic_grand_v2");
        expect(pianoSoundId(3, 1)).toBe("upright_v2");
        expect(getSoundIdByVelocity(65, 3)).toBe("upright_v2");
        expect(getSoundIdByVelocity(65, 1)).toBe("classic_grand_v2");
    });

    it("立体声模式使用 _stereo 变体，默认使用 3D 变体", () => {
        expect(pianoSoundId(0, 0, true)).toBe("piano_v1_stereo");
        expect(pianoSoundId(1, 2, true)).toBe("classic_grand_v3_stereo");
        expect(getSoundIdByVelocity(90, 0, true)).toBe("piano_v3_stereo");
        expect(getSoundIdByVelocity(90, 0)).toBe("piano_v3");
    });

    it("未知音色编号回落到默认音色", () => {
        expect(pianoSoundId(999, 0)).toBe("piano_v1");
        expect(pianoSoundId(999, 0, true)).toBe("piano_v1_stereo");
        expect(velocityLayerIndex(90, 999)).toBe(2);
    });

    it("音色层数与目录清单一致", () => {
        expect(pianoSoundLayers(2)).toEqual([0]);
        expect(pianoSoundDirs(3)).toEqual(["upright_v1", "upright_v2"]);
        expect(pianoSoundDirs(1)).toHaveLength(PIANO_TIMBRE_VELOCITY.classic_grand.layers);
    });
});
