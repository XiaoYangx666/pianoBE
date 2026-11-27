import type { MidiSongMeta, MusicSelection, StoredMusicEntry } from "@piano/core";
import { toMusicSelection } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { midiManager } from "@app/midi";
import { storageRef } from "@domain/music/storage";

export const PAGE_SIZE = 5;

export type LibraryTab = "library" | "card";

export const TAB_LABELS: Record<LibraryTab, string> = {
    library: "公共曲库",
    card: "当前存储卡",
};

export const TAB_ORDER: LibraryTab[] = ["library", "card"];

export interface TabPage {
    refs: MusicSelection[];
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

/** 解析搜索框：末尾独立的 `p数字` 是页码指令，其余部分作为关键词。 */
export function parseLibrarySearch(raw: string): { query: string; page?: number } {
    const text = raw.trim();
    const match = /(^|\s)[pP](\d+)\s*$/.exec(text);
    if (!match) return { query: text };
    const page = Number(match[2]);
    return {
        query: text.slice(0, match.index).trim(),
        page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    };
}

/** 搜索框显示文本：关键词 + 当前页码（第 1 页不显示页码）。 */
export function formatLibrarySearch(query: string, page: number): string {
    const keyword = query.trim();
    return page > 1 ? `${keyword} p${page}`.trim() : keyword;
}

/** 远程曲库条目可能带 dataSize，将它归一化为统一的 bytes 字段。 */
function libraryRef(meta: MidiSongMeta & { dataSize?: number }): MusicSelection {
    return toMusicSelection({
        ...meta,
        source: "library",
        bytes: meta.bytes ?? meta.dataSize,
    }, "default");
}

/** 按来源取一页曲目引用（存储卡为同步，公共曲库为异步分页）。 */
export async function listTab(
    piano: PianoRuntime,
    tab: LibraryTab,
    page: number,
    query: string,
    libraryId?: string,
): Promise<TabPage> {
    if (tab === "card") {
        const storage = piano.cardStorage;
        if (!storage) return { refs: [], total: 0, note: "§e卡槽为空，先插入一张音乐存储卡" };
        const entries = filterEntries(storage.list(), query);
        const start = (page - 1) * PAGE_SIZE;
        const uid = piano.cardUid;
        return {
            refs: entries.slice(start, start + PAGE_SIZE).map(entry => storageRef(entry, uid)),
            total: entries.length,
        };
    }
    const result = await midiManager.page(page, PAGE_SIZE, query || undefined, libraryId || undefined);
    return {
        refs: result.items.map(libraryRef),
        total: result.total,
    };
}

/** 队列条目的来源标记（按钮文本不支持颜色符号，只用纯文本前缀）。 */
export function sourceMark(ref: MusicSelection): string {
    return ref.source === "card" ? "[卡]" : "[库]";
}

export function availabilityMark(state: "ok" | "missing" | "unknown"): string {
    return state === "ok" ? "" : state === "missing" ? "⚠ " : "? ";
}
