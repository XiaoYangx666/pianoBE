import { decodeSongFromBinary } from "@piano/core";
import type { MidiSong } from "@piano/core";
import type { SongEntry } from "./types";

/**
 * MIDI 曲库：只含转换后的二进制曲目（midis/library → public/library），
 * 不含原始 .mid。目录 index.json（元信息）随页面加载，单曲二进制按需拉取。
 *
 * 播放量来自同源 Worker 的 D1 API；统计不可用时自动退化为 0，
 * 不影响静态曲库、试听与生成器主流程。
 */

export interface LibraryMeta {
    id: string;
    name: string;
    /** 已按 TIME_SCALE 缩放 */
    duration: number;
    noteCount: number;
    plays: number;
    adds: number;
}

interface StatsResponse {
    plays?: Record<string, number>;
    adds?: Record<string, number>;
}

let cachedIndex: LibraryMeta[] | null = null;
const songCache = new Map<string, MidiSong>();

async function loadStats(): Promise<Required<StatsResponse>> {
    try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StatsResponse;
        return {
            plays: data.plays ?? {},
            adds: data.adds ?? {},
        };
    } catch (e) {
        console.warn("[generator] 曲库统计不可用，使用 0 作为回退：", e);
        return { plays: {}, adds: {} };
    }
}

export async function loadLibraryIndex(): Promise<LibraryMeta[]> {
    if (cachedIndex) return cachedIndex;
    try {
        const [res, stats] = await Promise.all([
            fetch("./library/index.json?t=" + Date.now()),
            loadStats(),
        ]);
        if (!res.ok) throw new Error(`曲库目录加载失败: HTTP ${res.status}`);
        const index = (await res.json()) as Omit<LibraryMeta, "plays" | "adds">[];
        cachedIndex = index.map((meta) => ({
            ...meta,
            plays: stats.plays[meta.id] ?? 0,
            adds: stats.adds[meta.id] ?? 0,
        }));
    } catch (e) {
        console.error("[generator] 曲库目录加载失败：", e);
        cachedIndex = [];
    }
    return cachedIndex;
}

/**
 * 上报一次已成功开始的曲库试听。
 * 返回 true 表示这次通过了服务端 15 分钟去重并实际计数。
 */
export async function recordLibraryPlay(id: string): Promise<boolean> {
    try {
        const res = await fetch(`/api/songs/${encodeURIComponent(id)}/play`, {
            method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { counted?: boolean };
        return data.counted === true;
    } catch (e) {
        console.warn("[generator] 播放统计上报失败（不影响试听）：", e);
        return false;
    }
}

/** 上报一次已成功添加到列表的曲库歌曲。 */
export async function recordLibraryAdd(id: string): Promise<boolean> {
    try {
        const res = await fetch(`/api/songs/${encodeURIComponent(id)}/add`, {
            method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { counted?: boolean };
        return data.counted === true;
    } catch (e) {
        console.warn("[generator] 添加统计上报失败（不影响添加）：", e);
        return false;
    }
}

export async function loadLibrarySong(meta: LibraryMeta): Promise<MidiSong> {
    const hit = songCache.get(meta.id);
    if (hit) return hit;
    const res = await fetch(`./library/${meta.id}.bin`);
    if (!res.ok) throw new Error(`曲目二进制加载失败: HTTP ${res.status}`);
    const song = decodeSongFromBinary(new Uint8Array(await res.arrayBuffer()));
    songCache.set(meta.id, song);
    return song;
}

/** 曲库条目 → 生成器列表条目（二进制解码，导出时由 core 重新生成模块文本） */
export function libraryMetaToEntry(meta: LibraryMeta, song: MidiSong): SongEntry {
    return {
        id: meta.id,
        name: meta.name,
        duration: meta.duration,
        noteCount: meta.noteCount,
        isOriginal: false,
        fromLibrary: true,
        song,
    };
}
