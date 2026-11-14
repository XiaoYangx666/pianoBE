import type { MusicRef, StoredMusicEntry, StorageUsage } from "@piano/core";

/**
 * 一份音乐存储（钢琴内置 / 存储卡）。
 *
 * 领域层只描述能力，不关心背后是实体动态属性还是物品动态属性；
 * 实现在 platform/storage 中，将来换成方块容器只需替换适配层。
 */
export interface MusicStorage {
    /** 存储归属：钢琴内置或存储卡 */
    readonly kind: "piano" | "card";
    /** 可展示的存储名称（钢琴名/卡名） */
    readonly label: string;
    list(): StoredMusicEntry[];
    has(id: string): boolean;
    get(id: string): Uint8Array | undefined;
    save(pbe2: Uint8Array): StoredMusicEntry;
    remove(id: string): boolean;
    rename(id: string, name: string): StoredMusicEntry | undefined;
    usage(): StorageUsage;
    setLimit(limitBytes: number): void;
    /** 容量上限是否仍可写入（管理员下调后禁止新增，但允许读取/删除） */
    readonly limitBytes: number;
}

/** 存储摘要（DDUI 头部展示用，避免重复计算）。 */
export interface MusicStorageView {
    songs: number;
    usedBytes: number;
    limitBytes: number;
    remainingBytes: number;
}

export function storageView(storage: MusicStorage): MusicStorageView {
    const usage = storage.usage();
    return {
        songs: usage.songs,
        usedBytes: usage.usedBytes,
        limitBytes: usage.limitBytes,
        remainingBytes: usage.remainingBytes,
    };
}

/** 把存储条目转换成队列引用。 */
export function storageRef(source: "piano" | "card", entry: StoredMusicEntry): MusicRef {
    return {
        id: entry.id,
        name: entry.name,
        duration: entry.duration,
        noteCount: entry.noteCount,
        bytes: entry.bytes,
        checksum: entry.checksum,
        source,
    };
}
