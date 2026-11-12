import { deflateSync, inflateSync } from "fflate";
import type { MidiSong } from "../types.js";
import { crc32 } from "../midi/crc32.js";
import {
    MAX_PBE2_EVENT_BYTES,
    PBE2_FLAG_COMPRESSED,
    PBE2_FLAG_VELOCITY,
    PBE2_MAGIC,
    PBE2_VERSION,
    type Pbe2Header,
    type Pbe2Note,
    type Pbe2NoteEvent,
} from "./format.js";
import { readVarUint, varUintSize, writeVarUint, type VarintResult } from "./varint.js";
import { decodeUtf8, encodeUtf8 } from "./utf8.js";

export interface EncodePbe2Options {
    /** 是否编码力度字段（默认省略，播放器不需要） */
    includeVelocity?: boolean;
    /** 压缩策略：auto = 压缩后更小才使用（默认）；false = 永不压缩 */
    compress?: boolean | "auto";
    /** DEFLATE 等级 0~9（默认 9） */
    level?: number;
}

interface EncodedNote {
    time: number;
    midi: number;
    duration: number;
    velocity: number;
    order: number;
}

/** 可增长字节写入器 */
class ByteWriter {
    private buffer: Uint8Array;
    offset = 0;

    constructor(size: number) {
        this.buffer = new Uint8Array(Math.max(16, size));
    }

    private ensure(extra: number) {
        const need = this.offset + extra;
        if (need <= this.buffer.length) return;
        let next = this.buffer.length * 2;
        while (next < need) next *= 2;
        const grown = new Uint8Array(next);
        grown.set(this.buffer.subarray(0, this.offset));
        this.buffer = grown;
    }

    put(value: number) {
        this.ensure(1);
        this.buffer[this.offset++] = value & 0xff;
    }

    varUint(value: number) {
        this.ensure(5);
        this.offset = writeVarUint(this.buffer, this.offset, value);
    }

    bytes(value: Uint8Array) {
        this.ensure(value.length);
        this.buffer.set(value, this.offset);
        this.offset += value.length;
    }

    finish(): Uint8Array {
        return this.buffer.slice(0, this.offset);
    }
}

function collectNotes(song: MidiSong): EncodedNote[] {
    const notes: EncodedNote[] = [];
    let order = 0;
    for (const track of song.tracks) {
        const values = track.notes;
        for (let i = 0; i + 3 < values.length; i += 4) {
            const time = Math.max(0, Math.round(values[i + 1]));
            const midi = Math.max(0, Math.min(127, Math.round(values[i])));
            const duration = Math.max(0, Math.round(values[i + 2]));
            const velocity = Math.max(0, Math.min(127, Math.round(values[i + 3])));
            notes.push({ time, midi, duration, velocity, order: order++ });
        }
    }
    notes.sort((a, b) => a.time - b.time || a.order - b.order);
    return notes;
}

/** 编码事件流（未压缩）。分组头 = 时间差 + 组内音符数。 */
export function encodePbe2Events(song: MidiSong, includeVelocity = false): Uint8Array {
    const notes = collectNotes(song);
    let size = 0;
    let index = 0;
    let previousTime = 0;
    while (index < notes.length) {
        const time = notes[index].time;
        let end = index + 1;
        while (end < notes.length && notes[end].time === time) end++;
        size += varUintSize(time - previousTime) + varUintSize(end - index);
        for (let i = index; i < end; i++) {
            size += 1 + varUintSize(notes[i].duration);
            if (includeVelocity) size += varUintSize(notes[i].velocity);
        }
        previousTime = time;
        index = end;
    }

    const writer = new ByteWriter(size);
    index = 0;
    previousTime = 0;
    while (index < notes.length) {
        const time = notes[index].time;
        let end = index + 1;
        while (end < notes.length && notes[end].time === time) end++;
        writer.varUint(time - previousTime);
        writer.varUint(end - index);
        for (let i = index; i < end; i++) {
            const note = notes[i];
            writer.put(note.midi);
            writer.varUint(note.duration);
            if (includeVelocity) writer.varUint(note.velocity);
        }
        previousTime = time;
        index = end;
    }
    return writer.finish();
}

