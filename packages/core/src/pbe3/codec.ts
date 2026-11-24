import { deflateSync, inflateSync } from "fflate";
import { OTHER_SCALE, TIME_SCALE } from "../constants.js";
import { crc32 } from "../midi/crc32.js";
import type { MidiSong } from "../types.js";
import { decodeUtf8, encodeUtf8 } from "../binary/utf8.js";
import { readVarUint, varUintSize, writeVarUint, type VarintResult } from "../binary/varint.js";
import { decodePerformance, encodePerformance, MAX_PERFORMANCE_BYTES, type PerformanceCue } from "./performance.js";
import {
    MAX_PBE3_EVENT_BYTES,
    PBE3_FLAG_COMPRESSED,
    PBE3_FLAG_PERFORMANCE_COMPRESSED,
    PBE3_MAGIC,
    PBE3_PERFORMANCE_VERSION,
    PBE3_VERSION,
    type Pbe3Header,
    type Pbe3Note,
    type Pbe3NoteEvent,
} from "./format.js";

export interface EncodePbe3Options {
    /** 压缩策略：auto = 压缩后更小才使用（默认）；false = 永不压缩 */
    compress?: boolean | "auto";
    /** DEFLATE 等级 0~9（默认 9） */
    level?: number;
}

interface EncodedNote {
    time: number;
    midi: number;
    /** 声音时长（1/40 秒 tick） */
    soundDuration: number;
    /** 琴键时长（1/40 秒 tick） */
    keyDuration: number;
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

    /** 在已预留的字节区间内按 LSB-first 写入力度索引位流。 */
    velocityBits(start: number, indices: readonly number[], bits: number) {
        if (bits === 0) return;
        let bit = 0;
        for (const index of indices) {
            for (let b = 0; b < bits; b++) {
                if (index & (1 << b)) this.buffer[start + (bit >> 3)] |= 1 << (bit & 7);
                bit++;
            }
        }
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
            const noteIndex = i / 4;
            const time = Math.max(0, Math.round(values[i + 1]));
            const midi = Math.max(0, Math.min(127, Math.round(values[i])));
            const soundDuration100 = Math.max(1, Math.round(values[i + 2]));
            const soundTicks = Math.max(1, Math.round((soundDuration100 / OTHER_SCALE) * TIME_SCALE));
            const key = track.keyDurations?.[noteIndex] ?? soundDuration100;
            const keyDuration = quantizeKeyDuration(key, soundDuration100);
            const velocity = Math.max(0, Math.min(127, Math.round(values[i + 3])));
            notes.push({ time, midi, soundDuration: soundTicks, keyDuration, velocity, order: order++ });
        }
    }
    notes.sort((a, b) => a.time - b.time || a.order - b.order);
    return notes;
}

/** 调色板数量 → 索引位数（0~7） */
export function velocityBitsFor(paletteCount: number): number {
    if (paletteCount <= 1) return 0;
    return Math.ceil(Math.log2(paletteCount));
}

/**
 * 每首歌最多保留多少个力度级别。
 *
 * 全库实测（含 keyDuration，25ms 网格）：
 * - 8 级：约 -10.8%（比旧格式小）
 * - 4 级：更小，但平均音量误差约 2 dB
 *
 * 默认 8 级：3 bit 索引，平均误差约 1 dB，P95 约 1.75 dB，
 * 比 2 bit 的 2 dB/4 dB 明显好，同时仍能比旧格式更小。
 */
export const MAX_PBE3_VELOCITY_LEVELS = 8;

/** keyDuration 使用与音符起始时间相同的 1/40 秒网格（25ms）。 */
export const KEY_DURATION_TICKS_PER_SECOND = TIME_SCALE;

/** 按 25ms（1 tick）量化 keyDuration；与音符时间网格对齐。 */
function quantizeKeyDuration(value: number, soundDuration: number): number {
    const soundTicks = Math.max(1, Math.round((soundDuration / OTHER_SCALE) * TIME_SCALE));
    const keyTicks = Math.max(1, Math.round((value / OTHER_SCALE) * TIME_SCALE));
    return Math.min(soundTicks, keyTicks);
}

