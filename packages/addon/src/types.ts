import { Dimension, Vector3 } from "@minecraft/server";
import type { MidiSong, MidiSongMeta } from "@piano/core";

export type { MidiSong, MidiSongMeta, MidiTrack, MidiTrackInstrument, PlaylistMeta } from "@piano/core";

export type Cardinal_Direction = "east" | "west" | "north" | "south";

export interface NoteInfo {
    name: string;
    sample: string;
    pitch: number;
    midi: number;
}
/**钢琴信息 */
export interface PianoEnv {
    pos: Vector3;
    dim: Dimension;
    dir: Cardinal_Direction;
}
//键盘映射
export interface KeyMapInfo {
    name: string;
    value: KeyMap;
}
export type KeyMap = Record<string, number>;

/**内嵌曲目条目：元信息 + 懒加载器（构建期由 midis/js/index.js 生成） */
export interface MidiInfo extends MidiSongMeta {
    value: () => Promise<MidiSong>;
}

export type MidiListType = MidiInfo[];