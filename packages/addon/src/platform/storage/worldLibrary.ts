import { world } from "@minecraft/server";
import {
    MusicCollection,
    MusicValidationError,
    StorageBudget,
    validateMusic,
    worldPublicId,
    worldRawId,
    type MidiSongMeta,
    type MusicStorageKv,
    type StoredMusicEntry,
    type StorageUsage,
} from "@piano/core";

/** 世界级全局曲库：正文与元数据均写入世界动态属性。 */
export const WORLD_LIBRARY_PREFIX = "pb.worldlib.";
export const WORLD_LIBRARY_LABEL = "世界公共曲库";
/** 世界全局曲库总容量（按实际落盘字节计费）。 */
export const WORLD_LIBRARY_BYTES = 8 * 1024 * 1024;
export const WORLD_LIBRARY_MAX_SONGS = 500;

/** 世界动态属性 KV 适配。 */
class WorldPropertyKv implements MusicStorageKv {
    keys(): string[] {
        try {
            return world.getDynamicPropertyIds();
        } catch {
            return [];
        }
    }

    get(key: string): string | undefined {
        try {
            const value = world.getDynamicProperty(key);
            return typeof value === "string" ? value : undefined;
        } catch {
            return undefined;
        }
    }

    set(key: string, value: string): void {
        world.setDynamicProperty(key, value);
    }

    delete(key: string): void {
        world.setDynamicProperty(key);
    }
}

function copyMeta(meta: MidiSongMeta): MidiSongMeta {
    const copy: MidiSongMeta = { id: meta.id, name: meta.name, duration: meta.duration };
    if (meta.noteCount !== undefined) copy.noteCount = meta.noteCount;
    if (meta.bytes !== undefined) copy.bytes = meta.bytes;
    return copy;
}

/**
 * 管理员全局曲库。
 *
 * - 持久化：复用 MusicCollection 的分片正文 + 元数据提交点；
 * - 运行时：启动时扫描一次世界动态属性建立内存索引，搜索/分页只查内存；
 * - 写入：校验、冲突检测、容量检查后提交，再重建索引；
 * - 读取：按 id 直接查元数据键，不扫描全部动态属性。
 */
export class WorldMusicLibrary {
    private readonly collection = new MusicCollection(
        new WorldPropertyKv(),
        WORLD_LIBRARY_PREFIX,
        () => WORLD_LIBRARY_BYTES
    );
    private entriesCache: StoredMusicEntry[] = [];
    private metas: MidiSongMeta[] = [];
    private byId = new Map<string, StoredMusicEntry>();
    private usageCache: StorageUsage = {
        songs: 0,
        usedBytes: 0,
        limitBytes: WORLD_LIBRARY_BYTES,
        remainingBytes: WORLD_LIBRARY_BYTES,
    };
    private initialized = false;

    get label(): string {
        return WORLD_LIBRARY_LABEL;
    }

    get limitBytes(): number {
        return WORLD_LIBRARY_BYTES;
    }

    private ensureLoaded() {
        if (!this.initialized) this.reload();
    }

    /** 重新扫描持久化元数据，重建内存索引与容量统计。 */
    reload(): void {
        // 首次恢复时清理遗留分片；普通管理页不重复进行全量清理。
        if (!this.initialized) this.collection.pruneOrphans();
        const entries = this.collection.entries();
        this.entriesCache = entries;
        this.byId = new Map(entries.map(entry => [entry.id, entry]));
        this.metas = entries.map(entry => {
            const meta: MidiSongMeta = {
                id: entry.id,
                name: entry.name,
                duration: entry.duration,
                noteCount: entry.noteCount,
                bytes: entry.bytes,
            };
            return meta;
        });
        this.usageCache = StorageBudget.usage(WORLD_LIBRARY_PREFIX, entries, WORLD_LIBRARY_BYTES);
        this.initialized = true;
    }

    /** 内存索引中的全量元信息（返回副本，避免调用方修改索引对象）。 */
    list(): MidiSongMeta[] {
        this.ensureLoaded();
        return this.metas.map(copyMeta);
    }

