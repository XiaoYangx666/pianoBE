import { reportDiagnostic } from "../diagnostics.js";
import { readPbe3Events } from "./codec.js";
import type { Pbe3Header, Pbe3SeekIndexEntry } from "./format.js";
import { buildPbe3SeekIndex } from "./seekIndex.js";

/** SongCache 中一份被共享的已加载曲目 */
export interface LoadedSong {
    /** 缓存键（默认等于曲目 id；跨存储来源时为 `source:id:checksum`） */
    key: string;
    id: string;
    name: string;
    /** 时长（40 tick/秒） */
    duration: number;
    noteCount: number;
    header: Pbe3Header;
    /** 已解压的紧凑事件流（只读共享） */
    events: Uint8Array;
    /** 歌曲级力度调色板 */
    palette: readonly number[];
    /** 力度索引位数 */
    velocityBits: number;
    /** 共享稀疏跳转索引 */
    index: Pbe3SeekIndexEntry[];
    /** 当前引用数（每个钢琴播放状态 +1） */
    refCount: number;
    /** LRU 时间戳 */
    lastAccess: number;
    /** 估算常驻字节数（事件流 + 索引） */
    byteSize: number;
}

export interface SongHandle {
    readonly song: LoadedSong;
    release(): void;
}

export interface SongCacheOptions {
    /** 事件流常驻内存预算（默认 4MB） */
    maxBytes?: number;
    /** 时钟注入（测试用） */
    now?: () => number;
    /** 稀疏索引间隔（tick） */
    indexStepTicks?: number;
    /**
     * 缓存键 → 解码后头部的校验规则。
     * 默认要求 `header.id === key`（纯 id 键）；跨存储来源（`source:id:checksum`）
     * 由调用方提供，用于拒绝“同 id 不同内容”的数据。
     */
    verify?: (key: string, header: Pbe3Header) => boolean;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 统一曲目缓存：
 * - 所有来源（内嵌 / 卡带 / 远程）都通过同一个 loader 返回 PBE3；
 * - 同一 id 只有一份解压事件流，多个播放器共享；
 * - 引用计数 + LRU + 内存预算；无活跃引用时按时间淘汰，下次按需重载。
 */
export class SongCache {
    private readonly loaded = new Map<string, LoadedSong>();
    /** 并发加载合并：同一 id 的多次 acquire 只触发一次加载 */
    private readonly pending = new Map<string, Promise<LoadedSong | undefined>>();
    private readonly maxBytes: number;
    private readonly now: () => number;
    private readonly indexStepTicks: number;
    private readonly verify: (key: string, header: Pbe3Header) => boolean;
    private totalBytes = 0;
    private hits = 0;
    private misses = 0;
    private evictions = 0;

    constructor(
        private readonly load: (key: string) => Promise<Uint8Array | undefined>,
        options: SongCacheOptions = {}
    ) {
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.now = options.now ?? (() => Date.now());
        this.indexStepTicks = options.indexStepTicks ?? 200;
        this.verify = options.verify ?? ((key, header) => header.id === key);
    }

    /**
     * 获取曲目引用。调用方负责在不再播放/切歌时 release()。
     * 未找到或加载失败返回 undefined（失败不写入缓存）。
     */
    async acquire(id: string): Promise<SongHandle | undefined> {
        const existing = this.loaded.get(id);
        if (existing) {
            this.hits++;
            return this.acquireExisting(existing);
        }

        let promise = this.pending.get(id);
        if (!promise) {
            this.misses++;
            promise = this.loadSong(id);
            this.pending.set(id, promise);
        } else {
            this.hits++;
        }
        let song: LoadedSong | undefined;
        try {
            song = await promise;
        } finally {
            if (this.pending.get(id) === promise) this.pending.delete(id);
        }
        if (!song) return undefined;
        const handle = this.acquireExisting(song);
        this.evict();
        return handle;
    }

