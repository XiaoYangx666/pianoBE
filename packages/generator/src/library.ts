import { decodeSongFromBinary } from "@piano/core";
import type { MidiSong } from "@piano/core";
import type { SongEntry } from "./types";

/**
 * MIDI 曲库：只含转换后的二进制曲目（midis/library → public/library），
 * 不含原始 .mid。目录 index.json（元信息）随页面加载，单曲二进制按需拉取。
 */

export interface LibraryMeta {
    id: string;
    name: string;
    /** 已按 TIME_SCALE 缩放 */
    duration: number;
    noteCount: number;
}

let cachedIndex: LibraryMeta[] | null = null;
const songCache = new Map<string, MidiSong>();

export async function loadLibraryIndex(): Promise<LibraryMeta[]> {
    if (cachedIndex) return cachedIndex;
    try {
        const res = await fetch("./library/index.json?t=" + Date.now());
        if (!res.ok) throw new Error(`曲库目录加载失败: HTTP ${res.status}`);
        cachedIndex = (await res.json()) as LibraryMeta[];
    } catch (e) {
        console.error("[generator] 曲库目录加载失败：", e);
        cachedIndex = [];
    }
    return cachedIndex;
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