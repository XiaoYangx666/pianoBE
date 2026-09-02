import type { MidiSong, MidiTrack, MidiTrackInstrument } from "../types.js";

/**
 * MIDI 曲库二进制编解码（曲库只存解析转换后的数据，不存原始 .mid）。
 *
 * 目标：
 * - 体积：与 addon 模块文本（约 15B/音符）相比，二进制固定 6B/音符
 *   （midi u8 + time u16 + dur u16 + vel u8），225 首约从 4.9MB 降到 ~1.5MB，
 *   可以直接进 git 仓库（贡献=放 .mid 跑 convert，提交 <id>.bin + index.json）。
 * - 确定性：内容寻址 id=crc32(原始 midi)，同一输入永远同一产物。
 *
 * 格式（v1，均为小端）：
 *   u8  version
 *   u8  idLen + id utf8
 *   u16 nameLen + name utf8
 *   u32 duration（TIME_SCALE 缩放值）
 *   u8  trackCount
 *   乐器字符串表（按 track 去重，通常 1~3 个）：
 *     u8  tableLen，随后 tableLen 个：u8 strLen + JSON utf8
 *   每轨：
 *     u8  instrument 表索引
 *     u32 noteCount，随后 noteCount × 6B：u8 midi, u16 time, u16 dur, u8 vel
 */

const VERSION = 1;

// TextEncoder/TextDecoder 为 Node/浏览器内置全局；类型由 @piano/core 的
// devDependency @types/node 提供（显式声明，不再依赖传递依赖）
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeSongToBinary(song: MidiSong): Uint8Array {
    const chunks: Uint8Array[] = [];
    const pushU8 = (v: number) => chunks.push(Uint8Array.of(v & 0xff));
    const pushU16 = (v: number) =>
        chunks.push(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff));
    const pushU32 = (v: number) =>
        chunks.push(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff));
    const pushStr = (s: string) => {
        const bytes = textEncoder.encode(s);
        pushU16(bytes.length);
        chunks.push(bytes);
    };

    pushU8(VERSION);
    pushStr(song.id);
    pushStr(song.name);
    pushU32(song.duration >>> 0);
    pushU8(song.tracks.length);

    // 乐器去重表
    const table: string[] = [];
    const tableIndex = new Map<string, number>();
    const trackInstruments: number[] = [];
    for (const track of song.tracks) {
        const json = JSON.stringify(
            track.instrument ?? { family: "", number: 0, name: "" }
        );
        let idx = tableIndex.get(json);
        if (idx === undefined) {
            idx = table.length;
            tableIndex.set(json, idx);
            table.push(json);
        }
        trackInstruments.push(idx);
    }
    pushU8(table.length);
    for (const json of table) pushStr(json);

    for (let t = 0; t < song.tracks.length; t++) {
        const track = song.tracks[t];
        const quadCount = track.notes.length / 4;
        pushU8(trackInstruments[t]);
        pushU32(quadCount);
        const bytes = new Uint8Array(quadCount * 6);
        for (let i = 0; i < quadCount; i++) {
            const q = i * 4;
            const midi = track.notes[q] & 0xff;
            const time = track.notes[q + 1] & 0xffff;
            const dur = track.notes[q + 2] & 0xffff;
            const vel = track.notes[q + 3] & 0xff;
            const off = i * 6;
            bytes[off] = midi;
            bytes[off + 1] = time & 0xff;
            bytes[off + 2] = (time >>> 8) & 0xff;
            bytes[off + 3] = dur & 0xff;
            bytes[off + 4] = (dur >>> 8) & 0xff;
            bytes[off + 5] = vel;
        }
        chunks.push(bytes);
    }

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
    }
    return out;
}

export function decodeSongFromBinary(buf: Uint8Array): MidiSong {
    let pos = 0;
    const readU8 = () => buf[pos++];
    const readU16 = () => {
        const v = buf[pos] | (buf[pos + 1] << 8);
        pos += 2;
        return v;
    };
    const readU32 = () => {
        const v =
            buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24);
        pos += 4;
        return v >>> 0;
    };
    const readStr = () => {
        const len = readU16();
        const s = textDecoder.decode(buf.subarray(pos, pos + len));
        pos += len;
        return s;
    };

    const version = readU8();
    if (version !== VERSION) {
        throw new Error(`[piano-core] 曲库二进制版本不兼容：${version}（期望 ${VERSION}）`);
    }
    const id = readStr();
    const name = readStr();
    const duration = readU32();
    const trackCount = readU8();
    const tableLen = readU8();
    const table: string[] = [];
    for (let i = 0; i < tableLen; i++) table.push(readStr());

    const tracks: MidiTrack[] = [];
    for (let t = 0; t < trackCount; t++) {
        const instIdx = readU8();
        const instrument = JSON.parse(table[instIdx]) as MidiTrackInstrument;
        const noteCount = readU32();
        const notes = new Array<number>(noteCount);
        for (let i = 0; i < noteCount; i++) {
            const off = pos + i * 6;
            notes[i * 4] = buf[off];
            notes[i * 4 + 1] = buf[off + 1] | (buf[off + 2] << 8);
            notes[i * 4 + 2] = buf[off + 3] | (buf[off + 4] << 8);
            notes[i * 4 + 3] = buf[off + 5];
        }
        pos += noteCount * 6;
        tracks.push({ instrument, notes });
    }

    return { id, name, duration, tracks };
}

/** 统计音轨音符总数（index.json 的 noteCount） */
export function countNotes(song: MidiSong): number {
    return song.tracks.reduce((sum, t) => sum + t.notes.length / 4, 0);
}