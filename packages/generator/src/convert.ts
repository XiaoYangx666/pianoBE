import { midiBufferToSong } from "@piano/core/convert";
import type { SongEntry } from "./types";

/** .mid 文件 → 生成器列表条目（转换逻辑统一在 @piano/core） */
export async function midiFileToEntry(file: File): Promise<SongEntry> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const song = midiBufferToSong(buffer, file.name.replace(/\.midi?$/i, ""));
    const noteCount = song.tracks.reduce((sum, t) => sum + t.notes.length / 4, 0);
    return {
        id: song.id,
        name: song.name,
        duration: song.duration,
        noteCount,
        isOriginal: false,
        song,
    };
}