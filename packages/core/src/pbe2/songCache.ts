import { readPbe2Events } from "./codec.js";
import type { Pbe2Header, SeekIndexEntry } from "./format.js";
import { buildSeekIndex } from "./seekIndex.js";

/** SongCache 中一份被共享的已加载曲目 */
export interface LoadedSong {
    id: string;
    name: string;
    /** 时长（40 tick/秒） */
    duration: number;
    noteCount: number;
    header: Pbe2Header;
    /** 已解压的紧凑事件流（只读共享） */
    events: Uint8Array;
    /** 共享稀疏跳转索引 */
    index: SeekIndexEntry[];
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
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 统一曲目缓存：
 * - 所有来源（内嵌 / 导入 / 远程）都通过同一个 loader 返回 PBE2；
 * - 同一 id 只保留一份解压事件流与索引；
 * - 引用计数 + LRU + 内存预算；无活跃引用时允许淘汰，下次播放重新加载。
 */
export class SongCache {
    private readonly loaded = new Map<string, LoadedSong>();
    /** 并发加载合并：同一 id 的多个 acquire 共用一次加载 */
    private readonly pending = new Map<string, Promise<LoadedSong | undefined>>();
    private readonly maxBytes: number;
    private readonly now: () => number;
    private readonly indexStepTicks: number;
    private totalBytes = 0;

    constructor(
        private readonly load: (id: string) => Promise<Uint8Array | undefined>,
        options: SongCacheOptions = {}
    ) {
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.now = options.now ?? (() => Date.now());
        this.indexStepTicks = options.indexStepTicks ?? 200;
    }

    /**
     * 获取曲目引用。调用方必须在播放结束/切歌时 release()。
     * 未找到或加载失败返回 undefined（失败不会留下半成品缓存）。
     */
    async acquire(id: string): Promise<SongHandle | undefined> {
        const existing = this.loaded.get(id);
        if (existing) return this.acquireExisting(existing);

        let promise = this.pending.get(id);
        if (!promise) {
            promise = this.loadSong(id);
            this.pending.set(id, promise);
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

    /** 当前缓存的曲目数（调试/性能测试） */
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

    /** 丢弃所有无活跃引用的曲目（来源切换/手动清理） */
    clearUnused(): number {
        const now = this.now();
        let removed = 0;
        for (const [id, song] of [...this.loaded]) {
            if (song.refCount > 0) continue;
            song.lastAccess = now; // 仅用于记录，下面统一删除
            this.remove(id, song);
            removed++;
        }
        return removed;
    }

    /** 强制清空缓存（播放中的引用会失效，仅用于测试/关闭世界） */
    clear(): void {
        this.loaded.clear();
        this.pending.clear();
        this.totalBytes = 0;
    }

    stats() {
        return {
            songs: this.loaded.size,
            bytes: this.totalBytes,
            maxBytes: this.maxBytes,
            loading: this.pending.size,
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

    private async loadSong(id: string): Promise<LoadedSong | undefined> {
        let bytes: Uint8Array | undefined;
        try {
            bytes = await this.load(id);
        } catch {
            return undefined;
        }
        if (!bytes || bytes.length === 0) return undefined;

        try {
            const { header, events } = readPbe2Events(bytes);
            if (header.id !== id) {
                console.warn(`[songCache] 曲目 id 与请求不一致：${header.id} ≠ ${id}`);
                return undefined;
            }
            const index = buildSeekIndex(events, header.hasVelocity, this.indexStepTicks);
            const song: LoadedSong = {
                id: header.id,
                name: header.name,
                duration: header.duration,
                noteCount: header.noteCount,
                header,
                events,
                index,
                refCount: 0,
                lastAccess: this.now(),
                byteSize: events.byteLength + index.length * 24,
            };
            const previous = this.loaded.get(song.id);
            if (previous) {
                // 同一 id 已被另一次并发加载先放入：复用已有实例
                return previous;
            }
            this.loaded.set(song.id, song);
            this.totalBytes += song.byteSize;
            return song;
        } catch (error) {
            console.warn(`[songCache] 曲目 ${id} 解码失败`, error);
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
            this.remove(song.id, song);
        }
    }

    private remove(id: string, song: LoadedSong) {
        if (!this.loaded.delete(id)) return;
        this.totalBytes -= song.byteSize;
        if (this.totalBytes < 0) this.totalBytes = 0;
    }
}
