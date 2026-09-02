import { describe, expect, it } from "vitest";
import { ALL_SAMPLES, SAMPLE_KEYS, SAMPLE_DIRS } from "../src/midi/audioPlayer.js";

describe("audioPlayer 采样清单", () => {
    it("三档 × 30 键 = 90 个采样", () => {
        expect(Object.keys(SAMPLE_DIRS)).toEqual(["piano", "piano_short", "piano_long"]);
        expect(SAMPLE_KEYS).toHaveLength(30);
        expect(ALL_SAMPLES).toHaveLength(90);
        expect(ALL_SAMPLES.filter((s) => s.sample.includes("#")).length).toBe(42);
    });
});
