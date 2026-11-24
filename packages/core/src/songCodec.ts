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
    reidentifyPbe3,
    renamePbe3,
    type EncodePbe3Options,
} from "./pbe3/codec.js";
import type { PerformanceCue } from "./pbe3/performance.js";
import { Pbe3EventCursor } from "./pbe3/seekIndex.js";
import type { Pbe3Header, Pbe3Note, Pbe3NoteEvent } from "./pbe3/format.js";
import { validateMusic, type ValidatedMusic } from "./music/validate.js";
import type { MusicStorageLimits } from "./music/limits.js";
import { pbe3ToAddonModule } from "./midi/addonModule.js";
import { crc32, crc32Hex } from "./midi/crc32.js";
import { encodeUtf8 } from "./binary/utf8.js";

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

export function reidentifySong(bytes: Uint8Array, id: string): Uint8Array {
    if (!/^[a-f0-9]{1,8}$/.test(id)) throw new Error("无效的歌曲 ID");
    return reidentifyPbe3(bytes, id);
}

export function findFreeSongId(bytes: Uint8Array, occupied: (id: string) => boolean): string {
    const header = readPbe3Header(bytes);
    let id = header.id;
    let salt = 0;
    while (occupied(id)) id = crc32Hex(encodeUtf8(`${header.id}:${header.checksum}:${salt++}`));
    return id;
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

/**
 * 基于规范化音乐本体计算内容指纹（16 位小写十六进制）。
 * 只依赖时长、音符数以及每个音符的 (time, midi, soundDuration, keyDuration, velocity)，
 * 与曲名、歌曲 ID、PBE3 压缩策略及演出区块完全无关。
 */
export function computeMusicFingerprint(bytes: Uint8Array): string {
    const header = readPbe3Header(bytes);
    const notes = readAllSongNotes(bytes);
    const buf = new Uint8Array(8 + notes.length * 14);
    const view = new DataView(buf.buffer);
    view.setUint32(0, header.duration >>> 0, true);
    view.setUint32(4, notes.length >>> 0, true);
    let offset = 8;
    for (const note of notes) {
        view.setUint32(offset, note.time >>> 0, true);
        view.setUint32(offset + 4, note.soundDuration >>> 0, true);
        view.setUint32(offset + 8, note.keyDuration >>> 0, true);
        buf[offset + 12] = note.midi & 0x7f;
        buf[offset + 13] = note.velocity & 0x7f;
        offset += 14;
    }
    const c = crc32(buf);
    let fnv = 0x811c9dc5;
    for (let i = 0; i < buf.length; i++) {
        fnv ^= buf[i];
        fnv = Math.imul(fnv, 0x01000193) >>> 0;
    }
    return `${c.toString(16).padStart(8, "0")}${fnv.toString(16).padStart(8, "0")}`;
}

/** 只在比对候选曲目时解码音符。压缩方式、曲名、原始 MIDI ID 和演出均不参与比较。 */
export function sameSongMusic(a: Uint8Array, b: Uint8Array): boolean {
    if (a === b) return true;
    const left = readPbe3Header(a);
    const right = readPbe3Header(b);
    if (left.duration !== right.duration || left.noteCount !== right.noteCount) return false;
    const x = readAllSongNotes(a);
    const y = readAllSongNotes(b);
    if (x.length !== y.length) return false;
    return x.every((note, index) => {
        const other = y[index];
        return note.time === other.time && note.midi === other.midi && note.velocity === other.velocity
            && note.keyDuration === other.keyDuration && note.soundDuration === other.soundDuration;
    });
}

/** 以 PBE3 自身的规范化编码比较编排，忽略对象字段顺序和区块压缩差异。 */
export function sameSongPerformance(
    base: Uint8Array, left: readonly PerformanceCue[], right: readonly PerformanceCue[],
): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    const a = attachPbe3Performance(base, left);
    const b = attachPbe3Performance(base, right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
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
