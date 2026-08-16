import type { MidiTrack } from "../types.js";

/** 打包：缩放后的四元组 number[] → Uint16Array（addon 播放内存格式） */
export function packNotes(notes: number[]): Uint16Array {
    const arr = new Uint16Array(notes.length);
    for (let i = 0; i < notes.length; i++) {
        arr[i] = notes[i];
    }
    return arr;
}

/** 解包：Uint16Array 四元组 → number[]（JSON 传输格式） */
export function unpackNotes(arr: ArrayLike<number>): number[] {
    return Array.from(arr);
}

/** 打包整首曲目的轨道为播放内存格式 */
export function packTracks(song: { tracks: MidiTrack[] }) {
    return song.tracks.map((t) => ({
        instrument: t.instrument,
        notes: packNotes(t.notes),
    }));
}