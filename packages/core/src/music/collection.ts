import { crc32Hex } from "../midi/crc32.js";
import { decodeBase64Url } from "../pbe2/base64url.js";
import { readPbe2Header } from "../pbe2/codec.js";
import {
    MUSIC_SHARD_CHARS,
    StorageBudget,
    dataKey,
    entryStoredBytes,
    formatCapacityError,
    metaJson,
    metaKey,
    type StoredMusicEntry,
    type StorageUsage,
} from "./budget.js";
import { MUSIC_ENTRY_ID_PATTERN, DEFAULT_MUSIC_LIMITS, type MusicStorageLimits } from "./limits.js";
import { MusicValidationError, validateMusic } from "./validate.js";

/**
 * 持久化键值端口。
 *
 * 世界动态属性、实体动态属性、物品动态属性都只需要这四个操作即可承载音乐存储。
 */
export interface MusicStorageKv {
    /** 容器内全部键（可包含其它命名空间，调用方按前缀过滤） */
    keys(): string[];
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
}

export interface MusicCollectionOptions {
    limits?: MusicStorageLimits;
    shardChars?: number;
    now?: () => number;
    random?: () => string;
}

export interface ImportResult {
    songs: number;
    bytes: number;
}

function isEntryValid(value: unknown, expectId?: string, limits = DEFAULT_MUSIC_LIMITS): value is StoredMusicEntry {
    if (!value || typeof value !== "object") return false;
    const entry = value as StoredMusicEntry;
    return entry.v === 1 &&
        typeof entry.id === "string" && MUSIC_ENTRY_ID_PATTERN.test(entry.id) &&
        (expectId === undefined || entry.id === expectId) &&
        typeof entry.name === "string" &&
        typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration >= 0 &&
        Number.isInteger(entry.noteCount) && entry.noteCount > 0 &&
        Number.isInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= limits.maxSongBytes &&
        typeof entry.checksum === "string" && /^[0-9a-f]{1,8}$/i.test(entry.checksum) &&
        Number.isInteger(entry.shards) && entry.shards >= 1 && entry.shards <= 512 &&
        typeof entry.gen === "string" && /^[0-9a-z]{1,24}$/.test(entry.gen) &&
        typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt);
}

/**
 * 分片曲目集合：提交点 = 元数据写入。
 *
 * - 写入顺序：数据分片 → 元数据；任一步失败都会回滚本次写入的分片，旧版本保持可读。
 * - 读取顺序：元数据 → 分片 → Base64 解码 → 长度 + CRC32 + PBE2 头部 id 三重校验。
 * - 删除顺序：元数据 → 分片；中断只会留下不可见的孤儿分片，由 pruneOrphans 清理。
 */
export class MusicCollection {
    private readonly limits: MusicStorageLimits;
    private readonly shardChars: number;
    private readonly now: () => number;
    private readonly random: () => string;

    constructor(
        private readonly kv: MusicStorageKv,
        /** 键前缀，例如 `pb.piano.` / `pb.card.` */
        readonly prefix: string,
        /** 当前容量上限（管理员可随时调整） */
        private readonly limit: () => number,
        options: MusicCollectionOptions = {}
    ) {
        this.limits = options.limits ?? DEFAULT_MUSIC_LIMITS;
        this.shardChars = options.shardChars ?? MUSIC_SHARD_CHARS;
        this.now = options.now ?? (() => Date.now());
        this.random = options.random ?? (() => Math.random().toString(36).slice(2, 8));
    }

    /* ================== 查询 ================== */

    entries(): StoredMusicEntry[] {
        const result: StoredMusicEntry[] = [];
        const seen = new Set<string>();
        for (const key of this.safeKeys()) {
            if (!key.startsWith(`${this.prefix}m.`)) continue;
            const id = key.slice(this.prefix.length + 2);
            if (seen.has(id)) continue;
            const raw = this.kv.get(key);
            if (typeof raw !== "string") continue;
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch {
                continue;
            }
            if (!isEntryValid(parsed, id, this.limits)) continue;
            seen.add(id);
            result.push(parsed);
        }
        return result.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
    }

    has(id: string): boolean {
        return this.entry(id) !== undefined;
    }

