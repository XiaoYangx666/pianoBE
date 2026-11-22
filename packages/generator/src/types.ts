import { TIME_SCALE } from "@piano/core";

/** 生成器列表条目：模板已有曲目（保留模块原文）或新导入曲目（PBE3） */
export interface SongEntry {
    id: string;
    name: string;
    /** 已按 TIME_SCALE 缩放 */
    duration: number;
    noteCount: number;
    isOriginal: boolean;
    /** 来自内置曲库（仅作标签展示，导出逻辑不变） */
    fromLibrary?: boolean;
    /** 模板中已存在的模块原文（导出时仍会从 PBE3 确定性重建） */
    moduleText?: string;
    /** PBE3 二进制（所有新导入/曲库/模板曲目统一携带） */
    data?: Uint8Array;
    /** 同时发声峰值（导入时预计算；仅用于提示，不写入 PBE3） */
    voicePeak?: number;
}

export function formatSongDuration(scaled: number): string {
    const seconds = Math.max(0, Math.floor(scaled / TIME_SCALE));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
