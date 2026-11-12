import { world } from "@minecraft/server";
import type { MidiSongMeta } from "@piano/core";
import {
    crc32Hex,
    decodeBase64Url,
    encodeBase64Url,
    readAllPbe2Notes,
    readPbe2Events,
    readPbe2Header,
} from "@piano/core";

/** 导入曲库动态属性命名空间 */
const PREFIX = "pbe2.import";
const META_PREFIX = `${PREFIX}.meta.`;
const DATA_PREFIX = `${PREFIX}.data.`;
/** 单个分片最大字符数（世界动态属性字符串上限约 32KB，Base64 为 ASCII） */
const SHARD_CHARS = 20_000;
/** 单曲 PBE2 大小上限 */
export const MAX_IMPORT_SONG_BYTES = 2 * 1024 * 1024;
/** 世界导入曲库总容量（按 PBE2 原始字节估算） */
export const MAX_IMPORT_LIBRARY_BYTES = 16 * 1024 * 1024;
/** 导入曲目数量上限 */
export const MAX_IMPORT_SONGS = 500;
const MAX_IMPORT_NOTES = 250_000;
const MAX_IMPORT_DURATION = 40 * 60 * 60 * 6;
/** 单曲解压后事件流上限（与 core 的安全上限一致，避免压缩炸弹） */
const MAX_IMPORT_EVENT_BYTES = 8 * 1024 * 1024;

export interface ImportedSongRecord extends MidiSongMeta {
    noteCount: number;
    /** PBE2 字节数 */
    bytes: number;
    /** 整份 PBE2 的 CRC32（16 进制） */
    checksum: string;
    shards: number;
    generation: string;
    createdAt: number;
}

export interface ImportedLibraryStats {
    songs: number;
    bytes: number;
    maxSongs: number;
    maxBytes: number;
}

function metaKey(id: string) {
    return `${META_PREFIX}${id}`;
}

function dataKey(id: string, generation: string, index: number) {
    return `${DATA_PREFIX}${id}.${generation}.${index}`;
}

function isValidId(id: string) {
    return /^[0-9A-Za-z_-]{1,24}$/.test(id);
}

/**
 * 本地导入曲库（世界动态属性）：
 * - 数据先写新 generation 的分片，最后写 meta 作为提交索引；
 * - 读取时校验长度、CRC32 与 PBE2 头部 id，损坏记录不参与播放；
 * - 实现 MidiSource，直接注册到统一 SongCache。
 */
export class ImportedSongs implements MidiSourceLike {
    private records = new Map<string, ImportedSongRecord>();
    private metas: MidiSongMeta[] = [];
    private totalBytes = 0;
    private initialized = false;

    /**
     * 不在构造时访问世界动态属性：脚本模块求值处于 early execution，
     * `world.getDynamicPropertyIds()` 会抛 "cannot be used in early execution"。
     * 由 `main.ts` 在 system.run 中调用 reload()，或首次 get/save 时懒加载。
     */
    constructor() {}

    private ensureLoaded(): void {
        if (!this.initialized) this.reload();
    }

    /** 重新扫描世界动态属性（启动/导入/删除后） */
    reload(): void {
        const records = new Map<string, ImportedSongRecord>();
        const ids = world.getDynamicPropertyIds();
        for (const key of ids) {
            if (!key.startsWith(META_PREFIX)) continue;
            const raw = world.getDynamicProperty(key);
            if (typeof raw !== "string") continue;
            try {
                const record = JSON.parse(raw) as ImportedSongRecord;
                if (
                    typeof record?.id !== "string" ||
                    !isValidId(record.id) ||
                    record.id !== key.slice(META_PREFIX.length) ||
                    typeof record.name !== "string" ||
                    typeof record.duration !== "number" ||
                    typeof record.noteCount !== "number" ||
                    typeof record.bytes !== "number" ||
                    record.bytes <= 0 ||
                    record.bytes > MAX_IMPORT_SONG_BYTES ||
                    typeof record.checksum !== "string" ||
                    !/^[0-9a-f]{1,8}$/i.test(record.checksum) ||
                    typeof record.shards !== "number" ||
                    !Number.isInteger(record.shards) ||
                    record.shards < 1 ||
                    record.shards > 512 ||
                    typeof record.generation !== "string" ||
                    !/^[0-9a-z]{1,20}$/.test(record.generation)
                ) {
                    continue;
                }
                records.set(record.id, record);
            } catch {
                // 忽略损坏记录
            }
        }
        this.records = records;
        this.metas = [...records.values()]
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(({ id, name, duration }) => ({ id, name, duration }));
        this.totalBytes = [...records.values()].reduce((sum, record) => sum + record.bytes, 0);
        this.pruneOrphans(ids);
        this.initialized = true;
    }

    list(): MidiSongMeta[] {
        return this.metas;
    }

