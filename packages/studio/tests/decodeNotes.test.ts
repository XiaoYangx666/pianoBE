import { describe, expect, test } from "bun:test";
import type { CqtMeta } from "../src/amt/cqt";
import { decodeNotes } from "../src/amt/notes";

const meta: CqtMeta = {
    n_bins: 88,
    hop: 256,
    fs: 16_000,
    pitch_low: 21,
    frame_thr: 0.5,
    onset_thr: 0.9,
    min_frames: 3,
    halfband: [],
    octaves: [],
};

describe("decodeNotes", () => {
    test("把 CQT 帧号换算成秒（帧号 × hop / fs）", () => {
        const frames = 1000;
        const frame = new Float32Array(meta.n_bins * frames);
        const onset = new Float32Array(meta.n_bins * frames);
        const row = 69 - meta.pitch_low;

        // 在第 100 帧起音，持续到第 159 帧；每帧 256 / 16000 = 16 ms
        onset[row * frames + 100] = 0.95;
        for (let column = 100; column < 160; column++) {
            frame[row * frames + column] = 1;
        }

        const notes = decodeNotes(frame, onset, meta, frames);
        expect(notes).toHaveLength(1);
        expect(notes[0].pitch).toBe(69);
        expect(notes[0].start).toBeCloseTo(1.6, 6);
        expect(notes[0].end).toBeCloseTo(2.56, 6);
    });
});
