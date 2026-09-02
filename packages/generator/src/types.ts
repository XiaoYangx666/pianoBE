import type { MidiSong } from "@piano/core";

/** 生成器列表条目：模板已有曲目（moduleText 原样保留）或新导入曲目（song） */
export interface SongEntry {
    id: string;
    name: string;
    /** 已按 TIME_SCALE 缩放 */
    duration: number;
    noteCount: number;
    isOriginal: boolean;
    /** 来自内置曲库（仅作标签展示，导出逻辑不变） */
    fromLibrary?: boolean;
    /** 模板中已存在的模块原文（导出时字节保真保留） */
    moduleText?: string;
    /** 新导入曲目（导出时由 core 生成模块文本） */
    song?: MidiSong;
}

export function toMeta(entry: SongEntry) {
    return { id: entry.id, name: entry.name, duration: entry.duration };
}