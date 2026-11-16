import { describe, expect, it } from "vitest";
import { computeNormalizationGainDb } from "../src/midi/audioPlayer.js";
import type { NoteEvent } from "../src/midi/audioPlayer.js";

function notes(count: number, velocity: number, duration = 1): NoteEvent[] {
    return Array.from({ length: count }, () => ({ midi: 60, time: 0, duration, velocity }));
}

describe("逐曲响度归一化", () => {
    it("稀疏弱奏得到正增益，密集强奏得到负增益", () => {
        const quiet = computeNormalizationGainDb(notes(4, 0.4), 10);
        const loud = computeNormalizationGainDb(notes(20, 1.0, 2), 10);
        expect(quiet).toBeGreaterThan(0);
        expect(loud).toBeLessThan(0);
    });

    it("增益限制在配置范围内", () => {
        const quiet = computeNormalizationGainDb(notes(1, 0.05), 120, 8, 8);
        expect(quiet).toBeLessThanOrEqual(8);
        expect(quiet).toBeGreaterThanOrEqual(-8);
        const clamped = computeNormalizationGainDb(notes(1, 0.05), 120, 8, 2);
        expect(clamped).toBeLessThanOrEqual(2);
    });

    it("空曲目或不合法时长返回 0 dB", () => {
        expect(computeNormalizationGainDb([], 10)).toBe(0);
        expect(computeNormalizationGainDb(notes(4, 0.5), 0)).toBe(0);
    });
});
