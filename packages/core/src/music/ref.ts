import type { MidiSongMeta } from "../types.js";

/**
 * 音乐内容来源。
 *
 * 队列条目必须带上来源：同一份曲目可能同时存在于钢琴、存储卡与内置/远程曲库，
 * 只按 id 判断会把不同来源（甚至同 id 不同内容）混为一谈。
 */
export type MusicSource = "piano" | "card" | "library";

export interface MusicRef extends MidiSongMeta {
    source: MusicSource;
    /** PBE2 音符总数（来源提供时用于展示） */
    noteCount?: number;
    /** PBE2 原始字节数（来源提供时用于内容校验） */
    bytes?: number;
    /** 整份 PBE2 的 CRC32（16 进制，来源提供时用于内容校验） */
    checksum?: string;
}

/** 缓存/去重键：来源 + id + 内容指纹。 */
export function musicRefKey(ref: Pick<MusicRef, "source" | "id" | "checksum">): string {
    return `${ref.source}:${ref.id}:${ref.checksum ?? ""}`;
}

/** 队列身份：同来源、同 id、同内容指纹才算同一首。 */
export function sameMusicRef(
    a: Pick<MusicRef, "source" | "id" | "checksum">,
    b: Pick<MusicRef, "source" | "id" | "checksum">
): boolean {
    return a.id === b.id && a.source === b.source && (a.checksum ?? "") === (b.checksum ?? "");
}

/** 把存储条目/曲库元信息统一转换为队列引用。 */
export function toMusicRef(
    source: MusicSource,
    meta: MidiSongMeta & { noteCount?: number; bytes?: number; checksum?: string }
): MusicRef {
    const ref: MusicRef = { id: meta.id, name: meta.name, duration: meta.duration, source };
    if (meta.noteCount !== undefined) ref.noteCount = meta.noteCount;
    if (meta.bytes !== undefined) ref.bytes = meta.bytes;
    if (meta.checksum !== undefined) ref.checksum = meta.checksum;
    return ref;
}

const SOURCE_LABELS: Record<MusicSource, string> = {
    piano: "钢琴",
    card: "存储卡",
    library: "曲库",
};

export function musicSourceLabel(source: MusicSource): string {
    return SOURCE_LABELS[source] ?? "曲库";
}

/** 旧版播放快照只有 id/name/duration（无 source），统一视为曲库来源。 */
export function normalizeMusicRef(value: unknown): MusicRef | undefined {
    if (!value || typeof value !== "object") return;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.name !== "string" ||
        typeof raw.duration !== "number" || !Number.isFinite(raw.duration)) return;
    const source: MusicSource =
        raw.source === "piano" || raw.source === "card" ? raw.source : "library";
    const ref: MusicRef = { id: raw.id, name: raw.name, duration: raw.duration, source };
    if (typeof raw.noteCount === "number" && Number.isFinite(raw.noteCount)) ref.noteCount = raw.noteCount;
    if (typeof raw.bytes === "number" && Number.isFinite(raw.bytes) && raw.bytes > 0) ref.bytes = raw.bytes;
    if (typeof raw.checksum === "string" && /^[0-9a-f]{1,8}$/i.test(raw.checksum)) ref.checksum = raw.checksum;
    return ref;
}