function pushString(writer: ByteWriter, value: string) {
    const bytes = encodeUtf8(value);
    if (bytes.length > 0xffff) throw new Error("[pbe2] 字符串字段超过 65535 字节");
    writer.put(bytes.length & 0xff);
    writer.put((bytes.length >>> 8) & 0xff);
    writer.bytes(bytes);
}

function pushU32(writer: ByteWriter, value: number) {
    const v = value >>> 0;
    writer.put(v & 0xff);
    writer.put((v >>> 8) & 0xff);
    writer.put((v >>> 16) & 0xff);
    writer.put((v >>> 24) & 0xff);
}

/** 把 MidiSong（转换中间结构）编码为 PBE2 二进制 */
export function encodePbe2(song: MidiSong, options: EncodePbe2Options = {}): Uint8Array {
    const includeVelocity = options.includeVelocity === true;
    const events = encodePbe2Events(song, includeVelocity);
    const requested = options.compress ?? "auto";
    let payload = events;
    let compressed = false;
    if (requested !== false) {
        const packed = deflateSync(events, {
            level: (options.level ?? 9) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
        });
        if (requested === true || packed.length + 8 < events.length) {
            payload = packed;
            compressed = true;
        }
    }

    const writer = new ByteWriter(256 + payload.length);
    writer.bytes(Uint8Array.from(PBE2_MAGIC));
    writer.put(PBE2_VERSION);
    writer.put((compressed ? PBE2_FLAG_COMPRESSED : 0) | (includeVelocity ? PBE2_FLAG_VELOCITY : 0));
    pushString(writer, song.id);
    pushString(writer, song.name);
    pushU32(writer, song.duration);
    pushU32(writer, collectNoteCount(song));
    pushU32(writer, events.length);
    pushU32(writer, crc32(events));
    writer.bytes(payload);
    return writer.finish();
}

export function collectNoteCount(song: MidiSong): number {
    let count = 0;
    for (const track of song.tracks) count += Math.floor(track.notes.length / 4);
    return count;
}

function readU32(data: Uint8Array, offset: number): number {
    if (offset + 4 > data.length) throw new Error("[pbe2] 文件头被截断");
    return (
        (data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24)) >>>
        0
    );
}

function readString(data: Uint8Array, offset: number): { value: string; next: number } {
    if (offset + 2 > data.length) throw new Error("[pbe2] 字符串长度被截断");
    const length = data[offset] | (data[offset + 1] << 8);
    const start = offset + 2;
    const end = start + length;
    if (end > data.length) throw new Error("[pbe2] 字符串内容被截断");
    return { value: decodeUtf8(data.subarray(start, end)), next: end };
}

/** 只读文件头（不解压、不解码事件），列表/搜索/校验使用 */
export function readPbe2Header(data: Uint8Array): Pbe2Header {
    if (data.length < 10) throw new Error("[pbe2] 文件过短");
    for (let i = 0; i < 4; i++) {
        if (data[i] !== PBE2_MAGIC[i]) throw new Error("[pbe2] 魔数不匹配");
    }
    const version = data[4];
    if (version !== PBE2_VERSION) {
        throw new Error(`[pbe2] 版本不兼容：${version}（期望 ${PBE2_VERSION}）`);
    }
    const flags = data[5];
    const id = readString(data, 6);
    const name = readString(data, id.next);
    const fixed = name.next;
    const duration = readU32(data, fixed);
    const noteCount = readU32(data, fixed + 4);
    const uncompressedLength = readU32(data, fixed + 8);
    const checksum = readU32(data, fixed + 12);
    const eventOffset = fixed + 16;
    if (eventOffset > data.length) throw new Error("[pbe2] 事件流偏移越界");
    return {
        id: id.value,
        name: name.value,
        duration,
        noteCount,
        uncompressedLength,
        checksum,
        flags,
        compressed: (flags & PBE2_FLAG_COMPRESSED) !== 0,
        hasVelocity: (flags & PBE2_FLAG_VELOCITY) !== 0,
        eventOffset,
        byteLength: data.length,
    };
}

