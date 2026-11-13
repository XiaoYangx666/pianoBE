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
    const midi = new MidiPlayer(loader, {
        note: info => notes.push(info.midi), playing,
    });
    return { midi, notes, playing };
}

test("loaded piano resumes the saved song and skips earlier notes", async () => {
    const { midi, notes } = fixture();
    await midi.restore(record);
    expect(midi.checkpoint()).toEqual(record);
    midi.tick(Date.now() + 25);
    expect(notes).toEqual([62]);
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
    // 最后一个音 1s 起、持续 2s；文件头时长 = 3s（与音尾一致）。
    const tailNotes = [60, 40, 200, 90];
    const tailMeta = { id: "tail", name: "Tail", duration: 120 };
    const midi = new MidiPlayer(
        { acquire: async () => handleFor(tailMeta, tailNotes) },
        { note: () => {}, playing: () => {} }
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
