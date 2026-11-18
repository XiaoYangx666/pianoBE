import { describe, expect, it } from "vitest";
import {
    BEDROCK_SIMULTANEOUS_SOUND,
    PIANO_VOICE_BUDGET,
    encodePbe3,
    estimatePbe3VoiceLoad,
    estimateSongVoiceLoad,
    estimateVoiceLoad,
    formatVoiceLoadWarning,
    type MidiSong,
} from "../src/index.js";

function chord(size: number, duration = 1, spread = 0) {
    return Array.from({ length: size }, (_, index) => ({
        midi: 48 + index,
        time: index * spread,
        duration,
    }));
}

describe("声部负载估算", () => {
    it("统计同时发声的峰值与超限时长", () => {
        // 4 个音同时开始、时长 1s，释放 0.2s → 1~1.2s 之间有 4 个实例。
        const estimate = estimateVoiceLoad(chord(4), { releaseSeconds: 0.2, limit: 3 });
        expect(estimate.peakVoices).toBe(4);
        expect(estimate.excess).toBe(1);
        expect(estimate.overLimitSeconds).toBeCloseTo(1.2, 5);
        expect(estimate.peakHandles).toBeGreaterThanOrEqual(4);
    });

    it("首尾相接的音不算同时发声", () => {
        const estimate = estimateVoiceLoad(
            [
                { midi: 60, time: 0, duration: 1 },
                { midi: 64, time: 1, duration: 1 },
            ],
            { releaseSeconds: 0, sampleSeconds: 10 }
        );
        expect(estimate.peakVoices).toBe(1);
    });

    it("短音符在采样自然结束前释放", () => {
        const short = estimateVoiceLoad([{ midi: 60, time: 0, duration: 0.05 }], { releaseSeconds: 0.6 });
        expect(short.peakVoices).toBe(1);
        expect(short.overLimitSeconds).toBe(0);
    });

    it("同键重触发会快速收起旧实例", () => {
        const estimate = estimateVoiceLoad(
            Array.from({ length: 10 }, (_, index) => ({ midi: 60, time: index * 0.02, duration: 1 })),
            { releaseSeconds: 0.6, limit: 1 }
        );
        // 20ms 连击时，旧实例要 40ms 淡出 / 100ms 停止，最多重叠约 5 个。
        expect(estimate.peakVoices).toBeLessThanOrEqual(5);
        expect(estimate.peakVoices).toBeGreaterThanOrEqual(1);
    });

    it("默认阈值与钢琴预算相互独立", () => {
        const estimate = estimateVoiceLoad(chord(30));
        expect(estimate.limit).toBe(BEDROCK_SIMULTANEOUS_SOUND);
        expect(estimate.excess).toBe(0);
        expect(PIANO_VOICE_BUDGET).toBeLessThan(BEDROCK_SIMULTANEOUS_SOUND);
    });

    it("可从 MidiSong 与 PBE3 直接估算", () => {
        const song: MidiSong = {
            id: "voice001",
            name: "声部测试",
            duration: 40 * 2,
            tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [] }],
        };
        for (const note of chord(6, 1)) {
            song.tracks[0].notes.push(note.midi, note.time * 40, note.duration * 100, 90);
        }
        const fromSong = estimateSongVoiceLoad(song, { limit: 4 });
        expect(fromSong.peakVoices).toBe(6);
        expect(fromSong.excess).toBe(2);

        const fromPbe2 = estimatePbe3VoiceLoad(encodePbe3(song), { limit: 4 });
        expect(fromPbe2.peakVoices).toBe(6);
        expect(fromPbe2.peakTime).toBeCloseTo(fromSong.peakTime, 5);
    });

    it("生成可读警告，未超限时不返回", () => {
        expect(formatVoiceLoadWarning(estimateVoiceLoad(chord(40), { limit: 32 }))).toContain("超过游戏上限 32");
        expect(formatVoiceLoadWarning(estimateVoiceLoad(chord(4), { limit: 32 }))).toBeUndefined();
    });
});