function buildPalette(notes: readonly EncodedNote[]): number[] {
    const unique = [...new Set(notes.map((note) => note.velocity))].sort((a, b) => a - b);
    if (!unique.length) return [100];
    if (unique.length <= MAX_PBE3_VELOCITY_LEVELS) return unique;

    // 固定 1~127 的均匀 8 级：不能从 0 开始，否则源力度 1~9 会被量化成 0，
    // 播放器会把 0 当作静音直接跳过。
    const levels: number[] = [];
    for (let i = 0; i < MAX_PBE3_VELOCITY_LEVELS; i++) {
        levels.push(Math.round(1 + (126 * i) / (MAX_PBE3_VELOCITY_LEVELS - 1)));
    }
    return [...new Set(levels)].sort((a, b) => a - b);
}

/** 找到最接近的调色板索引（调色板已升序，最多 8 项，线性查找足够快）。 */
function nearestPaletteIndex(palette: readonly number[], velocity: number): number {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const diff = Math.abs(palette[i] - velocity);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
        }
    }
    return best;
}

function readVelocityBits(
    events: Uint8Array,
    offset: number,
    count: number,
    bits: number
): { indices: number[]; next: number } {
    // 每个音符至少需要 2 字节（midiAndFlag + soundDuration VarInt）。
    // 先做上界检查，避免攻击者用超大的 group count 触发无界分配。
    if (count > Math.floor((events.length - offset) / 2)) {
        throw new Error("[pbe3] 事件组音符数异常");
    }
    if (bits === 0) return { indices: new Array(count).fill(0), next: offset };
    const bytes = Math.ceil((count * bits) / 8);
    if (offset + bytes > events.length) throw new Error("[pbe3] 力度索引数据被截断");
    const indices = new Array<number>(count);
    let bit = 0;
    for (let i = 0; i < count; i++) {
        let value = 0;
        for (let b = 0; b < bits; b++) {
            value |= ((events[offset + (bit >> 3)] >> (bit & 7)) & 1) << b;
            bit++;
        }
        indices[i] = value;
    }
    return { indices, next: offset + bytes };
}

/**
 * 把 MidiSong 编码为 PBE3 事件流。
 * 返回事件流以及编码时使用的调色板/索引位数，供文件头复用。
 */
