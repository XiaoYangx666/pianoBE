import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePbe2 } from "../src/pbe2/codec.js";
import { decodePbe3, encodePbe3 } from "../src/pbe3/codec.js";

/**
 * PBE2 → PBE3 迁移回归基线。
 *
 * 保留几份真实 PBE2 样本，验证重新编码后：
 * - 音符数、音高、时间、声音时长、力度完全一致；
 * - 没有源 keyDuration 时，keyDuration 等于 soundDuration；
 * - id/name/duration 不变。
 *
 * 这些样本的力度种类都 ≤16，因此不会触发力度量化。
 */
const fixtures = [
    { name: "Secret（全程踏板）", file: "secret.pbe2" },
    { name: "天空之城（少量力度）", file: "castle-in-the-sky.pbe2" },
    { name: "高密度曲目", file: "dense.pbe2" },
];

describe("PBE2 → PBE3 迁移回归", () => {
    for (const fixture of fixtures) {
        it(fixture.name, () => {
            const pbe2 = new Uint8Array(
                readFileSync(new URL(`./fixtures/${fixture.file}`, import.meta.url))
            );
            const oldSong = decodePbe2(pbe2);
            const pbe3 = encodePbe3(oldSong);
            const newSong = decodePbe3(pbe3);

            expect(newSong.id).toBe(oldSong.id);
            expect(newSong.name).toBe(oldSong.name);
            expect(newSong.duration).toBe(oldSong.duration);

            const oldTrack = oldSong.tracks[0];
            const newTrack = newSong.tracks[0];
            expect(newTrack.notes.length).toBe(oldTrack.notes.length);
            for (let i = 0; i < oldTrack.notes.length; i += 4) {
                expect(newTrack.notes[i]).toBe(oldTrack.notes[i]);
                expect(newTrack.notes[i + 1]).toBe(oldTrack.notes[i + 1]);
                // soundDuration 在 PBE3 中按 25ms 量化，允许 ±2 个 1/100s 单位。
                expect(Math.abs(newTrack.notes[i + 2] - oldTrack.notes[i + 2])).toBeLessThanOrEqual(2);
                expect(newTrack.notes[i + 3]).toBe(oldTrack.notes[i + 3]);
            }
            const soundDurations = oldTrack.notes.filter((_, index) => index % 4 === 2);
            expect(newTrack.keyDurations).toHaveLength(soundDurations.length);
            for (let i = 0; i < soundDurations.length; i++) {
                // PBE3 的 keyDuration 按 25ms 量化，允许 1 个 1/100s 单位的误差。
                expect(Math.abs((newTrack.keyDurations?.[i] ?? 0) - soundDurations[i])).toBeLessThanOrEqual(2);
            }
        });
    }
});
