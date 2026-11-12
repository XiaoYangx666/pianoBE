import { describe, expect, it } from "vitest";
import {
    EventCursor,
    buildSeekIndex,
    encodePbe2,
    readPbe2Events,
    type MidiSong,
} from "../src/index.js";

/**
 * 新旧播放器差分测试。
 * 参考实现 = 旧版 MidiPlayer 的逐轨指针调度（四元组 midi,time,duration,velocity）。
 * 新实现 = PBE2 EventCursor。
 * 用相同的 tick 推进，逐条比较发出的音符。
 */

const STEP_SECONDS = 0.025; // 40 tick/s，1 tick
const SCALE = 40;

interface Emitted {
    step: number;
    midi: number;
    duration: number;
}

function legacyPlay(song: MidiSong, steps: number, startSeconds = 0): Emitted[] {
    const tracks = song.tracks
        .filter((track) => track.notes.length > 0)
        .map((track) => track.notes.slice());
    const indices = tracks.map(() => 0);
    const out: Emitted[] = [];
    let current = startSeconds;

    for (let step = 1; step <= steps; step++) {
        current += STEP_SECONDS;
        const limit = current * SCALE;
        for (;;) {
            let minTime = Infinity;
            let minTrack = -1;
            for (let t = 0; t < tracks.length; t++) {
                const index = indices[t];
                const notes = tracks[t];
                if (index >= notes.length) continue;
                const time = notes[index + 1];
                if (time < minTime) {
                    minTime = time;
                    minTrack = t;
                }
            }
            if (minTrack === -1 || minTime > limit) break;
            const notes = tracks[minTrack];
            const index = indices[minTrack];
            out.push({
                step,
                midi: notes[index],
                duration: notes[index + 2] / 100,
            });
            indices[minTrack] += 4;
        }
    }
    return out;
}

function legacySeek(song: MidiSong, targetSeconds: number): MidiSong["tracks"] {
    const targetTicks = targetSeconds * SCALE;
    return song.tracks.map((track) => {
        let index = 0;
        while (
            index + 1 < track.notes.length &&
            track.notes[index + 1] < targetTicks
        ) {
            index += 4;
        }
        return { ...track, notes: track.notes.slice(index) };
    });
}

function cursorPlay(song: MidiSong, steps: number, startSeconds = 0): Emitted[] {
    const pbe2 = encodePbe2(song);
    const { header, events } = readPbe2Events(pbe2);
    const cursor = new EventCursor(
        events,
        buildSeekIndex(events, header.hasVelocity),
        header.hasVelocity
    );
    if (startSeconds > 0) cursor.seek(startSeconds * SCALE);

    const out: Emitted[] = [];
    let current = startSeconds;
    for (let step = 1; step <= steps; step++) {
        current += STEP_SECONDS;
        const limit = current * SCALE;
        for (;;) {
            const time = cursor.peekTime();
            if (time > limit || time === Infinity) break;
            const note = cursor.next();
            if (!note) break;
            out.push({ step, midi: note.midi, duration: note.duration / 100 });
        }
    }
    return out;
}

function makeSong(
    id: string,
    tracks: number[][],
    duration = 20 * SCALE
): MidiSong {
    return {
        id,
        name: id,
        duration,
        tracks: tracks.map((notes) => ({
            instrument: { family: "piano", number: 0, name: "piano" },
            notes,
        })),
    };
}

const fixtures: Array<{ name: string; song: MidiSong }> = [
    {
        name: "多轨同刻音符 + 交错时间",
        song: makeSong("ties", [
            [60, 0, 100, 90, 64, 800, 100, 80, 67, 1600, 50, 70],
            [48, 0, 120, 60, 62, 400, 100, 50, 72, 800, 100, 50],
            [36, 0, 80, 70, 65, 1200, 90, 60],
        ]),
    },
    {
        name: "单轨长间隔",
        song: makeSong("gaps", [
            [70, 0, 40, 90, 71, 40 * 3, 40, 90, 72, 40 * 7, 200, 90],
        ]),
    },
    {
        name: "空轨混排",
        song: makeSong("empty", [
            [],
            [60, 40, 100, 90],
            [],
            [61, 40, 100, 90, 62, 120, 100, 90],
        ]),
    },
    {
        name: "同轨密集连音",
        song: makeSong("dense", [
            Array.from({ length: 120 }, (_, index) => [
                48 + (index % 24),
                index * 40,
                100,
                90,
            ]).flat(),
        ]),
    },
    {
        name: "零时值/零时长边界",
        song: makeSong("edge", [
            [60, 0, 0, 90, 61, 0, 0, 90, 62, 40, 1, 90],
        ]),
    },
];

describe("新旧播放器调度差分", () => {
    for (const fixture of fixtures) {
        it(`逐 tick 发声音符一致：${fixture.name}`, () => {
            const steps = Math.ceil((fixture.song.duration / SCALE) / STEP_SECONDS) + 4;
            expect(cursorPlay(fixture.song, steps)).toEqual(
                legacyPlay(fixture.song, steps)
            );
        });
    }

    for (const target of [0.5, 2, 7.25]) {
        it(`seek ${target}s 后的发声音符一致`, () => {
            for (const fixture of fixtures) {
                const steps = Math.ceil((fixture.song.duration / SCALE - target)) + 4;
                if (steps <= 0) continue;
                const legacySong: MidiSong = {
                    ...fixture.song,
                    tracks: legacySeek(fixture.song, target),
                };
                expect(cursorPlay(fixture.song, steps, target)).toEqual(
                    legacyPlay(legacySong, steps, target)
                );
            }
        });
    }
});