export function encodePbe3Events(song: MidiSong): {
    events: Uint8Array;
    palette: number[];
    velocityBits: number;
    noteCount: number;
} {
    const notes = collectNotes(song);
    const palette = buildPalette(notes);
    const velocityBits = velocityBitsFor(palette.length);

    let size = 0;
    let index = 0;
    let previousTime = 0;
    while (index < notes.length) {
        const time = notes[index].time;
        let end = index + 1;
        while (end < notes.length && notes[end].time === time) end++;
        const count = end - index;
        size += varUintSize(time - previousTime) + varUintSize(count);
        size += Math.ceil((count * velocityBits) / 8);
        for (let i = index; i < end; i++) {
            const note = notes[i];
            size += 1 + varUintSize(note.soundDuration);
            if (note.keyDuration !== note.soundDuration) size += varUintSize(note.keyDuration);
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
        const count = end - index;
        writer.varUint(time - previousTime);
        writer.varUint(count);

        const velocityBytes = Math.ceil((count * velocityBits) / 8);
        const velocityStart = writer.offset;
        writer.bytes(new Uint8Array(velocityBytes));
        writer.velocityBits(
            velocityStart,
            notes.slice(index, end).map((note) => nearestPaletteIndex(palette, note.velocity)),
            velocityBits
        );
        writer.offset = velocityStart + velocityBytes;

        for (let i = index; i < end; i++) {
            const note = notes[i];
            const hasKey = note.keyDuration !== note.soundDuration;
            writer.put(note.midi | (hasKey ? 0x80 : 0));
            writer.varUint(note.soundDuration);
            if (hasKey) writer.varUint(note.keyDuration);
        }
        previousTime = time;
        index = end;
    }

    return { events: writer.finish(), palette, velocityBits, noteCount: notes.length };
}

function pushString(writer: ByteWriter, value: string) {
    const bytes = encodeUtf8(value);
    if (bytes.length > 0xffff) throw new Error("[pbe3] 字符串字段超过 65535 字节");
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

/** 压缩头比裸区块头多 4 字节，要求净收益至少 9 字节才值得解压开销 */
const PERFORMANCE_COMPRESS_MARGIN = 9;

interface PackedPerformanceSection {
    payload: Uint8Array;
    compressed: boolean;
    rawLength: number;
    checksum: number;
}

/** 与事件流一致的自动压缩策略：收益不足时回退裸数据 */
function packPerformanceSection(section: Uint8Array): PackedPerformanceSection {
    const packed = deflateSync(section, { level: 9 });
    const checksum = crc32(section);
    if (packed.length + 4 + PERFORMANCE_COMPRESS_MARGIN <= section.length) {
        return { payload: packed, compressed: true, rawLength: section.length, checksum };
    }
    return { payload: section, compressed: false, rawLength: section.length, checksum };
}

/** 把 MidiSong 编码为 PBE3 二进制 */
export function encodePbe3(song: MidiSong, options: EncodePbe3Options = {}): Uint8Array {
    const { events, palette, velocityBits, noteCount } = encodePbe3Events(song);
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
    writer.bytes(Uint8Array.from(PBE3_MAGIC));
    writer.put(PBE3_VERSION);
    writer.put(compressed ? PBE3_FLAG_COMPRESSED : 0);
    pushString(writer, song.id);
    pushString(writer, song.name);
    pushU32(writer, song.duration);
    pushU32(writer, noteCount);
    pushU32(writer, events.length);
    pushU32(writer, crc32(events));
    writer.put(palette.length);
    writer.bytes(Uint8Array.from(palette));
    writer.put(velocityBits);
    writer.bytes(payload);
    const bytes = writer.finish();
    return song.performance?.length ? attachPbe3Performance(bytes, song.performance) : bytes;
}

function readU32(data: Uint8Array, offset: number): number {
    if (offset + 4 > data.length) throw new Error("[pbe3] 文件头被截断");
    return (
        (data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24)) >>>
        0
    );
}

function readString(data: Uint8Array, offset: number): { value: string; next: number } {
    if (offset + 2 > data.length) throw new Error("[pbe3] 字符串长度被截断");
    const length = data[offset] | (data[offset + 1] << 8);
    const start = offset + 2;
    const end = start + length;
    if (end > data.length) throw new Error("[pbe3] 字符串内容被截断");
    return { value: decodeUtf8(data.subarray(start, end)), next: end };
}

/** 只读文件头（不解压、不解码事件），列表/搜索/校验使用 */
export function readPbe3Header(data: Uint8Array): Pbe3Header {
    if (data.length < 10) throw new Error("[pbe3] 文件过短");
    for (let i = 0; i < 4; i++) {
        if (data[i] !== PBE3_MAGIC[i]) throw new Error("[pbe3] 魔数不匹配");
    }
    const version = data[4];
    if (version !== PBE3_VERSION && version !== PBE3_PERFORMANCE_VERSION) {
        throw new Error(`[pbe3] 版本不兼容：${version}`);
    }
    const flags = data[5];
    if ((flags & ~(PBE3_FLAG_COMPRESSED | PBE3_FLAG_PERFORMANCE_COMPRESSED)) !== 0) {
        throw new Error("[pbe3] 保留标志位非 0");
    }
    const id = readString(data, 6);
    const name = readString(data, id.next);
    const fixed = name.next;
    const duration = readU32(data, fixed);
    const noteCount = readU32(data, fixed + 4);
    const uncompressedLength = readU32(data, fixed + 8);
    const checksum = readU32(data, fixed + 12);
    let offset = fixed + 16;
    if (offset >= data.length) throw new Error("[pbe3] 调色板被截断");
    const paletteCount = data[offset++];
    if (paletteCount === 0) throw new Error("[pbe3] 力度调色板不能为空");
    if (offset + paletteCount + 1 > data.length) throw new Error("[pbe3] 调色板被截断");
    const palette: number[] = [];
    for (let i = 0; i < paletteCount; i++) {
        const value = data[offset++];
        if (value > 127) throw new Error("[pbe3] 力度值越界");
        if (i > 0 && value <= palette[i - 1]) throw new Error("[pbe3] 力度调色板必须升序且不重复");
        palette.push(value);
    }
    const velocityBits = data[offset++];
    if (velocityBits > 7) throw new Error("[pbe3] 力度索引位数越界");
    if (velocityBits !== velocityBitsFor(paletteCount)) {
        throw new Error("[pbe3] 力度索引位数与调色板数量不匹配");
    }
    let performance: PerformanceCue[] | undefined;
    let performanceBytes = 0;
    let performanceCompressed = false;
    if (version === PBE3_PERFORMANCE_VERSION) {
        performanceCompressed = (flags & PBE3_FLAG_PERFORMANCE_COMPRESSED) !== 0;
        let section: Uint8Array;
        if (performanceCompressed) {
            if (offset + 10 > data.length) throw new Error("[pbe3] 演出区块头被截断");
            const rawLength = readU32(data, offset);
            const expected = readU32(data, offset + 4);
            const length = data[offset + 8] | (data[offset + 9] << 8);
            offset += 10;
            if (rawLength === 0 || rawLength > MAX_PERFORMANCE_BYTES || length === 0 || offset + length > data.length) {
                throw new Error("[pbe3] 演出区块长度无效");
            }
            try {
                section = inflateSync(data.subarray(offset, offset + length), { out: new Uint8Array(rawLength) });
            } catch {
                throw new Error("[pbe3] 演出区块解压失败");
            }
            if (section.length !== rawLength) throw new Error("[pbe3] 演出区块解压长度不匹配");
            if (crc32(section) !== expected) throw new Error("[pbe3] 演出区块校验失败（CRC32）");
            performanceBytes = 10 + length;
            offset += length;
        } else {
            if (offset + 6 > data.length) throw new Error("[pbe3] 演出区块头被截断");
            const length = data[offset] | (data[offset + 1] << 8);
            const expected = readU32(data, offset + 2);
            offset += 6;
            if (length > MAX_PERFORMANCE_BYTES || offset + length > data.length) throw new Error("[pbe3] 演出区块长度无效");
            section = data.subarray(offset, offset + length);
            if (crc32(section) !== expected) throw new Error("[pbe3] 演出区块校验失败（CRC32）");
            performanceBytes = 6 + length;
            offset += length;
        }
        const decodedPerformance = decodePerformance(section, duration);
        if (decodedPerformance.length) performance = decodedPerformance;
    } else if (flags & PBE3_FLAG_PERFORMANCE_COMPRESSED) {
        throw new Error("[pbe3] 无演出区块时设置演出压缩标志位");
    }
    return {
        id: id.value,
        name: name.value,
        duration,
        noteCount,
        uncompressedLength,
        checksum,
        flags,
        compressed: (flags & PBE3_FLAG_COMPRESSED) !== 0,
        palette,
        velocityBits,
        eventOffset: offset,
        ...(performance ? { performance } : {}),
        ...(performanceBytes ? { performanceBytes, performanceCompressed } : {}),
        byteLength: data.length,
    };
}

/** 替换演出区块，保留原始音符载荷和压缩设置。空列表恢复版本 1。 */
export function attachPbe3Performance(data: Uint8Array, cues: readonly PerformanceCue[]): Uint8Array {
    const header = readPbe3Header(data);
    const start = header.eventOffset - (header.performanceBytes ?? 0);
    const payload = data.subarray(header.eventOffset);
    const writer = new ByteWriter(start + payload.length + 16);
    writer.bytes(data.subarray(0, start));
    let compressedPerformance = false;
    if (cues.length) {
        const section = encodePerformance(cues, header.duration);
        const packed = packPerformanceSection(section);
        compressedPerformance = packed.compressed;
        if (packed.compressed) {
            pushU32(writer, packed.rawLength);
            pushU32(writer, packed.checksum);
            writer.put(packed.payload.length & 255);
            writer.put(packed.payload.length >>> 8);
        } else {
            writer.put(packed.rawLength & 255);
            writer.put(packed.rawLength >>> 8);
            pushU32(writer, packed.checksum);
        }
        writer.bytes(packed.payload);
    }
    writer.bytes(payload);
    const out = writer.finish();
    out[4] = cues.length ? PBE3_PERFORMANCE_VERSION : PBE3_VERSION;
    out[5] =
        (out[5] & PBE3_FLAG_COMPRESSED) |
        (compressedPerformance ? PBE3_FLAG_PERFORMANCE_COMPRESSED : 0);
    return out;
}

export interface ReadPbe3EventsOptions {
    /** 只读取头部，不校验 CRC/解压 */
    headerOnly?: boolean;
}

export function readPbe3Events(
    data: Uint8Array,
    options: ReadPbe3EventsOptions = {}
): { header: Pbe3Header; events: Uint8Array } {
    const header = readPbe3Header(data);
    if (options.headerOnly) return { header, events: new Uint8Array(0) };
    if (header.uncompressedLength > MAX_PBE3_EVENT_BYTES) {
        throw new Error(`[pbe3] 事件流超过安全上限（${header.uncompressedLength} 字节）`);
    }
    const payload = data.subarray(header.eventOffset);
    const events = !header.compressed
        ? payload
        : header.uncompressedLength === 0
          ? new Uint8Array(0)
          : inflateSync(payload, { out: new Uint8Array(header.uncompressedLength) });
    if (events.length !== header.uncompressedLength) {
        throw new Error(`[pbe3] 解压长度不匹配：${events.length} 字节 ${header.uncompressedLength}`);
    }
    if (crc32(events) !== header.checksum) {
        throw new Error("[pbe3] 事件流校验失败（CRC32）");
    }
    return { header, events };
}

/** 顺序扫描事件流，返回全部音符；用于校验/预览/离线工具。 */
export function readAllPbe3Notes(
    events: Uint8Array,
    palette: readonly number[],
    velocityBits: number,
    maxNotes = Infinity
): Pbe3Note[] {
    const notes: Pbe3Note[] = [];
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
        if (count === 0) throw new Error("[pbe3] 事件组音符数为 0");
        if (notes.length + count > maxNotes) {
            throw new Error("[pbe3] 事件组音符数超过头部声明");
        }
        if (count > Math.floor((events.length - pos) / 2)) {
            throw new Error("[pbe3] 事件组音符数异常");
        }

        const velocities = readVelocityBits(events, pos, count, velocityBits);
        pos = velocities.next;

        for (let i = 0; i < count; i++) {
            if (pos >= events.length) throw new Error("[pbe3] 音符数据被截断");
            const midiAndFlag = events[pos++];
            const midi = midiAndFlag & 0x7f;
            const hasKey = (midiAndFlag & 0x80) !== 0;
            readVarUint(events, pos, out);
            const soundDuration = out.value;
            pos = out.next;
            let keyDuration = soundDuration;
            if (hasKey) {
                readVarUint(events, pos, out);
                keyDuration = out.value;
                pos = out.next;
            }
            const index = velocities.indices[i];
            const velocity = palette[index];
            if (velocity === undefined) throw new Error("[pbe3] 力度索引越界");
            notes.push({ time, midi, soundDuration, keyDuration, velocity });
        }
    }
    return notes;
}