    /** 按 id 查元信息；只读单条元数据键，不扫描全库。 */
    entry(id: string): StoredMusicEntry | undefined {
        this.ensureLoaded();
        return this.byId.get(id) ?? this.collection.entry(id);
    }

    has(id: string): boolean {
        this.ensureLoaded();
        return this.byId.has(id) || this.collection.has(id);
    }

    /** 读取并校验 PBE3 正文。 */
    async get(id: string): Promise<Uint8Array | undefined> {
        this.ensureLoaded();
        return this.collection.get(id);
    }

    /** 内存索引关键词搜索与分页；不会扫描世界动态属性。 */
    pageSync(page: number, pageSize: number, q?: string): { items: MidiSongMeta[]; total: number } {
        this.ensureLoaded();
        const size = Math.max(1, Math.floor(pageSize));
        const current = Math.max(1, Math.floor(page));
        const keyword = q?.trim().toLowerCase() ?? "";
        const filtered = keyword
            ? this.metas.filter(meta => meta.name.toLowerCase().includes(keyword))
            : this.metas;
        const start = (current - 1) * size;
        return {
            items: filtered.slice(start, start + size).map(copyMeta),
            total: filtered.length,
        };
    }

    page(page: number, pageSize: number, q?: string): Promise<{ items: MidiSongMeta[]; total: number }> {
        return Promise.resolve(this.pageSync(page, pageSize, q));
    }

    metaAllSync(q?: string): MidiSongMeta[] {
        this.ensureLoaded();
        const keyword = q?.trim().toLowerCase() ?? "";
        const filtered = keyword
            ? this.metas.filter(meta => meta.name.toLowerCase().includes(keyword))
            : this.metas;
        return filtered.map(copyMeta);
    }

    metaAll(q?: string): Promise<MidiSongMeta[]> {
        return Promise.resolve(this.metaAllSync(q));
    }

    /**
     * 保存全局歌曲。
     *
     * 同 id 且内容一致视为幂等重复；同 id 不同内容视为冲突并拒绝覆盖。
     */
    save(pbe3: Uint8Array): StoredMusicEntry {
        this.ensureLoaded();
        const { header, checksum } = validateMusic(pbe3);
        const existing = this.entry(header.id);
        if (existing) {
            if (existing.checksum === checksum && existing.bytes === pbe3.length) return existing;
            throw new MusicValidationError(`歌曲 ID 冲突：${header.id} 已存在且内容不同`);
        }
        if (this.entriesCache.length >= WORLD_LIBRARY_MAX_SONGS) {
            throw new MusicValidationError(`全局曲库歌曲数量已达上限 ${WORLD_LIBRARY_MAX_SONGS}`);
        }
        const entry = this.collection.save(pbe3);
        this.reload();
        return entry;
    }

    remove(id: string): boolean {
        this.ensureLoaded();
        const removed = this.collection.remove(id);
        if (removed) this.reload();
        return removed;
    }

    usage(): StorageUsage {
        this.ensureLoaded();
        return { ...this.usageCache };
    }

    stats(): StorageUsage & { maxSongs: number } {
        return { ...this.usage(), maxSongs: WORLD_LIBRARY_MAX_SONGS };
    }

    /** 普通公共曲库使用独立命名空间；管理员接口继续使用原始 PBE3 ID。 */
    readonly publicSource = {
        list: (): MidiSongMeta[] => this.list().map(meta => ({ ...meta, id: worldPublicId(meta.id) })),
        get: (publicId: string): Promise<Uint8Array | undefined> => {
            const id = worldRawId(publicId);
            return id === undefined ? Promise.resolve(undefined) : this.get(id);
        },
        page: async (page: number, pageSize: number, query?: string) => {
            const result = this.pageSync(page, pageSize, query);
            return { total: result.total, items: result.items.map(meta => ({ ...meta, id: worldPublicId(meta.id) })) };
        },
        metaAll: async (query?: string) => this.metaAllSync(query).map(meta => ({ ...meta, id: worldPublicId(meta.id) })),
    };
}

/** 世界级公共曲库单例；启动时由 main 在 system.run 中加载索引。 */
export const worldLibrary = new WorldMusicLibrary();
