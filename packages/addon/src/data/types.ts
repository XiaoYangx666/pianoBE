import type { MidiSong, MidiSongMeta } from "@piano/core";

/** 内嵌曲目元信息 + 懒加载内容，由 midis/js/index.js 生成。 */
export interface MidiInfo extends MidiSongMeta {
    value: () => Promise<MidiSong>;
}

export type MidiListType = MidiInfo[];
