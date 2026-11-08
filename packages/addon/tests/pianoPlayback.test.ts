import { expect, mock, test } from "bun:test";
import type { Dimension } from "@minecraft/server";
import { readPlaybackRecord } from "../src/piano/playbackRecord";

const song = { id: "sample", name: "Sample", duration: 400 };
let loadSong = async () => ({
    ...song,
    tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [60, 0, 15, 90, 62, 80, 15, 90, 64, 240, 15, 90] }],
});
mock.module("@midiPlayer", () => ({ midiManager: { load: () => loadSong() } }));
const { MidiPlayer } = await import("../src/midiPlayer/player");

const record = readPlaybackRecord(JSON.stringify({
    version: 1, songs: [song, song], index: 1, mode: "loop", state: "playing", seconds: 2,
}))!;

function fixture() {
    const notes: number[] = [];
    const playing = mock(() => {});
    const midi = new MidiPlayer({} as Dimension, { x: 0, y: 0, z: 0 }, "north", {
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
