import {
    MusicCollection,
    normalizeStorageLimit,
    type MusicStorageKv,
    type StoredMusicEntry,
    type StorageUsage,
} from "@piano/core";
import type { MusicStorage } from "@domain/music/storage";

/** 存储卡正文（物品动态属性）。 */
export const CARD_STORAGE_PREFIX = "pb.card.";
/** 存储卡自身元数据（名称/UID/修订号/播放顺序），不占音乐容量。 */
export const CARD_META_PREFIX = "pb.cardmeta.";

/** 存储卡播放顺序端口：顺序与歌曲正文分开保存。 */
export interface MusicOrderPort {
    read(): readonly string[];
    write(ids: readonly string[]): void;
}

/** 用持久化顺序排列曲目；未知/缺失的曲目按存储默认顺序补到末尾。 */
export function applyMusicOrder(
    entries: readonly StoredMusicEntry[],
    order: readonly string[]
): StoredMusicEntry[] {
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const seen = new Set<string>();
    const result: StoredMusicEntry[] = [];
    for (const id of order) {
        const entry = byId.get(id);
        if (!entry || seen.has(id)) continue;
        seen.add(id);
        result.push(entry);
    }
    for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        result.push(entry);
    }
    return result;
}

/**
 * 动态属性上的音乐存储实现。
 *
 * 只有存储卡：键写在 ItemStack 上，跟着物品走。
 */
export class DynamicMusicStorage implements MusicStorage {
    private readonly collection: MusicCollection;
    private limitOverride?: number;

    constructor(
        kv: MusicStorageKv,
        readonly prefix: string,
        private readonly limitProvider: () => number,
        private readonly labelProvider: () => string,
        private readonly order?: MusicOrderPort
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
        const entries = this.collection.entries();
        if (!this.order) return entries;
        try {
            return applyMusicOrder(entries, this.order.read());
        } catch {
            return entries;
        }
    }

    has(id: string): boolean {
        return this.collection.has(id);
    }

    get(id: string): Uint8Array | undefined {
        return this.collection.get(id);
    }

    save(pbe2: Uint8Array): StoredMusicEntry {
        const entry = this.collection.save(pbe2);
        this.syncOrder();
        return entry;
    }

    remove(id: string): boolean {
        const removed = this.collection.remove(id);
        if (removed) this.syncOrder();
        return removed;
    }

    rename(id: string, name: string): StoredMusicEntry | undefined {
        return this.collection.rename(id, name);
    }

    /** 在持久化播放顺序中移动指定曲目。 */
    move(id: string, delta: number): boolean {
        if (!this.order || !Number.isInteger(delta) || delta === 0) return false;
        const ids = this.list().map(entry => entry.id);
        const from = ids.indexOf(id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= ids.length) return false;
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        this.order.write(ids);
        return true;
    }

    usage(): StorageUsage {
        return this.collection.usage();
    }

    /** 迁移/拆琴：整体导出命名空间键值。 */
    exportRaw(): Record<string, string> {
        return this.collection.exportRaw();
    }

    importRaw(raw: Record<string, string>) {
        const result = this.collection.importRaw(raw);
        this.syncOrder();
        return result;
    }

    verifyRaw(raw: Record<string, string>): boolean {
        return this.collection.verifyRaw(raw);
    }

    pruneOrphans(): number {
        return this.collection.pruneOrphans();
    }

    /** 新增/删除后把持久化顺序规范化为“现有曲目全集”。 */
    private syncOrder() {
        if (!this.order) return;
        try {
            const entries = this.collection.entries();
            const ids = applyMusicOrder(entries, this.order.read()).map(entry => entry.id);
            this.order.write(ids);
        } catch {
            // 卡片已被移走/替换时，顺序下次读取会按默认顺序补齐。
        }
    }
}
