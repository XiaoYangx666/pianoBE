export type { MidiSong, MidiSongMeta, MidiTrack, MidiTrackInstrument, NoteInfo } from "@piano/core";

export type Cardinal_Direction = "east" | "west" | "north" | "south";

//键盘映射
export interface KeyMapInfo {
    name: string;
    value: KeyMap;
}
export type KeyMap = Record<string, number>;
