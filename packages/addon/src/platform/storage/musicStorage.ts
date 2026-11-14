import {
    MusicCollection,
    normalizeStorageLimit,
    type MusicStorageKv,
    type StoredMusicEntry,
    type StorageUsage,
} from "@piano/core";
import type { MusicStorage } from "@domain/music/storage";

/** 钢琴内置存储（显示实体动态属性）。 */
export const PIANO_STORAGE_PREFIX = "pb.piano.";
/** 存储卡正文（物品动态属性）。 */
export const CARD_STORAGE_PREFIX = "pb.card.";
/** 存储卡自身元数据（名称/UID/修订号），不占音乐容量。 */
export const CARD_META_PREFIX = "pb.cardmeta.";

/**
 * 动态属性上的音乐存储实现。
 *
 * - 钢琴：键写在显示实体上，随实体区块保存；
 * - 存储卡：键写在 ItemStack 上，跟着物品走。
 */
export class DynamicMusicStorage implements MusicStorage {
    private readonly collection: MusicCollection;
    private limitOverride?: number;

    constructor(
        kv: MusicStorageKv,
        readonly prefix: string,
        readonly kind: "piano" | "card",
        private readonly limitProvider: () => number,
        private readonly labelProvider: () => string
    ) {
        this.collection = new MusicCollection(kv, prefix, () => this.limitBytes);
    }

    get label(): string {
        return this.labelProvider();
    }

    get limitBytes(): number {
        return this.limitOverride ?? normalizeStorageLimit(this.limitProvider());
    }

    setLimit(limitBytes: number): void {
        this.limitOverride = normalizeStorageLimit(limitBytes, this.limitBytes);
    }

    /** 管理员修改配置后回到动态读取。 */
    resetLimit(): void {
        this.limitOverride = undefined;
    }

    list(): StoredMusicEntry[] {
        return this.collection.entries();
    }

    has(id: string): boolean {
        return this.collection.has(id);
    }

    get(id: string): Uint8Array | undefined {
        return this.collection.get(id);
    }

    save(pbe2: Uint8Array): StoredMusicEntry {
        return this.collection.save(pbe2);
    }

    remove(id: string): boolean {
        return this.collection.remove(id);
    }

    rename(id: string, name: string): StoredMusicEntry | undefined {
        return this.collection.rename(id, name);
    }

    usage(): StorageUsage {
        return this.collection.usage();
    }

    /** 迁移/拆琴：整体导出命名空间键值。 */
    exportRaw(): Record<string, string> {
        return this.collection.exportRaw();
    }

    importRaw(raw: Record<string, string>) {
        return this.collection.importRaw(raw);
    }

    verifyRaw(raw: Record<string, string>): boolean {
        return this.collection.verifyRaw(raw);
    }

    pruneOrphans(): number {
        return this.collection.pruneOrphans();
    }
}
