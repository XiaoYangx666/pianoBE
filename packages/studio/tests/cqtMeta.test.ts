import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CqtMeta } from "../src/amt/cqt";

const meta = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../../assets/amt/cqt_meta.json"), "utf8")
) as CqtMeta;

describe("AMT CQT 参数", () => {
    test("覆盖 88 个钢琴音高且八度不重叠", () => {
        expect(meta.n_bins).toBe(88);
        expect(meta.hop).toBe(256);
        expect(meta.fs).toBe(16_000);
        expect(meta.octaves).toHaveLength(8);
        expect(meta.octaves.reduce((sum, octave) => sum + octave.n_rows, 0)).toBe(88);

        const occupied = new Set<number>();
        for (const octave of meta.octaves) {
            expect(octave.row_start + octave.n_rows).toBeLessThanOrEqual(meta.n_bins);
            for (let row = 0; row < octave.n_rows; row++) {
                const index = octave.row_start + row;
                expect(occupied.has(index)).toBe(false);
                occupied.add(index);
                expect(octave.entries.some((entry) => entry[0] === row)).toBe(true);
            }
        }
        expect(occupied.size).toBe(88);
    });

    test("半带滤波器可供浏览器端抽取使用", () => {
        expect(meta.halfband).toHaveLength(15);
        expect(meta.halfband.every((value) => Number.isFinite(value))).toBe(true);
    });
});
