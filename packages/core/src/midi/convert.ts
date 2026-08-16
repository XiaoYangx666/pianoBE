import pkg from "@tonejs/midi";
import { OTHER_SCALE, TIME_SCALE } from "../constants.js";
import { crc32Hex } from "./crc32.js";
import type { MidiSong, MidiTrack, MidiTrackInstrument } from "../types.js";

const { Midi } = pkg;

/** 从 .mid 二进制解析出可序列化的 MidiSong（id = crc32(内容)，与历史产物一致） */
export function midiBufferToSong(buffer: Uint8Array, name: string): MidiSong {
    const midi = new Midi(buffer);
    const id = crc32Hex(new Uint8Array(buffer));

    const tracks: MidiTrack[] = midi.tracks.map((track) => {
        const notes: number[] = [];
        for (const n of track.notes) {
            notes.push(
                n.midi,
                Math.floor(n.time * TIME_SCALE),
                Math.round(n.duration * OTHER_SCALE),
                Math.round(n.velocity * OTHER_SCALE)
            );
        }
        return {
            instrument: track.instrument as unknown as MidiTrackInstrument,
            notes,
        };
    });

    return {
        id,
        name,
        duration: Math.round(midi.duration * TIME_SCALE),
        tracks,
    };
}