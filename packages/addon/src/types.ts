import { Dimension, Vector3 } from "@minecraft/server";

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
        /**midi,time,duration,velocity(4个一组) */
        notes: Float32Array;
    }[];
}

export type MidiListType = MidiInfo[];

/**Midi的信息 */
export interface MidiInfo {
    id: string;
    name: string;
    duration: number;
    value: () => Promise<MidiJson>;
}
