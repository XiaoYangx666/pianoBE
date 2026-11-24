import type { MusicRef, PerformanceCue, StoredMusicEntry, StorageUsage } from "@piano/core";

/**
 * 一份可写音乐存储。
 *
 * 当前唯一实现是音乐存储卡；领域层只描述能力，不关心背后是物品动态属性
 * 还是将来的容器，实现位于 platform/storage。
 */
export interface MusicStorage {
    /** 可展示的存储名称（卡名） */
    readonly label: string;
    list(): StoredMusicEntry[];
    has(id: string): boolean;
    get(id: string): Uint8Array | undefined;
    getPerformances?(id: string): readonly (readonly PerformanceCue[])[];
    save(bytes: Uint8Array): StoredMusicEntry;
    remove(id: string): boolean;
    rename(id: string, name: string): StoredMusicEntry | undefined;
    /** 调整曲目在存储中的顺序（存储卡播放列表）。 */
    move?(id: string, delta: number): boolean;
    usage(): StorageUsage;
    setLimit(limitBytes: number): void;
    /** 容量上限是否仍可写入（管理员下调后禁止新增，但允许读取/删除） */
    readonly limitBytes: number;
}

/** 把存储卡条目转换成队列引用；cardUid 用于区分不同实体卡。 */
export function storageRef(entry: StoredMusicEntry, cardUid?: string): MusicRef {
    const ref: MusicRef = {
        id: entry.id,
        name: entry.name,
        duration: entry.duration,
        noteCount: entry.noteCount,
        bytes: entry.bytes,
        checksum: entry.checksum,
        source: "card",
    };
    if (cardUid) ref.cardUid = cardUid;
    return ref;
}
