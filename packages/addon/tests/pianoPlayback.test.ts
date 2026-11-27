import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    attachSongPerformance,
    buildPbe3SeekIndex,
    compilePerformanceSource,
    encodePbe3,
    readPbe3Events,
    SongCache,
    type MidiSongMeta,
    type SongHandle,
    type PerformanceCue,
} from "@piano/core";
import { readPlaybackRecord } from "../src/domain/playback/playbackRecord";
import type { PianoTransportEvent } from "../src/domain/playback/visualEvent";

const song = { id: "sample", name: "Sample", duration: 400 };

function handleFor(
    info: MidiSongMeta,
    notes = [60, 0, 15, 90, 62, 80, 15, 90, 64, 240, 15, 90]
): SongHandle {
    const pbe3 = encodePbe3({
        id: info.id,
        name: info.name,
        duration: info.duration,
        tracks: [{
            instrument: { family: "", number: 0, name: "" },
            notes,
        }],
    });
    const { header, events } = readPbe3Events(pbe3);
    return {
        song: {
            id: header.id,
            name: header.name,
            duration: header.duration,
            noteCount: header.noteCount,
            header,
            events,
            palette: header.palette,
            velocityBits: header.velocityBits,
            index: buildPbe3SeekIndex(events, header.velocityBits),
            refCount: 1,
            lastAccess: 0,
            byteSize: events.length,
        },
        release() {},
    };
}

const loader = { acquire: async () => handleFor(song) };
const { MidiPlayer } = await import("../src/domain/playback/player");

test("the same musical data can be queued as ordinary and arranged playback without sharing selection", async () => {
    const trace: PianoTransportEvent[] = [];
    const notes: number[] = [];
    const alternate: PerformanceCue = { op: "flash", tick: 0, effect: "burst", color: "#ABCDEF", level: 90, scale: 100 };
    const midi = new MidiPlayer({ ...loader, performances: () => [[alternate]] }, {
        note: info => notes.push(info.midi), playing() {}, stopNotes() {}, transport: event => trace.push(event),
    });
    const ordinary = { ...song, source: "library" as const, performance: -1 };
    const special = { ...ordinary, performance: 1 };
    const missing = { ...ordinary, performance: 2 };
    expect(midi.addToQueue(ordinary)).toBe("added");
    expect(midi.addToQueue(special)).toBe("added");
    expect(midi.addToQueue(special)).toBe("exists");
    await midi.playNow(special);
    expect(midi.performance?.cues).toEqual([alternate]);
    midi.pause();
    midi.seek(2);
    midi.resume();
    await midi.playNow(ordinary);
    expect(midi.performance).toBeUndefined();
    midi.tick(Date.now() + 25);
    await midi.playNow(missing);
    expect(midi.performance).toBeUndefined();
    midi.tick(Date.now() + 25);
    midi.end();
    expect(notes).toEqual([60, 60]);
    expect(trace.filter(event => event.type === "track")).toHaveLength(3);
});

const record = readPlaybackRecord(JSON.stringify({
    version: 1, songs: [song, song], index: 1, mode: "loop", state: "playing", seconds: 2,
}))!;

test("Secret and a legacy PBE3 use the same player clock across pause, seek, resume and switch", async () => {
    const raw = new Uint8Array(readFileSync(new URL("../../../midis/library/e1563b03.pbe3", import.meta.url)));
    const perfJson = JSON.parse(readFileSync(new URL("../../../midis/performances/e1563b03.json", import.meta.url), "utf8"));
    const data = attachSongPerformance(raw, compilePerformanceSource(perfJson, { expectedSongId: "e1563b03" }));
    const secret = { id: "e1563b03", name: "Secret", duration: 3444 };
    const cache = new SongCache(async id => id === secret.id ? data : undefined);
    const transport: PianoTransportEvent[] = [];
    const notes: number[] = [];
    const midi = new MidiPlayer({ acquire: ref => ref.id === secret.id ? cache.acquire(ref.id) : loader.acquire() }, {
        note: (_info, _duration, _velocity, _gain, time) => notes.push(time),
        playing: () => {}, stopNotes: () => {}, transport: event => transport.push(event),
    });
    await midi.playNow(secret);
    expect(midi.performance?.duration).toBe(86.1);
    expect(midi.performance?.cues.some(cue => cue.op === "flash")).toBe(true);
    midi.pause();
    midi.seek(73.25);
    midi.tick(Date.now() + 100);
    expect(midi.position).toBe(73.25);
    expect(notes).toEqual([]);
    midi.resume();
    let now = Date.now();
    for (let i = 0; i < 12; i++) midi.tick(now += 50);
    expect(midi.position).toBeGreaterThan(73.25);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every(time => time >= 73.25)).toBe(true);
    await midi.playNow(song);
    expect(midi.performance).toBeUndefined();
    expect(midi.position).toBe(0);
    expect(transport.map(event => event.type)).toEqual(["track", "start", "pause", "seek", "resume", "track", "start"]);
    midi.end();
});

