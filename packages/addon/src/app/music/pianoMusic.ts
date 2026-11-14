import {
    SongCache,
    crc32Hex,
    musicRefKey,
    toMusicRef,
    type MusicRef,
    type SongHandle,
    type StoredMusicEntry,
} from "@piano/core";
import type { MusicStorage } from "@domain/music/storage";
import { storageRef } from "@domain/music/storage";
import { midiManager } from "@app/midiManager";

export type TrackAvailability = "ok" | "missing" | "unknown";

/**
 * 一架钢琴的音乐读取入口：
 * - 钢琴内置 / 存储卡：按内容指纹（长度 + CRC32）校验后才交给播放器；
 * - 内置/远程曲库：复用 midiManager 的共享 SongCache；
 * - 本地缓存键包含来源与指纹，同 id 不同内容不会互相污染。
 */
export class PianoMusic {
    private readonly cache: SongCache;
    private readonly loaders = new Map<string, () => Uint8Array | undefined>();

    constructor(
        private readonly pianoStorageProvider: () => MusicStorage | undefined,
        private readonly cardStorageProvider: () => MusicStorage | undefined
    ) {
        this.cache = new SongCache((key) => this.load(key), {
            maxBytes: 2 * 1024 * 1024,
            // key = source:id:checksum；id 不含冒号。
            verify: (key, header) => key.split(":")[1] === header.id,
        });
    }

    private async load(key: string): Promise<Uint8Array | undefined> {
        return this.loaders.get(key)?.();
    }

    private read(storage: MusicStorage | undefined, ref: MusicRef): Uint8Array | undefined {
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
        const key = musicRefKey(ref);
        this.loaders.set(key, () => this.read(
            ref.source === "piano" ? this.pianoStorageProvider() : this.cardStorageProvider(),
            ref
        ));
        try {
            return await this.cache.acquire(key);
        } finally {
            this.loaders.delete(key);
        }
    }

    /** 曲库来源的原始 PBE2（跨存储复制用）。 */
    readLibrary(id: string): Promise<Uint8Array | undefined> {
        return midiManager.read(id);
    }

    /** 队列 UI 用：这首歌现在还能不能读到。 */
    availability(ref: MusicRef): TrackAvailability {
        if (ref.source === "library") return midiManager.getInfo(ref.id) ? "ok" : "unknown";
        const storage = ref.source === "piano" ? this.pianoStorageProvider() : this.cardStorageProvider();
        if (!storage) return "missing";
        const entry = storage.list().find(item => item.id === ref.id);
        if (!entry) return "missing";
        if (ref.checksum && entry.checksum !== ref.checksum) return "missing";
        if (ref.bytes && entry.bytes !== ref.bytes) return "missing";
        return "ok";
    }

    /** 从存储条目生成队列引用。 */
    static track(storage: MusicStorage, entry: StoredMusicEntry): MusicRef {
        return storageRef(storage.kind, entry);
    }

    /** 曲库条目 → 队列引用。 */
    static libraryTrack(meta: { id: string; name: string; duration: number }): MusicRef {
        return toMusicRef("library", meta);
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
