import type { MusicRef, StoredMusicEntry } from "@piano/core";
import { toMusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { importedMidiManager, midiManager } from "@app/midi";

export const PAGE_SIZE = 8;

export type LibraryTab = "piano" | "card" | "library" | "imported";

export const TAB_LABELS: Record<LibraryTab, string> = {
    piano: "当前钢琴",
    card: "当前存储卡",
    library: "内置/远程曲库",
    imported: "旧导入曲库",
};

export const TAB_ORDER: LibraryTab[] = ["piano", "card", "library", "imported"];

export interface TabPage {
    refs: MusicRef[];
    total: number;
    /** 数据源状态提示（如“未插卡”） */
    note?: string;
}

export function pageCount(total: number, size = PAGE_SIZE): number {
    return Math.max(1, Math.ceil(total / size));
}

function filterEntries(entries: StoredMusicEntry[], query: string): StoredMusicEntry[] {
    const q = query.trim().toLowerCase();
    return q ? entries.filter(entry => entry.name.toLowerCase().includes(q)) : entries;
}

/** 按来源取一页曲目引用（钢琴/卡为同步，曲库为异步分页）。 */
export async function listTab(
    piano: PianoRuntime,
    tab: LibraryTab,
    page: number,
    query: string
): Promise<TabPage> {
    if (tab === "piano") {
        const storage = piano.storage;
        if (!storage) return { refs: [], total: 0, note: "钢琴存储暂不可用" };
        const entries = filterEntries(storage.list(), query);
        const start = (page - 1) * PAGE_SIZE;
        return {
            refs: entries.slice(start, start + PAGE_SIZE).map(entry => toMusicRef("piano", entry)),
            total: entries.length,
        };
    }
    if (tab === "card") {
        const storage = piano.cardStorage;
        if (!storage) return { refs: [], total: 0, note: "§e卡槽为空，先插入一张音乐存储卡" };
        const entries = filterEntries(storage.list(), query);
        const start = (page - 1) * PAGE_SIZE;
        return {
            refs: entries.slice(start, start + PAGE_SIZE).map(entry => toMusicRef("card", entry)),
            total: entries.length,
        };
    }
    const manager = tab === "imported" ? importedMidiManager : midiManager;
    const result = await manager.page(page, PAGE_SIZE, query || undefined);
    return {
        refs: result.items.map(meta => toMusicRef("library", meta)),
        total: result.total,
    };
}

/** 队列条目的来源标记（按钮文本不支持颜色符号，只用纯文本前缀）。 */
export function sourceMark(ref: MusicRef): string {
    switch (ref.source) {
        case "piano": return "[琴]";
        case "card": return "[卡]";
        default: return "[库]";
    }
}

export function availabilityMark(state: "ok" | "missing" | "unknown"): string {
    return state === "ok" ? "" : state === "missing" ? "⚠ " : "? ";
}