function fixture() {
    const notes: number[] = [];
    const playing = mock(() => {});
    const stopNotes = mock(() => {});
    const midi = new MidiPlayer(loader, {
        note: info => notes.push(info.midi), playing, stopNotes,
    });
    return { midi, notes, playing, stopNotes };
}

test("playback checkpoints keep performance selection without copying cue data", () => {
    const { midi } = fixture();
    const ref = {
        ...song,
        source: "library" as const,
        performanceId: "stage:spark",
        performanceEntries: [{ id: "stage:spark", name: "Spark", cues: [] }],
        libraries: ["official:featured"],
    };
    midi.queue.enqueue(ref);
    expect(midi.checkpoint()?.songs).toEqual([{ ...song, source: "library", performanceId: "stage:spark" }]);
    expect(midi.queue.current()).toBe(ref);
});

test("visual output preserves source note time, default velocity and transport boundaries", async () => {
    const transport: PianoTransportEvent[] = [];
    const notes: [number, number, number, boolean][] = [];
    const legacy = handleFor(song);
    const midi = new MidiPlayer({ acquire: async () => legacy }, {
        note: (info, _duration, velocity, _gain, time, hasVelocity) => notes.push([info.midi, time, velocity, hasVelocity]),
        playing: () => {}, stopNotes: () => {}, transport: event => transport.push(event),
    });
    midi.queue.enqueue(song);
    await midi.play();
    midi.tick(Date.now() + 25);
    expect(notes[0]).toEqual([60, 0, 90, true]);
    midi.pause();
    midi.seek(2);
    midi.resume();
    midi.tick(Date.now() + 25);
    await midi.play();
    midi.end();
    expect(notes[1]).toEqual([62, 2, 90, true]);
    expect(transport.map(event => event.type)).toEqual(["track", "start", "pause", "seek", "resume", "track", "start", "stop"]);
    expect(transport[3].position).toBe(2);
});

test("passes soundDuration and keyDuration to the visual output", async () => {
    const notes: { midi: number; time: number; sound?: number; key?: number }[] = [];
    const midi = new MidiPlayer({ acquire: async () => handleFor(song) }, {
        note: (info, sound, _velocity, _gain, time, _hasVelocity, key) =>
            notes.push({ midi: info.midi, time, sound, key }),
        playing: () => {},
        stopNotes: () => {},
    });
    midi.queue.enqueue(song);
    await midi.play();
    midi.tick(Date.now() + 25);

    expect(notes[0]).toEqual({ midi: 60, time: 0, sound: 0.15, key: 0.15 });
});

test("loaded piano resumes the saved song and skips earlier notes", async () => {
    const { midi, notes } = fixture();
    await midi.restore(record);
    expect(midi.checkpoint()).toEqual(record);
    midi.tick(Date.now() + 25);
    expect(notes).toEqual([62]);
});

test("nearest-tick scheduling fires up to half a game tick early", async () => {
    const meta = { id: "near", name: "Near", duration: 40 };
    const emitted: number[] = [];
    const midi = new MidiPlayer(
        { acquire: async () => handleFor(meta, [60, 40, 10, 90]) },
        { note: (info) => emitted.push(info.midi), playing: () => {}, stopNotes: () => {} }
    );
    midi.queue.enqueue(meta);
    await midi.play();

    let now = Date.now();
    for (let i = 0; i < 19; i++) {
        now += 50;
        midi.tick(now);
    }
    // 0.95s：还差 50ms，未进入半个游戏 tick 的提前量。
    expect(emitted).toEqual([]);

    now += 25;
    midi.tick(now);
    // 0.975s：音符在 1.0s，提前 25ms 触发（最近 tick 是 1.0s）。
    expect(emitted).toEqual([60]);
});

test("paused piano retains its cursor until manually resumed", async () => {
    const { midi, notes } = fixture();
    await midi.restore({ ...record, state: "paused" });
    midi.tick(Date.now() + 25);
    expect(notes).toEqual([]);
    expect(midi.checkpoint()?.seconds).toBe(2);
    midi.resume();
    midi.tick(Date.now() + 25);
    expect(notes).toEqual([62]);
});

test("an in-flight restore cannot revive a disposed piano", async () => {
    const { midi, playing } = fixture();
    const restoring = midi.restore(record);
    midi.end();
    await restoring;
    expect(midi.isAlive()).toBe(false);
    expect(midi.checkpoint()).toBeUndefined();
    expect(playing.mock.calls).toEqual([[false]]);
});

