import { encodePbe2, estimateSongVoiceLoad, readPbe2Header } from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import type { SongEntry } from "./types";

/** .mid 文件 → 生成器列表条目（转换逻辑统一在 @piano/core，立即编码为 PBE2） */
export async function midiFileToEntry(file: File): Promise<SongEntry> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const song = midiBufferToSong(buffer, file.name.replace(/\.midi?$/i, ""));
    const data = encodePbe2(song, { includeVelocity: true });
    const header = readPbe2Header(data);
    // 导入时顺便算出同时发声峰值，供 UI 提示“会超过游戏 32 音效上限”。
    const voiceLoad = estimateSongVoiceLoad(song);
    return {
        id: header.id,
        name: header.name,
        duration: header.duration,
        noteCount: header.noteCount,
        isOriginal: false,
        data,
        voicePeak: voiceLoad.peakVoices,
    };
}

/** PBE2 字节 → 列表条目 */
export function pbe2ToEntry(
    data: Uint8Array,
    extra: Partial<Pick<SongEntry, "isOriginal" | "fromLibrary" | "moduleText">> = {}
): SongEntry {
    const header = readPbe2Header(data);
    return {
        id: header.id,
        name: header.name,
        duration: header.duration,
        noteCount: header.noteCount,
        isOriginal: false,
        data,
        ...extra,
    };
}
