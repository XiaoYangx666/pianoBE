import { describe, expect, it } from "vitest";
import { ALL_SAMPLES, SAMPLE_KEYS, SAMPLE_DIRS, pianoSamples } from "../src/midi/audioPlayer.js";

describe("audioPlayer 采样清单", () => {
    it("三档 × 30 键 = 90 个采样", () => {
        expect(Object.keys(SAMPLE_DIRS)).toEqual(["piano", "piano_short", "piano_long"]);
        expect(SAMPLE_KEYS).toHaveLength(30);
        expect(ALL_SAMPLES).toHaveLength(90);
        expect(ALL_SAMPLES.filter((s) => s.sample.includes("#")).length).toBe(42);
    });

    it("pianoSamples 按音色返回对应的 90 个目录/键组合", () => {
        const key = (s: { dir: string; sample: string }) => `${s.dir}/${s.sample}`;
        expect(new Set(pianoSamples(0).map(key))).toEqual(new Set(ALL_SAMPLES.map(key)));
        const meta = pianoSamples(1);
        expect(meta).toHaveLength(90);
        expect(new Set(meta.map((s) => s.dir))).toEqual(
            new Set(["meta_piano", "meta_piano_short", "meta_piano_long"])
        );
    });
});
