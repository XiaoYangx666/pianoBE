import type { MidiSong } from "./types.js";
import type { LoadedSong } from "./pbe3/songCache.js";
import {
    attachPbe3Performance,
    decodePbe3,
    encodePbe3,
    pbe3ToNoteEvents,
    readAllPbe3Notes,
    readPbe3Events,
    readPbe3Header,
    renamePbe3,
    type EncodePbe3Options,
} from "./pbe3/codec.js";
import type { PerformanceCue } from "./pbe3/performance.js";
import { Pbe3EventCursor } from "./pbe3/seekIndex.js";
import type { Pbe3Header, Pbe3Note, Pbe3NoteEvent } from "./pbe3/format.js";
import { validateMusic, type ValidatedMusic } from "./music/validate.js";
import type { MusicStorageLimits } from "./music/limits.js";
import { pbe3ToAddonModule } from "./midi/addonModule.js";

/**
 * 曲目二进制格式的统一门面。
 *
 * 只有 `pbe3/*` 和 `music/*` 需要知道 PBE3 的字节布局；播放器、生成器、
 * 服务端、工具都通过这里访问，未来换格式时不需要再改一圈调用点。
 */
export type SongHeader = Pbe3Header;
export type SongNote = Pbe3Note;
export type SongNoteEvent = Pbe3NoteEvent;

/** MidiSong → 音符总数 */
export function collectSongNoteCount(song: MidiSong): number {
    return song.tracks.reduce((sum, track) => sum + Math.floor(track.notes.length / 4), 0);
}

/** MidiSong → 曲目二进制 */
export function encodeSong(song: MidiSong, options?: EncodePbe3Options): Uint8Array {
    return encodePbe3(song, options);
}

export function attachSongPerformance(bytes: Uint8Array, cues: readonly PerformanceCue[]): Uint8Array {
    return attachPbe3Performance(bytes, cues);
}

/** 曲目二进制 → MidiSong（单轨视图，用于预览/测试/离线工具） */
export function decodeSong(bytes: Uint8Array): MidiSong {
    return decodePbe3(bytes);
}

/** 只读头部，不解压事件流 */
export function readSongHeader(bytes: Uint8Array): SongHeader {
    return readPbe3Header(bytes);
}

/** 读取并解压事件流 */
export function readSongEvents(bytes: Uint8Array) {
    return readPbe3Events(bytes);
}

/** 曲目二进制 → 全部音符（含 soundDuration / keyDuration / velocity） */
export function readAllSongNotes(bytes: Uint8Array): SongNote[] {
    const { header, events } = readPbe3Events(bytes);
    return readAllPbe3Notes(events, header.palette, header.velocityBits, header.noteCount);
}

/** 已加载曲目 → 全部音符（复用共享事件流，不重复解压） */
export function readLoadedSongNotes(song: LoadedSong): SongNote[] {
    return readAllPbe3Notes(song.events, song.header.palette, song.header.velocityBits, song.header.noteCount);
}

/** 曲目二进制 → 秒制音符事件 */
export function songToNoteEvents(bytes: Uint8Array): SongNoteEvent[] {
    return pbe3ToNoteEvents(bytes);
}

/** 修改曲名并重新编码 */
export function renameSong(bytes: Uint8Array, name: string): Uint8Array {
    return renamePbe3(bytes, name);
}

/** 写入存储前的完整校验 */
export function validateSong(
    bytes: Uint8Array,
    limits?: MusicStorageLimits
): ValidatedMusic {
    return validateMusic(bytes, limits);
}

/** 为已加载曲目创建独立播放光标（多个钢琴共享同一份事件流） */
export function createSongCursor(song: LoadedSong): Pbe3EventCursor {
    return new Pbe3EventCursor(song.events, song.index, song.palette, song.velocityBits);
}

/** 曲目二进制 → addon 内嵌模块文本（Base64URL） */
export function songToAddonModule(bytes: Uint8Array): string {
    return pbe3ToAddonModule(bytes);
}
