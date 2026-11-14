import { encodeUtf8 } from "../pbe2/utf8.js";

/**
 * 音乐存储的容量计量。
 *
 * 只按“真正会被写进持久化存储的字节数”计算：Base64URL 正文、分片键名、
 * 元数据 JSON（中文名称按 UTF-8 计），不按歌曲数量或原始 PBE2 长度估算。
 */

export const DEFAULT_MUSIC_STORAGE_BYTES = 64 * 1024;
/** 管理员可配置下限：至少放得下一首很小的曲子 + 元数据 */
export const MUSIC_STORAGE_MIN_BYTES = 4 * 1024;
/** 管理员可配置上限：远低于引擎/脚本内存风险区，同时给分片留出空间 */
export const MUSIC_STORAGE_MAX_BYTES = 1024 * 1024;
/** 单个动态属性字符串的分片长度（引擎单值长度限制的安全值） */
export const MUSIC_SHARD_CHARS = 20_000;

/** 一条已提交曲目的元数据（持久化 JSON 就是这个结构）。 */
export interface StoredMusicEntry {
    v: 1;
    id: string;
    name: string;
    /** 时长（40 tick/秒） */
    duration: number;
    noteCount: number;
    /** PBE2 原始字节数 */
    bytes: number;
    /** 整份 PBE2 的 CRC32（16 进制） */
    checksum: string;
    /** Base64URL 分片数量 */
    shards: number;
    /** 数据世代；提交新版本时生成，旧世代分片随后删除 */
    gen: string;
    createdAt: number;
}

export function normalizeStorageLimit(value: unknown, fallback = DEFAULT_MUSIC_STORAGE_BYTES): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(MUSIC_STORAGE_MAX_BYTES, Math.max(MUSIC_STORAGE_MIN_BYTES, Math.round(value)));
}

export function utf8ByteLength(value: string): number {
    return encodeUtf8(value).length;
}

/** Base64URL（无 padding）编码后的字符数。 */
export function base64UrlLength(rawBytes: number): number {
    const full = Math.floor(rawBytes / 3) * 4;
    const rest = rawBytes % 3;
    return full + (rest === 0 ? 0 : rest + 1);
}

export function metaKey(prefix: string, id: string): string {
    return `${prefix}m.${id}`;
}

export function dataKey(prefix: string, id: string, gen: string, index: number): string {
    return `${prefix}d.${id}.${gen}.${index}`;
}

export function metaJson(entry: StoredMusicEntry): string {
    // 固定字段顺序，保证“容量计算”和“实际写入”是同一串字节。
    return JSON.stringify(entry);
}

/** 一条曲目在存储中实际占用的字节数（键 + 值，UTF-8）。 */
export function entryStoredBytes(prefix: string, entry: StoredMusicEntry): number {
    const encodedLength = base64UrlLength(entry.bytes);
    const shards = Math.max(1, entry.shards);
    let total = utf8ByteLength(metaKey(prefix, entry.id)) + utf8ByteLength(metaJson(entry));
    for (let index = 0; index < shards; index++) {
        const chars = index === shards - 1
            ? encodedLength - MUSIC_SHARD_CHARS * (shards - 1)
            : MUSIC_SHARD_CHARS;
        total += utf8ByteLength(dataKey(prefix, entry.id, entry.gen, index)) + Math.max(0, chars);
    }
    return total;
}

export interface StorageUsage {
    songs: number;
    usedBytes: number;
    limitBytes: number;
    remainingBytes: number;
}

export interface BudgetResult {
    ok: boolean;
    /** 本次写入需要的字节数 */
    requiredBytes: number;
    /** 写入前已占用 */
    usedBytes: number;
    /** 扣除被替换曲目后的可用空间 */
    remainingBytes: number;
    /** 超出多少字节（ok=false 时 > 0） */
    shortBytes: number;
    message?: string;
}

/**
 * 容量预算：判断“再加一条（或替换同 id 一条）”是否放得下。
 * 管理员降低上限后，已有超额数据仍可读取；这里只拦截新增/替换。
 */
export class StorageBudget {
    constructor(readonly limitBytes: number) {}

    static usage(prefix: string, entries: readonly StoredMusicEntry[], limitBytes: number): StorageUsage {
        const usedBytes = entries.reduce((sum, entry) => sum + entryStoredBytes(prefix, entry), 0);
        return {
            songs: entries.length,
            usedBytes,
            limitBytes,
            remainingBytes: Math.max(0, limitBytes - usedBytes),
        };
    }

    check(
        prefix: string,
        entries: readonly StoredMusicEntry[],
        incoming: StoredMusicEntry,
        replaceId?: string
    ): BudgetResult {
        const usage = StorageBudget.usage(prefix, entries, this.limitBytes);
        const replaced = replaceId
            ? entries.find(entry => entry.id === replaceId)
            : undefined;
        const replacedBytes = replaced ? entryStoredBytes(prefix, replaced) : 0;
        const used = usage.usedBytes - replacedBytes;
        const required = entryStoredBytes(prefix, incoming);
        const remaining = Math.max(0, this.limitBytes - used);
        // 管理员降低上限后已超额时，允许“不增加占用”的原地重写（例如仅改音符）。
        if (required <= remaining || (replaced !== undefined && required <= replacedBytes)) {
            return { ok: true, requiredBytes: required, usedBytes: used, remainingBytes: remaining, shortBytes: 0 };
        }
        const short = required - remaining;
        return {
            ok: false,
            requiredBytes: required,
            usedBytes: used,
            remainingBytes: remaining,
            shortBytes: short,
            message: formatCapacityError(required, remaining, short),
        };
    }
}

export function formatBytes(bytes: number): string {
    const value = Math.max(0, Math.round(bytes));
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCapacityError(required: number, remaining: number, short: number): string {
    return `容量不足：这首需要 ${formatBytes(required)}，可用 ${formatBytes(remaining)}，还差 ${formatBytes(short)}。` +
        "请先删除歌曲，或联系管理员提高存储上限。";
}
