export interface NoteInfo {
    name: string;
    sample: string;
    pitch: number;
    midi: number;
}

export interface KeyMapInfo {
    name: string;
    value: KeyMap;
}
export type KeyMap = Record<string, number>;

export interface MidiJson {
    header: {
        tempos: Array<{ bpm: number; ticks: number }>;
        timeSignatures: Array<{
            ticks: number;
            timeSignature: [number, number];
        }>;
    };
    tracks: MidiTrack[];
}

export interface MidiTrack {
    name?: string;
    instrument?: {
        family: string;
        number: number;
        name: string;
    };
    // notes 在某些轨道中可能缺失，所以设为可选
    notes?: MidiNote[];
    // 其他字段设为可选以兼容不同 MIDI 导出格式
    channel?: number;
    controlChanges?: Record<
        string,
        Array<{ number: number; ticks: number; time: number; value: number }>
    >;
    pitchBends?: Array<{ ticks: number; time: number; value: number }>;
    endOfTrackTicks?: number;
}

export interface MidiNote {
    midi: number;
    name: string;
    ticks: number;
    time: number;
    duration: number;
    velocity: number;
}
