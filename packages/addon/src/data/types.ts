import type { MidiSongMeta } from "@piano/core";

/** 内嵌曲目元信息 + PBE2 模块懒加载，由 midis/js/index.js 生成。 */
export interface MidiInfo extends MidiSongMeta {
    /** 返回 PBE2 的 Base64URL 文本（模块默认导出） */
    value: () => Promise<string>;
}

export type MidiListType = MidiInfo[];