    /** 当前缓存的曲目数量（调试/性能测试） */
    get size(): number {
        return this.loaded.size;
    }

    /** 当前事件流 + 索引常驻字节数 */
    get bytes(): number {
        return this.totalBytes;
    }

    /** 已加载 id 列表 */
    ids(): string[] {
        return [...this.loaded.keys()];
    }

    /** 清理所有无活跃引用的曲目（资源切换/手动清理） */
    clearUnused(): number {
        const now = this.now();
        let removed = 0;
        for (const [id, song] of [...this.loaded]) {
            if (song.refCount > 0) continue;
            song.lastAccess = now;
            this.remove(id, song);
            removed++;
        }
        return removed;
    }

    /** 强制清空缓存（所有引用失效；用于测试/关服） */
    clear(): void {
        this.loaded.clear();
        this.pending.clear();
        this.totalBytes = 0;
    }

    stats() {
        let activeSongs = 0;
        let activeBytes = 0;
        for (const song of this.loaded.values()) {
            if (song.refCount <= 0) continue;
            activeSongs++;
            activeBytes += song.byteSize;
        }
        return {
            songs: this.loaded.size,
            bytes: this.totalBytes,
            maxBytes: this.maxBytes,
            loading: this.pending.size,
            activeSongs,
            activeBytes,
            evictions: this.evictions,
            hits: this.hits,
            misses: this.misses,
        };
    }

    private acquireExisting(song: LoadedSong): SongHandle {
        song.refCount++;
        song.lastAccess = this.now();
        let released = false;
        return {
            song,
            release: () => {
                if (released) return;
                released = true;
                this.release(song);
            },
        };
    }

    private async loadSong(key: string): Promise<LoadedSong | undefined> {
        let bytes: Uint8Array | undefined;
        try {
            bytes = await this.load(key);
        } catch {
            return undefined;
        }
        if (!bytes || bytes.length === 0) return undefined;

        try {
            const { header, events } = readPbe3Events(bytes);
            if (!this.verify(key, header)) {
                reportDiagnostic("warn", "songCache", "曲目校验失败", undefined, {
                    requested: key,
                    actual: header.id,
                });
                return undefined;
            }
            const index = buildPbe3SeekIndex(events, header.velocityBits, this.indexStepTicks);
            const song: LoadedSong = {
                key,
                id: header.id,
                name: header.name,
                duration: header.duration,
                noteCount: header.noteCount,
                header,
                events,
                palette: header.palette,
                velocityBits: header.velocityBits,
                index,
                refCount: 0,
                lastAccess: this.now(),
                byteSize: events.byteLength + index.length * 24 + (header.performance?.length ?? 0) * 64,
            };
            const previous = this.loaded.get(key);
            if (previous) {
                // 同一键已被另一次并发加载先放入：复用已有实例
                return previous;
            }
            this.loaded.set(key, song);
            this.totalBytes += song.byteSize;
            return song;
        } catch (error) {
            reportDiagnostic("warn", "songCache", "曲目解码失败", error, { key });
            return undefined;
        }
    }

    private release(song: LoadedSong) {
        song.refCount = Math.max(0, song.refCount - 1);
        song.lastAccess = this.now();
        this.evict();
    }

    /** LRU 淘汰：只淘汰无活跃引用的曲目 */
    private evict() {
        if (this.totalBytes <= this.maxBytes) return;
        const candidates = [...this.loaded.values()]
            .filter((song) => song.refCount === 0)
            .sort((a, b) => a.lastAccess - b.lastAccess);
        for (const song of candidates) {
            if (this.totalBytes <= this.maxBytes) break;
            this.remove(song.key, song);
            this.evictions++;
        }
    }

    private remove(id: string, song: LoadedSong) {
        if (!this.loaded.delete(id)) return;
        this.totalBytes -= song.byteSize;
        if (this.totalBytes < 0) this.totalBytes = 0;
    }
}