test("a disposed piano emits no further notes", async () => {
    const { midi, notes } = fixture();
    await midi.restore(record);
    midi.end();
    midi.tick(Date.now() + 1000);
    expect(notes).toEqual([]);
});

test("two pianos keep independent playback state", async () => {
    const a = fixture();
    const b = fixture();
    await a.midi.restore(record);
    await b.midi.restore({ ...record, state: "paused" });
    a.midi.tick(Date.now() + 25);
    b.midi.tick(Date.now() + 25);
    expect(a.notes).toEqual([62]);
    expect(b.notes).toEqual([]);
    expect(a.midi.checkpoint()?.state).toBe("playing");
    expect(b.midi.checkpoint()?.state).toBe("paused");
});

test("plays through the final note tail before switching songs", async () => {
    const tailNotes = [60, 40, 200, 90];
    const tailMeta = { id: "tail", name: "Tail", duration: 120 };
    const midi = new MidiPlayer(
        { acquire: async () => handleFor(tailMeta, tailNotes) },
        { note: () => {}, playing: () => {}, stopNotes: () => {} }
    );
    midi.queue.enqueue(tailMeta);
    midi.queue.enqueue({ ...tailMeta, id: "next", name: "Next" });
    await midi.play();

    let now = Date.now();
    const advance = (ms: number) => {
        now += ms;
        midi.tick(now);
    };

    // 2.9s：最后一个音已触发（起点 1s），但尾音还没放完，不能切歌。
    for (let i = 0; i < 29; i++) advance(100);
    expect(midi.getInfo().currentTime).toBeCloseTo(2.9, 5);
    expect(midi.getInfo().queueIndex).toBe(0);

    // 3.1s：尾音结束，切到下一首。
    advance(200);
    expect(midi.getInfo().queueIndex).toBe(1);
    expect(midi.getInfo().midiName).toBe("Next");
});

test("seek stops current voices before repositioning", async () => {
    const { midi, stopNotes } = fixture();
    await midi.restore(record);
    stopNotes.mockClear();
    midi.seek(1);
    expect(stopNotes.mock.calls.length).toBe(1);
});

test("pause stops voices immediately", async () => {
    const { midi, stopNotes } = fixture();
    await midi.restore(record);
    stopNotes.mockClear();
    midi.pause();
    expect(stopNotes.mock.calls.length).toBe(1);
});

test("natural end lets the release tail finish instead of hard-stopping", async () => {
    const meta = { id: "single", name: "Single", duration: 40 };
    const stopNotes = mock(() => {});
    const midi = new MidiPlayer(
        { acquire: async () => handleFor(meta, [60, 0, 20, 90]) },
        { note: () => {}, playing: () => {}, stopNotes }
    );
    midi.queue.enqueue(meta);
    await midi.play();
    stopNotes.mockClear();

    let now = Date.now();
    for (let i = 0; i < 12; i++) {
        now += 100;
        midi.tick(now);
    }
    expect(midi.getState()).toBe("idle");
    expect(stopNotes.mock.calls.length).toBe(0);
});

test("立即播放插入当前曲目之后，已有歌曲只跳转不重复", async () => {
    const { midi } = fixture();
    const first = { id: "a", name: "A", duration: 40 };
    const second = { id: "b", name: "B", duration: 40 };
    midi.queue.enqueue(first);
    midi.queue.enqueue(second);
    await midi.play();
    expect(midi.queue.getIndex()).toBe(0);

    const extra = { id: "c", name: "C", duration: 40 };
    await midi.playNow(extra);
    expect(midi.queue.getRefs().map(ref => ref.id)).toEqual(["a", "c", "b"]);
    expect(midi.queue.getIndex()).toBe(1);
    expect(midi.queue.current()?.id).toBe("c");

    await midi.playNow(second);
    expect(midi.queue.getRefs().map(ref => ref.id)).toEqual(["a", "c", "b"]);
    expect(midi.queue.getIndex()).toBe(2);
    expect(midi.queue.current()?.id).toBe("b");
});

test("整卡加入队列不中断播放，并按去重结果统计", () => {
    const { midi } = fixture();
    const current = { id: "current", name: "Current", duration: 40 };
    midi.queue.enqueue(current);
    const refs = [
        { id: "a", name: "A", duration: 40, source: "card" as const, cardUid: "c1", checksum: "11" },
        { id: "b", name: "B", duration: 40, source: "card" as const, cardUid: "c1", checksum: "22" },
        { id: "a", name: "A", duration: 40, source: "card" as const, cardUid: "c1", checksum: "11" },
    ];
    const result = midi.addCollectionToQueue(refs);
    expect(result).toEqual({ added: 2, exists: 1 });
    expect(midi.queue.getRefs().map(ref => ref.id)).toEqual(["current", "a", "b"]);
    expect(midi.queue.getIndex()).toBe(0);
});