export interface ReadPbe2EventsOptions {
    /** 是否校验长度与 CRC32（默认 true） */
    verify?: boolean;
}

/**
 * 读取未压缩事件流。DEFLATE 只在这里执行一次；
 * 返回的 Uint8Array 应被 SongCache 长期持有并共享给多个播放游标。
 */
export function readPbe2Events(
    data: Uint8Array,
    options: ReadPbe2EventsOptions = {}
): { header: Pbe2Header; events: Uint8Array } {
    const header = readPbe2Header(data);
    if (header.uncompressedLength > MAX_PBE2_EVENT_BYTES) {
        throw new Error(`[pbe2] 事件流超过安全上限：${header.uncompressedLength} 字节`);
    }
    const payload = data.subarray(header.eventOffset);
    const events = !header.compressed
        ? payload
        : header.uncompressedLength === 0
          ? new Uint8Array(0)
          : inflateSync(payload, { out: new Uint8Array(header.uncompressedLength) });
    if (options.verify !== false) {
        if (events.length !== header.uncompressedLength) {
            throw new Error(
                `[pbe2] 解压长度不匹配：${events.length} ≠ ${header.uncompressedLength}`
            );
        }
        if (crc32(events) !== header.checksum) {
            throw new Error("[pbe2] 事件流校验失败（CRC32）");
        }
    }
    return { header, events };
}

/** 顺序扫描事件流（解码/测试/服务端校验使用；运行时播放器用 EventCursor） */
export function readAllPbe2Notes(
    events: Uint8Array,
    hasVelocity = false
): Pbe2Note[] {
    const notes: Pbe2Note[] = [];
    const out: VarintResult = { value: 0, next: 0 };
    let pos = 0;
    let time = 0;
    while (pos < events.length) {
        readVarUint(events, pos, out);
        time += out.value;
        pos = out.next;
        readVarUint(events, pos, out);
        const count = out.value;
        pos = out.next;
        for (let i = 0; i < count; i++) {
            if (pos >= events.length) throw new Error("[pbe2] 音符数据被截断");
            const midi = events[pos++];
            readVarUint(events, pos, out);
            const duration = out.value;
            pos = out.next;
            let velocity = 100;
            if (hasVelocity) {
                readVarUint(events, pos, out);
                velocity = out.value;
                pos = out.next;
            }
            notes.push({ time, midi, duration, velocity });
        }
    }
    return notes;
}

/** PBE2 → MidiSong（单轨事件视图；仅用于预览/测试/离线工具） */
export function decodePbe2(data: Uint8Array): MidiSong {
    const { header, events } = readPbe2Events(data);
    const notes: number[] = [];
    for (const note of readAllPbe2Notes(events, header.hasVelocity)) {
        notes.push(note.midi, note.time, note.duration, note.velocity);
    }
    return {
        id: header.id,
        name: header.name,
        duration: header.duration,
        tracks: [
            {
                instrument: { family: "", number: 0, name: "" },
                notes,
            },
        ],
    };
}

/** PBE2 → 秒制音符事件（Web/生成器试听） */
export function pbe2ToNoteEvents(data: Uint8Array): Pbe2NoteEvent[] {
    const { header, events } = readPbe2Events(data);
    return pbe2EventsToNoteEvents(events, header.hasVelocity);
}

/** 已解压事件流 → 秒制音符事件 */
export function pbe2EventsToNoteEvents(
    events: Uint8Array,
    hasVelocity = false
): Pbe2NoteEvent[] {
    return readAllPbe2Notes(events, hasVelocity).map((note) => ({
        midi: note.midi,
        time: note.time / 40,
        duration: note.duration / 100,
        velocity: Math.max(0, Math.min(1, note.velocity / 127)),
    }));
}

/** 统一的编解码入口（对外只暴露这一套） */
export const PianoBinaryCodec = {
    encode: encodePbe2,
    encodeEvents: encodePbe2Events,
    readHeader: readPbe2Header,
    readEvents: readPbe2Events,
    readNotes: readAllPbe2Notes,
    decode: decodePbe2,
    toNoteEvents: pbe2ToNoteEvents,
} as const;
