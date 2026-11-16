import { expect, mock, test } from "bun:test";
import {
    buildSeekIndex,
    encodePbe2,
    readPbe2Events,
    type MidiSongMeta,
    type SongHandle,
} from "@piano/core";
import { readPlaybackRecord } from "../src/domain/playback/playbackRecord";

const song = { id: "sample", name: "Sample", duration: 400 };

function handleFor(
    info: MidiSongMeta,
    notes = [60, 0, 15, 90, 62, 80, 15, 90, 64, 240, 15, 90]
): SongHandle {
    const pbe2 = encodePbe2({
        id: info.id,
        name: info.name,
        duration: info.duration,
        tracks: [{
            instrument: { family: "", number: 0, name: "" },
            notes,
        }],
    });
    const { header, events } = readPbe2Events(pbe2);
    return {
        song: {
            id: header.id,
            name: header.name,
            duration: header.duration,
            noteCount: header.noteCount,
            header,
            events,
            index: buildSeekIndex(events, header.hasVelocity),
            refCount: 1,
            lastAccess: 0,
            byteSize: events.length,
        },
        release() {},
    };
}

const loader = { acquire: async () => handleFor(song) };
const { MidiPlayer } = await import("../src/domain/playback/player");

const record = readPlaybackRecord(JSON.stringify({
    version: 1, songs: [song, song], index: 1, mode: "loop", state: "playing", seconds: 2,
}))!;

function fixture() {
    const notes: number[] = [];
    const playing = mock(() => {});
    const stopNotes = mock(() => {});
    const midi = new MidiPlayer(loader, {
        note: info => notes.push(info.midi), playing, stopNotes,
    });
    return { midi, notes, playing, stopNotes };
}

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

test("加入队列按来源/ID/指纹去重", () => {
    const { midi } = fixture();
    const ref = { id: "a", name: "A", duration: 40, source: "library" as const, checksum: "1111" };
    expect(midi.addToQueue(ref)).toBe("added");
    expect(midi.addToQueue({ ...ref })).toBe("exists");
    expect(midi.addToQueue({ ...ref, source: "card" as const, cardUid: "c1" })).toBe("added");
    expect(midi.queue.getLength()).toBe(2);
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