    async get(id: string): Promise<Uint8Array | undefined> {
        this.ensureLoaded();
        const record = this.records.get(id);
        if (!record) return undefined;
        try {
            const shards: string[] = [];
            for (let index = 0; index < record.shards; index++) {
                const part = world.getDynamicProperty(dataKey(id, record.generation, index));
                if (typeof part !== "string") return undefined;
                shards.push(part);
            }
            const bytes = decodeBase64Url(shards.join(""));
            if (bytes.length !== record.bytes) return undefined;
            if (crc32Hex(bytes) !== record.checksum) return undefined;
            if (readPbe2Header(bytes).id !== id) return undefined;
            return bytes;
        } catch {
            return undefined;
        }
    }

    /** 校验并保存 PBE2；返回保存后的元信息。失败抛错（中文提示可直接展示）。 */
    save(pbe2: Uint8Array): ImportedSongRecord {
        this.ensureLoaded();
        if (pbe2.length === 0) throw new Error("曲目数据为空");
        if (pbe2.length > MAX_IMPORT_SONG_BYTES) {
            throw new Error(`曲目超过单曲上限 ${(MAX_IMPORT_SONG_BYTES / 1024 / 1024).toFixed(0)}MB`);
        }
        const header = readPbe2Header(pbe2);
        if (!isValidId(header.id)) throw new Error("曲目 id 非法");
        if (header.noteCount <= 0) throw new Error("曲目没有音符");
        if (header.noteCount > MAX_IMPORT_NOTES) throw new Error("音符数量超过上限");
        if (header.duration < 0 || header.duration > MAX_IMPORT_DURATION) {
            throw new Error("曲目时长超出允许范围");
        }
        if (header.uncompressedLength > MAX_IMPORT_EVENT_BYTES) {
            throw new Error("曲目解压长度超出允许范围");
        }
        // 实际解压并校验 CRC32 / 事件结构，避免损坏数据进入世界存储。
        const { events } = readPbe2Events(pbe2);
        if (readAllPbe2Notes(events, header.hasVelocity).length !== header.noteCount) {
            throw new Error("曲目音符数量校验失败");
        }

        const previous = this.records.get(header.id);
        const nextBytes = this.totalBytes - (previous?.bytes ?? 0) + pbe2.length;
        if (nextBytes > MAX_IMPORT_LIBRARY_BYTES) throw new Error("世界导入曲库容量已满");
        if (!previous && this.records.size >= MAX_IMPORT_SONGS) {
            throw new Error(`导入曲目数量已达上限 ${MAX_IMPORT_SONGS}`);
        }

        const encoded = encodeBase64Url(pbe2);
        const shards = Math.max(1, Math.ceil(encoded.length / SHARD_CHARS));
        const generation = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`;
        for (let index = 0; index < shards; index++) {
            world.setDynamicProperty(
                dataKey(header.id, generation, index),
                encoded.slice(index * SHARD_CHARS, (index + 1) * SHARD_CHARS)
            );
        }

        const record: ImportedSongRecord = {
            id: header.id,
            name: header.name.slice(0, 120) || header.id,
            duration: header.duration,
            noteCount: header.noteCount,
            bytes: pbe2.length,
            checksum: crc32Hex(pbe2),
            shards,
            generation,
            createdAt: previous?.createdAt ?? Date.now(),
        };
        // 提交点：meta 写成功才算导入完成；此前中断只会留下不可见的孤儿分片。
        world.setDynamicProperty(metaKey(header.id), JSON.stringify(record));

        if (previous && previous.generation !== generation) {
            this.deleteShards(header.id, previous.generation, previous.shards);
        }
        this.reload();
        return record;
    }

    remove(id: string): boolean {
        this.ensureLoaded();
        const record = this.records.get(id);
        if (!record) return false;
        world.setDynamicProperty(metaKey(id));
        this.deleteShards(id, record.generation, record.shards);
        this.reload();
        return true;
    }

    stats(): ImportedLibraryStats {
        this.ensureLoaded();
        return {
            songs: this.records.size,
            bytes: this.totalBytes,
            maxSongs: MAX_IMPORT_SONGS,
            maxBytes: MAX_IMPORT_LIBRARY_BYTES,
        };
    }

    private deleteShards(id: string, generation: string, shards: number) {
        for (let index = 0; index < shards; index++) {
            world.setDynamicProperty(dataKey(id, generation, index));
        }
    }

    /** 清理没有 meta 引用的数据分片（提交中断/旧 generation 残留） */
    private pruneOrphans(ids: string[]) {
        const valid = new Set<string>();
        for (const record of this.records.values()) {
            for (let index = 0; index < record.shards; index++) {
                valid.add(dataKey(record.id, record.generation, index));
            }
        }
        for (const key of ids) {
            if (key.startsWith(DATA_PREFIX) && !valid.has(key)) {
                world.setDynamicProperty(key);
            }
        }
    }
}

/** 与 domain 的 MidiSource 结构一致（避免 platform → domain 反向依赖） */
interface MidiSourceLike {
    list(): MidiSongMeta[];
    get(id: string): Promise<Uint8Array | undefined>;
}

export const importedSongs = new ImportedSongs();