    entry(id: string): StoredMusicEntry | undefined {
        const raw = this.kv.get(metaKey(this.prefix, id));
        if (typeof raw !== "string") return;
        try {
            const parsed: unknown = JSON.parse(raw);
            return isEntryValid(parsed, id, this.limits) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    /** 读取并校验曲目正文；任何不一致都返回 undefined（不播放错误版本的数据）。 */
    get(id: string): Uint8Array | undefined {
        const entry = this.entry(id);
        if (!entry) return undefined;
        try {
            const shards: string[] = [];
            for (let index = 0; index < entry.shards; index++) {
                const part = this.kv.get(dataKey(this.prefix, entry.id, entry.gen, index));
                if (typeof part !== "string") return undefined;
                shards.push(part);
            }
            const bytes = decodeBase64Url(shards.join(""));
            if (bytes.length !== entry.bytes) return undefined;
            if (crc32Hex(bytes) !== entry.checksum) return undefined;
            if (readPbe2Header(bytes).id !== entry.id) return undefined;
            return bytes;
        } catch {
            return undefined;
        }
    }

    usage(): StorageUsage {
        return StorageBudget.usage(this.prefix, this.entries(), this.limit());
    }

    stats(): StorageUsage {
        return this.usage();
    }

    /* ================== 写入 ================== */

    /** 校验并写入 PBE2；失败抛错，调用方可直接展示 message。 */
    save(pbe2: Uint8Array, name?: string): StoredMusicEntry {
        const { header, checksum, encoded } = validateMusic(pbe2, this.limits);
        const entries = this.entries();
        const previous = entries.find(item => item.id === header.id);
        const shards = Math.max(1, Math.ceil(encoded.length / this.shardChars));
        const gen = this.nextGeneration(header.id, previous?.gen);
        const entry: StoredMusicEntry = {
            v: 1,
            id: header.id,
            name: (name ?? header.name).slice(0, 120) || header.id,
            duration: header.duration,
            noteCount: header.noteCount,
            bytes: pbe2.length,
            checksum,
            shards,
            gen,
            createdAt: previous?.createdAt ?? this.now(),
        };

        const check = new StorageBudget(this.limit()).check(this.prefix, entries, entry, previous?.id);
        if (!check.ok) throw new MusicValidationError(check.message ?? formatCapacityError(
            check.requiredBytes, check.remainingBytes, check.shortBytes));

        const written: string[] = [];
        try {
            for (let index = 0; index < shards; index++) {
                const key = dataKey(this.prefix, entry.id, gen, index);
                this.kv.set(key, encoded.slice(index * this.shardChars, (index + 1) * this.shardChars));
                written.push(key);
            }
            // 提交点：元数据可见后这首歌才算存在。
            this.kv.set(metaKey(this.prefix, entry.id), metaJson(entry));
        } catch (error) {
            for (const key of written) {
                try { this.kv.delete(key); } catch { /* 回滚尽力而为 */ }
            }
            throw new MusicValidationError(`保存失败，已保留原有数据：${(error as Error).message ?? error}`);
        }

        if (previous && previous.gen !== gen) this.deleteShards(previous);
        this.pruneOrphans();
        return entry;
    }

    /** 只改显示名称（不重新编码正文）。 */
    rename(id: string, name: string): StoredMusicEntry | undefined {
        const entry = this.entry(id);
        if (!entry) return undefined;
        const trimmed = name.trim().slice(0, 120);
        if (!trimmed || trimmed === entry.name) return entry;
        const next: StoredMusicEntry = { ...entry, name: trimmed };
        const check = new StorageBudget(this.limit()).check(this.prefix, this.entries(), next, entry.id);
        if (!check.ok) throw new MusicValidationError(check.message ?? "容量不足");
        this.kv.set(metaKey(this.prefix, id), metaJson(next));
        return next;
    }

    remove(id: string): boolean {
        const entry = this.entry(id);
        if (!entry) return false;
        // 先删元数据（不可见），再清分片；崩溃只会留下孤儿分片。
        this.kv.delete(metaKey(this.prefix, id));
        this.deleteShards(entry);
        this.pruneOrphans();
        return true;
    }

    clear(): number {
        const entries = this.entries();
        for (const entry of entries) this.remove(entry.id);
        this.pruneOrphans();
        return entries.length;
    }

    /* ================== 迁移 / 备份 ================== */

    /** 导出命名空间内的全部键值（用于钢琴 ↔ 掉落物整体搬运）。 */
    exportRaw(): Record<string, string> {
        const raw: Record<string, string> = {};
        for (const key of this.safeKeys()) {
            if (!key.startsWith(this.prefix)) continue;
            const value = this.kv.get(key);
            if (typeof value === "string") raw[key] = value;
        }
        return raw;
    }

    /** 合并导入一批键值；返回实际可见的曲目数。失败会回滚本次写入。 */
    importRaw(raw: Record<string, string>): ImportResult {
        const written: string[] = [];
        const metaPrefix = `${this.prefix}m.`;
        try {
            for (const [key, value] of Object.entries(raw)) {
                if (!key.startsWith(this.prefix) || typeof value !== "string") continue;
                if (key.startsWith(metaPrefix)) continue;
                this.kv.set(key, value);
                written.push(key);
            }
            let songs = 0;
            let bytes = 0;
            for (const [key, value] of Object.entries(raw)) {
                if (!key.startsWith(metaPrefix) || typeof value !== "string") continue;
                this.kv.set(key, value);
                written.push(key);
                songs++;
                try { bytes += (JSON.parse(value) as StoredMusicEntry).bytes ?? 0; } catch { /* 忽略 */ }
            }
            return { songs, bytes };
        } catch (error) {
            for (const key of written) {
                try { this.kv.delete(key); } catch { /* 回滚尽力而为 */ }
            }
            throw new MusicValidationError(`迁移失败：${(error as Error).message ?? error}`);
        }
    }

    /** 校验导入包中每首歌的元数据是否完整（迁移后自检）。 */
    verifyRaw(raw: Record<string, string>): boolean {
        for (const [key, value] of Object.entries(raw)) {
            if (!key.startsWith(`${this.prefix}m.`)) continue;
            let parsed: unknown;
            try { parsed = JSON.parse(value); } catch { return false; }
            if (!isEntryValid(parsed, key.slice(this.prefix.length + 2), this.limits)) return false;
            for (let index = 0; index < (parsed as StoredMusicEntry).shards; index++) {
                if (typeof raw[dataKey(this.prefix, (parsed as StoredMusicEntry).id, (parsed as StoredMusicEntry).gen, index)] !== "string") return false;
            }
        }
        return true;
    }

    /** 计算单条曲目占用（UI/诊断用）。 */
    entryBytes(entry: StoredMusicEntry): number {
        return entryStoredBytes(this.prefix, entry);
    }

    /* ================== 维护 ================== */

    /** 删除没有元数据引用的分片（提交中断/旧世代残留）。 */
    pruneOrphans(): number {
        const valid = new Set<string>();
        for (const entry of this.entries()) {
            for (let index = 0; index < entry.shards; index++) {
                valid.add(dataKey(this.prefix, entry.id, entry.gen, index));
            }
        }
        let removed = 0;
        for (const key of this.safeKeys()) {
            if (!key.startsWith(`${this.prefix}d.`) || valid.has(key)) continue;
            try {
                this.kv.delete(key);
                removed++;
            } catch { /* 下次再清 */ }
        }
        return removed;
    }

    /** 世代必须与任何现存世代不同：写入中断时旧数据不能被覆盖。 */
    private nextGeneration(id: string, previous?: string): string {
        const base = `${this.now().toString(36)}${this.random()}`
            .replace(/[^0-9a-z]/g, "")
            .slice(0, 20) || "0";
        let gen = base;
        for (let attempt = 0; attempt < 8; attempt++) {
            if (gen !== previous && this.kv.get(dataKey(this.prefix, id, gen, 0)) === undefined) return gen;
            gen = `${base}${attempt.toString(36)}`;
        }
        return `${base}z`;
    }

    private deleteShards(entry: StoredMusicEntry) {
        for (let index = 0; index < entry.shards; index++) {
            try {
                this.kv.delete(dataKey(this.prefix, entry.id, entry.gen, index));
            } catch { /* 交给 pruneOrphans */ }
        }
    }

    private safeKeys(): string[] {
        try {
            return this.kv.keys();
        } catch {
            return [];
        }
    }
}
