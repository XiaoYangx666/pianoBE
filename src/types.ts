export type Cardinal_Direction = "east" | "west" | "north" | "south";

export interface NoteInfo {
    name: string;
    sample: string;
    pitch: number;
    midi: number;
}
//键盘映射
export interface KeyMapInfo {
    name: string;
    value: KeyMap;
}
export type KeyMap = Record<string, number>;

//MIDI部分
export interface MidiJson {
    name: string;
    duration: number;
    tracks: {
        instrument: {
            family: string;
            number: number;
            name: string;
        };
        /**midi,time,duration,velocity */
        notes: MidiNote[];
    }[];
}

/**midi,time,duration,velocity */
export type MidiNote = [number, number, number, number];