test("播放整张存储卡：按顺序补入队列并从第一首开始播放", async () => {
    const { midi } = fixture();
    const original = { id: "original", name: "Original", duration: 40 };
    const a = { id: "a", name: "A", duration: 40, source: "card" as const, cardUid: "c1", checksum: "11" };
    const b = { id: "b", name: "B", duration: 40, source: "card" as const, cardUid: "c1", checksum: "22" };
    midi.queue.enqueue(original);
    // 队列中已有卡片歌曲：整卡播放时去重并重新排成连续块。
    midi.queue.enqueue(b);
    const result = await midi.playCollection([a, b]);
    expect(result).toEqual({ added: 1, exists: 1 });
    expect(midi.queue.getRefs().map(ref => ref.id)).toEqual(["original", "a", "b"]);
    expect(midi.queue.current()?.id).toBe("a");
    expect(midi.getState()).toBe("playing");
});

test("整卡播放不会让队列里后续待播放歌曲被跳过", async () => {
    const { midi } = fixture();
    const ref = (id: string) => ({ id, name: id, duration: 40, source: "card" as const, cardUid: "card-a", checksum: "aa" });
    midi.queue.enqueue({ id: "current", name: "current", duration: 40, source: "library" });
    midi.queue.enqueue({ id: "next", name: "next", duration: 40, source: "library" });
    midi.queue.enqueue(ref("b"));
    midi.queue.enqueue({ id: "last", name: "last", duration: 40, source: "library" });
    await midi.playCollection([ref("a"), ref("b")]);
    expect(midi.queue.getRefs().map(item => item.id)).toEqual(["current", "a", "b", "next", "last"]);
    expect(midi.queue.current()?.id).toBe("a");
    expect(midi.queue.next()?.id).toBe("b");
    expect(midi.queue.next()?.id).toBe("next");
});

test("队列自然结束后立即播放新歌曲不会产生越界索引", async () => {
    const { midi } = fixture();
    const ref = { id: "a", name: "A", duration: 40, source: "library" as const };
    midi.queue.enqueue(ref);
    expect(midi.queue.next()).toBeUndefined();
    await midi.playNow({ ...ref, id: "b", name: "B" });
    expect(midi.queue.current()?.id).toBe("b");
    expect(midi.queue.getIndex()).toBeLessThan(midi.queue.getLength());
});

test("加入队列按来源/ID/指纹去重", () => {
    const { midi } = fixture();
    const ref = { id: "a", name: "A", duration: 40, source: "library" as const, checksum: "1111" };
    expect(midi.addToQueue(ref)).toBe("added");
    expect(midi.addToQueue({ ...ref })).toBe("exists");
    expect(midi.addToQueue({ ...ref, source: "card" as const, cardUid: "c1" })).toBe("added");
    expect(midi.queue.getLength()).toBe(2);
});

test("播放已删除曲目时摘除队列条目并继续后继曲目", async () => {
    const midi = new MidiPlayer({
        acquire: async ref => (ref.id === "gone" ? undefined : handleFor(song)),
    }, { note: () => {}, playing: () => {}, stopNotes: () => {} });
    midi.queue.enqueue({ id: "gone", name: "Gone", duration: 1, source: "library" });
    midi.queue.enqueue({ id: "song-2", name: "Next", duration: 1, source: "library" });

    await midi.play();

    expect(midi.queue.getQueue()).toEqual(["Next"]);
    expect(midi.queue.current()?.id).toBe("song-2");
    expect(midi.getInfo().state).toBe("playing");
    midi.end();
});

test("响度归一化开启后 MIDI 音符带增益，关闭后回到 1", async () => {
    const gains: number[] = [];
    const midi = new MidiPlayer(loader, {
        note: (_note, _duration, _velocity, gain) => gains.push(gain),
        playing: () => {},
        stopNotes: () => {},
    });
    midi.setNormalizeLoudness(true);
    midi.queue.enqueue(song);
    await midi.play();
    midi.tick(Date.now() + 25);

    expect(gains.length).toBeGreaterThan(0);
    expect(gains[0]).toBeCloseTo(10 ** (midi.normalizationGainDb / 20));
    expect(gains[0]).toBeGreaterThan(1);

    midi.setNormalizeLoudness(false);
    midi.seek(0);
    midi.tick(Date.now() + 50);
    expect(gains.at(-1)).toBe(1);
});