/** PBE3 → MidiSong（单轨事件视图；仅用于预览/测试/离线工具） */
export function decodePbe3(data: Uint8Array): MidiSong {
    const { header, events } = readPbe3Events(data);
    const notes: number[] = [];
    const keyDurations: number[] = [];
    for (const note of readAllPbe3Notes(events, header.palette, header.velocityBits, header.noteCount)) {
        notes.push(note.midi, note.time, Math.round((note.soundDuration * OTHER_SCALE) / TIME_SCALE), note.velocity);
        keyDurations.push(Math.round((note.keyDuration * OTHER_SCALE) / TIME_SCALE));
    }
    return {
        id: header.id,
        name: header.name,
        duration: header.duration,
        ...(header.performance ? { performance: header.performance } : {}),
        tracks: [
            {
                instrument: { family: "", number: 0, name: "" },
                notes,
                keyDurations,
            },
        ],
    };
}

/** PBE3 → 秒制音符事件（Web/生成器试听） */
export function pbe3ToNoteEvents(data: Uint8Array): Pbe3NoteEvent[] {
    const { header, events } = readPbe3Events(data);
    return pbe3EventsToNoteEvents(events, header.palette, header.velocityBits);
}

/** 已解压事件流 → 秒制音符事件 */
export function pbe3EventsToNoteEvents(
    events: Uint8Array,
    palette: readonly number[],
    velocityBits: number
): Pbe3NoteEvent[] {
    return readAllPbe3Notes(events, palette, velocityBits).map((note) => ({
        midi: note.midi,
        time: note.time / TIME_SCALE,
        duration: note.soundDuration / TIME_SCALE,
        keyDuration: note.keyDuration / TIME_SCALE,
        velocity: Math.max(0, Math.min(1, note.velocity / 127)),
    }));
}

/** 修改曲名后重新编码 PBE3（索引与文件头保持一致）。 */
export function renamePbe3(data: Uint8Array, name: string): Uint8Array {
    const header = readPbe3Header(data);
    const song = decodePbe3(data);
    return encodePbe3(
        { ...song, name },
        { compress: header.compressed }
    );
}

export function reidentifyPbe3(data: Uint8Array, id: string): Uint8Array {
    readPbe3Header(data);
    const tail = readString(data, 6).next;
    const writer = new ByteWriter(data.length + id.length);
    writer.bytes(data.subarray(0, 6));
    pushString(writer, id);
    writer.bytes(data.subarray(tail));
    return writer.finish();
}

/** 统一的编解码入口 */
export const Pbe3Codec = {
    encode: encodePbe3,
    encodeEvents: encodePbe3Events,
    readHeader: readPbe3Header,
    readEvents: readPbe3Events,
    readNotes: readAllPbe3Notes,
    decode: decodePbe3,
    rename: renamePbe3,
    toNoteEvents: pbe3ToNoteEvents,
} as const;
