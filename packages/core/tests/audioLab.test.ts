import { describe, expect, it } from "vitest";
import {
    LAYER_BOUNDS_2,
    LAYER_BOUNDS_3,
    layerForVelocity,
    noteEnd,
    quantizeTime,
    scheduleMetrics,
    scheduleNotes,
    velocityBuckets,
    velocityGainDb,
    voiceStats,
    type LabNote,
} from "../src/audioLab/model.js";

function note(midi: number, time: number, duration: number, velocity: number): LabNote {
    return { midi, time, duration, velocity };
}

describe("audioLab quantizeTime", () => {
    it("keeps exact time", () => {
        expect(quantizeTime(0.123, "exact")).toBe(0.123);
    });

    it("rounds up to the tick grid like the game loop", () => {
        expect(quantizeTime(0.001, "tick-ceil")).toBeCloseTo(0.05, 9);
        expect(quantizeTime(0.05, "tick-ceil")).toBeCloseTo(0.05, 9);
    });

    it("rounds to nearest and supports one-tick lead", () => {
        expect(quantizeTime(0.074, "tick-round")).toBeCloseTo(0.05, 9);
        expect(quantizeTime(0.076, "tick-round")).toBeCloseTo(0.1, 9);
        expect(quantizeTime(0.074, "tick-round-lead")).toBeCloseTo(0, 9);
        expect(quantizeTime(0.076, "tick-round-lead")).toBeCloseTo(0.05, 9);
    });
});

describe("audioLab velocity", () => {
    it("maps velocity to 3 and 2 layers at the configured bounds", () => {
        expect(LAYER_BOUNDS_3).toEqual([42, 84]);
        expect(layerForVelocity(10 / 127, "layers3")).toBe(0);
        expect(layerForVelocity(42 / 127, "layers3")).toBe(0);
        expect(layerForVelocity(43 / 127, "layers3")).toBe(1);
        expect(layerForVelocity(84 / 127, "layers3")).toBe(1);
        expect(layerForVelocity(85 / 127, "layers3")).toBe(2);
        expect(layerForVelocity(LAYER_BOUNDS_2[0] / 127, "layers2")).toBe(0);
        expect(layerForVelocity((LAYER_BOUNDS_2[0] + 1) / 127, "layers2")).toBe(2);
    });

    it("keeps 0 dB at the reference velocity and stays monotonic", () => {
        expect(velocityGainDb(90 / 127)).toBeCloseTo(0, 6);
        expect(velocityGainDb(40 / 127)).toBeLessThan(velocityGainDb(90 / 127));
        expect(velocityGainDb(120 / 127)).toBeGreaterThan(velocityGainDb(90 / 127));
    });

    it("counts layer usage", () => {
        const buckets = velocityBuckets(
            [note(60, 0, 1, 30 / 127), note(62, 1, 1, 60 / 127), note(64, 2, 1, 100 / 127)],
            "layers3"
        );
        expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1]);
    });
});

describe("audioLab schedule metrics", () => {
    it("detects quantization error and same-tick collisions", () => {
        const notes = [note(60, 0.001, 0.2, 0.8), note(64, 0.049, 0.2, 0.8)];
        const scheduled = scheduleNotes(notes, { mode: "tick-ceil" });
        expect(scheduled.map((item) => item.start)).toEqual([0.05, 0.05]);
        const metrics = scheduleMetrics(scheduled);
        expect(metrics.meanMs).toBeGreaterThan(20);
        expect(metrics.collisions).toBe(1);
        expect(metrics.maxAbsMs).toBeCloseTo(49, 6);
    });

    it("keeps exact scheduling at zero error", () => {
        const scheduled = scheduleNotes([note(60, 0.123, 0.2, 0.8)], { mode: "exact" });
        const metrics = scheduleMetrics(scheduled);
        expect(metrics.meanMs).toBe(0);
        expect(metrics.maxAbsMs).toBe(0);
    });
});

describe("audioLab release", () => {
    it("models the current 0.5/2/4s tier", () => {
        const short = scheduleNotes([note(60, 0, 0.1, 0.8)], { mode: "exact" })[0];
        const medium = scheduleNotes([note(60, 0, 2, 0.8)], { mode: "exact" })[0];
        const long = scheduleNotes([note(60, 0, 5, 0.8)], { mode: "exact" })[0];
        expect(noteEnd(short, { releaseMode: "tier" })).toBeCloseTo(0.5, 6);
        expect(noteEnd(medium, { releaseMode: "tier" })).toBeCloseTo(2, 6);
        expect(noteEnd(long, { releaseMode: "tier" })).toBeCloseTo(4, 6);
    });

    it("reduces tail buildup with note-off release", () => {
        const notes = [
            note(60, 0, 0.09, 0.8),
            note(62, 0.125, 0.09, 0.8),
            note(64, 0.25, 0.09, 0.8),
            note(65, 0.375, 0.09, 0.8),
        ];
        const scheduled = scheduleNotes(notes, { mode: "exact" });
        const tier = voiceStats(scheduled, { releaseMode: "tier" });
        const noteoff = voiceStats(scheduled, { releaseMode: "noteoff", releaseSeconds: 0.12 });
        expect(noteoff.tailRatio).toBeLessThan(tier.tailRatio);
        expect(noteoff.maxVoices).toBeLessThanOrEqual(tier.maxVoices);
    });
});
