import { DEFAULT_PERFORMANCE_ID, defaultPerformanceId } from "./domain.js";

/**
 * 音乐内容来源。
 *
 * 队列条目必须带上来源：同一份曲目可能同时存在于存储卡与公共曲库，
 * 只按 id 判断会把不同来源（甚至同 id 不同内容）混为一谈。
 */
export type MusicSource = "card" | "library";

export interface MusicSelection {
    id: string;
    name: string;
    duration: number;
    noteCount?: number;
    bytes?: number;
    source: MusicSource;
    /** 稳定演出标识："plain" 普通演奏，"default" 默认演出，或独立演出 ID。 */
    performanceId: string;
    /** 整份 PBE3 的 CRC32（16 进制，来源提供时用于内容校验） */
    checksum?: string;
    /**
     * 存储卡身份（卡来源）。
     *
     * 队列条目绑定写入/播放时的实体卡；换卡后即使 id 与内容相同也不会
     * 被误认为同一张卡上的曲目。
     */
    cardUid?: string;
}

/** 世界公共曲库在索引和队列中使用独立 ID，PBE3 文件头仍使用原始 ID。 */
export const WORLD_LIBRARY_PUBLIC_PREFIX = "world:";
export function worldPublicId(id: string): string { return `${WORLD_LIBRARY_PUBLIC_PREFIX}${id}`; }
export function worldRawId(id: string): string | undefined {
    return id.startsWith(WORLD_LIBRARY_PUBLIC_PREFIX) ? id.slice(WORLD_LIBRARY_PUBLIC_PREFIX.length) : undefined;
}

export function isDefaultPerformanceSelection(songId: string, performanceId: string): boolean {
    const rawId = worldRawId(songId);
    return performanceId === DEFAULT_PERFORMANCE_ID || performanceId === defaultPerformanceId(songId) ||
        (rawId !== undefined && performanceId === defaultPerformanceId(rawId));
}

/** 缓存键同时包含实体卡身份，避免不同卡片的缓存串用。 */
export function musicRefKey(ref: Pick<MusicSelection, "source" | "id" | "checksum" | "cardUid">): string {
    return `${ref.source}:${ref.id}:${ref.checksum ?? ""}:${ref.source === "card" ? ref.cardUid ?? "" : ""}`;
}

/** 卡片歌曲还必须属于同一张实体卡。 */
export function sameMusicSelection(
    a: MusicSelection,
    b: MusicSelection
): boolean {
    return a.id === b.id && a.source === b.source && (a.checksum ?? "") === (b.checksum ?? "")
        && a.performanceId === b.performanceId
        && (a.source !== "card" || (a.cardUid ?? "") === (b.cardUid ?? ""));
}

/** 只复制队列需要的字段，允许调用方显式更新演出选择。 */
export function toMusicSelection(
    track: Omit<MusicSelection, "performanceId">,
    performanceId: string,
): MusicSelection {
    const ref: MusicSelection = { id: track.id, name: track.name, duration: track.duration, source: track.source, performanceId };
    if (track.noteCount !== undefined) ref.noteCount = track.noteCount;
    if (track.bytes !== undefined) ref.bytes = track.bytes;
    if (track.checksum !== undefined) ref.checksum = track.checksum;
    if (track.source === "card" && track.cardUid !== undefined) ref.cardUid = track.cardUid;
    return ref;
}

const SOURCE_LABELS: Record<MusicSource, string> = {
    card: "存储卡",
    library: "公共曲库",
};

export function musicSourceLabel(source: MusicSource): string {
    return SOURCE_LABELS[source] ?? "曲库";
}
