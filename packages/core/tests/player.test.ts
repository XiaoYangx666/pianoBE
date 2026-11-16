import { describe, expect, it } from "vitest";
import { ALL_SAMPLES, SAMPLE_KEYS, SAMPLE_DIRS, pianoSamples } from "../src/midi/audioPlayer.js";

describe("audioPlayer 采样清单", () => {
    it("默认音色三层 × 30 键 = 90 个采样", () => {
        expect(SAMPLE_DIRS).toEqual(["piano_v1", "piano_v2", "piano_v3"]);
        expect(SAMPLE_KEYS).toHaveLength(30);
        expect(ALL_SAMPLES).toHaveLength(90);
        expect(ALL_SAMPLES.filter((s) => s.sample.includes("#")).length).toBe(42);
    });

    it("pianoSamples 按音色返回对应层数的目录/键组合", () => {
        const key = (s: { dir: string; sample: string }) => `${s.dir}/${s.sample}`;
        expect(new Set(pianoSamples(0).map(key))).toEqual(new Set(ALL_SAMPLES.map(key)));
        const classic = pianoSamples(1);
        expect(classic).toHaveLength(90);
        expect(new Set(classic.map((s) => s.dir))).toEqual(
            new Set(["classic_grand_v1", "classic_grand_v2", "classic_grand_v3"])
        );
        // 明亮三角目前只有单层母带
        expect(new Set(pianoSamples(2).map((s) => s.dir))).toEqual(new Set(["bright_grand_v1"]));
        expect(new Set(pianoSamples(3).map((s) => s.dir))).toEqual(new Set(["upright_v1", "upright_v2"]));
    });
});
