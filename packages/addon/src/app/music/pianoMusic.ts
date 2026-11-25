import {
    SongCache,
    crc32Hex,
    defaultPerformanceId,
    musicRefKey,
    type MusicRef,
    type PerformanceCue,
    type PerformanceDescriptor,
    type SongHandle,
} from "@piano/core";
import type { MusicStorage } from "@domain/music/storage";
import { midiManager } from "@app/midiManager";
import { PIANO_LOCAL_CACHE_BYTES } from "@app/pianoConfig";

export type TrackAvailability = "ok" | "missing" | "unknown";

/**
 * 一架钢琴的音乐读取入口：
 * - 存储卡：绑定卡片身份，按内容指纹（长度 + CRC32）校验后才交给播放器；
 * - 公共曲库：复用 midiManager 的共享 SongCache；
 * - 本地缓存键包含来源与指纹，同 id 不同内容不会互相污染。
 */
export class PianoMusic {
    private readonly cache: SongCache;
    private readonly loaders = new Map<string, () => Uint8Array | undefined>();

    constructor(
        private readonly cardStorageProvider: () => MusicStorage | undefined,
        private readonly cardUidProvider: () => string | undefined
    ) {
        this.cache = new SongCache((key) => this.load(key), {
            maxBytes: PIANO_LOCAL_CACHE_BYTES,
            // key = source:id:checksum；id 不含冒号。
            verify: (key, header) => key.split(":")[1] === header.id,
        });
    }

    private async load(key: string): Promise<Uint8Array | undefined> {
        return this.loaders.get(key)?.();
    }

    /** 卡片身份必须与队列条目一致，避免换卡后误读另一张卡上的同 id 曲目。 */
    private cardMatches(ref: MusicRef): boolean {
        if (ref.source !== "card" || ref.cardUid === undefined) return true;
        return this.cardUidProvider() === ref.cardUid;
    }

    private readCard(ref: MusicRef): Uint8Array | undefined {
        if (!this.cardMatches(ref)) return undefined;
        const storage = this.cardStorageProvider();
        if (!storage) return undefined;
        const bytes = storage.get(ref.id);
        if (!bytes) return undefined;
        // 队列里记录的内容指纹必须与当前存储一致，否则视为“同 id 不同内容”。
        if (ref.bytes !== undefined && bytes.length !== ref.bytes) return undefined;
        if (ref.checksum !== undefined && crc32Hex(bytes) !== ref.checksum) return undefined;
        return bytes;
    }

    async acquire(ref: MusicRef): Promise<SongHandle | undefined> {
        if (ref.source === "library") return midiManager.acquire(ref.id);
        // 命中 SongCache 时不会执行 readCard，故每次新播放都必须先确认卡片仍可用。
        if (this.availability(ref) !== "ok") return undefined;
        const key = musicRefKey(ref);
        this.loaders.set(key, () => this.readCard(ref));
        try {
            return await this.cache.acquire(key);
        } finally {
            this.loaders.delete(key);
        }
    }

    /** 曲库来源的原始 PBE3（复制到存储卡用）。 */
    readLibrary(id: string): Promise<Uint8Array | undefined> {
        return midiManager.read(id);
    }

    performances(ref: MusicRef) {
        if (ref.source === "library") {
            const list = midiManager.performances(ref.id);
            if (list.length) return list;
            return ref.performances ?? this.libraryEntries(ref).flatMap((entry) => entry.cues ? [entry.cues] : []);
        }
        return this.cardMatches(ref) ? this.cardStorageProvider()?.getPerformances?.(ref.id) ?? [] : [];
    }

    performanceEntries(ref: MusicRef): readonly PerformanceDescriptor[] {
        if (ref.source === "library") return this.libraryEntries(ref);
        if (!this.cardMatches(ref)) return [];
        const entries = this.cardStorageProvider()?.getPerformanceEntries?.(ref.id);
        if (entries) {
            return entries.map((entry) => ({
                id: entry.id,
                name: entry.name,
                ...(entry.author ? { author: entry.author } : {}),
                songId: ref.id,
                cues: entry.cues,
            }));
        }
        return (this.cardStorageProvider()?.getPerformances?.(ref.id) ?? []).map((cues, index) => ({
            id: `extra:${index + 1}`,
            name: `附加演出 ${index + 1}`,
            songId: ref.id,
            cues,
        }));
    }

    /**
     * 公共曲库演出摘要：优先用 MidiManager 的索引；远程分页结果尚未登记
     * （例如世界曲库刷新后）时退回引用自身携带的摘要，避免只剩默认演出。
     */
    private libraryEntries(ref: MusicRef): readonly PerformanceDescriptor[] {
        const indexed = midiManager.performanceEntries(ref.id);
        if (indexed.length) return indexed;
        if (ref.performanceEntries?.length) return ref.performanceEntries;
        return (ref.performances ?? []).map((cues, index) => ({
            id: `${ref.id}:perf:${index + 1}`,
            name: `附加演出 ${index + 1}`,
            songId: ref.id,
            cues,
        }));
    }

    async resolvePerformanceCues(ref: MusicRef, performanceId: string): Promise<readonly PerformanceCue[] | undefined> {
        if (performanceId === "plain") return undefined;
        if (ref.source === "library") {
            const local = this.libraryEntries(ref).find((entry) => entry.id === performanceId);
            if (local?.cues) return local.cues;
            return midiManager.resolvePerformanceCues(ref.id, performanceId);
        }
        const entries = this.performanceEntries(ref);
        const match = entries.find((item) => item.id === performanceId);
        if (match?.cues) return match.cues;
        if (performanceId === "default" || performanceId === defaultPerformanceId(ref.id)) {
            const handle = await this.acquire(ref);
            try {
                return handle?.song.header.performance;
            } finally {
                handle?.release();
            }
        }
        return undefined;
    }

    /** 队列 UI 用：这首歌现在还能不能读到。 */
    availability(ref: MusicRef): TrackAvailability {
        if (ref.source === "library") return midiManager.getInfo(ref.id) ? "ok" : "unknown";
        if (!this.cardMatches(ref)) return "missing";
        const storage = this.cardStorageProvider();
        if (!storage) return "missing";
        const entry = storage.list().find(item => item.id === ref.id);
        if (!entry) return "missing";
        if (ref.checksum && entry.checksum !== ref.checksum) return "missing";
        if (ref.bytes && entry.bytes !== ref.bytes) return "missing";
        return "ok";
    }

    /** 缓存诊断：驻留/活跃/淘汰统计。 */
    cacheStats() {
        return this.cache.stats();
    }

    /** 释放本地缓存中无引用的曲目（拆琴/换卡后调用）。 */
    clearUnused(): void {
        this.cache.clearUnused();
    }

    dispose(): void {
        this.loaders.clear();
        this.cache.clear();
    }
}
