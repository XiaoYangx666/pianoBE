import { describe, expect, it } from "vitest";
import {
    MAX_SUSTAIN_EXTENSION_SECONDS,
    collectSustainSegments,
    sustainExtensionSeconds,
} from "../src/midi/pedal.js";

function track(events: { time: number; value: number }[]) {
    return { controlChanges: { 64: events } };
}

describe("延音踏板（CC64）", () => {
    it("合并多轨踏板事件并生成按下时间段", () => {
        const segments = collectSustainSegments([
            track([{ time: 0, value: 1 }, { time: 2, value: 0 }]),
            track([{ time: 4, value: 0.75 }, { time: 6, value: 0.2 }]),
        ]);
        expect(segments).toEqual([
            { start: 0, end: 2 },
            { start: 4, end: 6 },
        ]);
    });

    it("踏板没有抬起时保持到曲尾", () => {
        const segments = collectSustainSegments([
            track([{ time: 0.5, value: 0.9 }]),
        ]);
        expect(segments).toEqual([{ start: 0.5, end: Infinity }]);
    });

    it("只在 Note Off 落在踏板区间内时延长", () => {
        const segments = [
            { start: 0, end: 2 },
            { start: 4, end: 6 },
        ];
        expect(sustainExtensionSeconds(0.5, segments)).toBeCloseTo(1.5, 6);
        expect(sustainExtensionSeconds(3, segments)).toBe(0); // 两段之间
        expect(sustainExtensionSeconds(2.5, segments)).toBe(0); // 已经抬起
        expect(sustainExtensionSeconds(5.5, segments)).toBeCloseTo(0.5, 6);
    });

    it("延长时间有上限，阻挡异常踏板数据", () => {
        const segments = [{ start: 0, end: 10_000 }];
        expect(sustainExtensionSeconds(1, segments)).toBe(MAX_SUSTAIN_EXTENSION_SECONDS);
        expect(sustainExtensionSeconds(1, segments, 3)).toBe(3);
    });

    it("忽略重复踩下和空事件", () => {
        const segments = collectSustainSegments([
            track([
                { time: 0, value: 1 },
                { time: 1, value: 1 },
                { time: 2, value: 0 },
                { time: 3, value: 0 },
            ]),
        ]);
        expect(segments).toEqual([{ start: 0, end: 2 }]);
        expect(collectSustainSegments([])).toEqual([]);
    });
});
