/** 曲目元信息（列表/注册表用，不含音符数据） */
export interface MidiSongMeta {
    id: string;
    name: string;
    /** 时长，已按 TIME_SCALE 缩放（与 addon 模块中的 duration 字段同值） */
    duration: number;
}

export interface MidiTrackInstrument {
    family: string;
    number: number;
    name: string;
}

export interface MidiTrack {
    instrument: MidiTrackInstrument;
    /** 四元组扁平数组：midi, time, duration, velocity（time/duration/velocity 均已缩放） */
    notes: number[];
}

/** 一首曲目的完整数据（可 JSON 序列化；addon 播放时再解码为 Uint16Array） */
export interface MidiSong {
    id: string;
    name: string;
    duration: number;
    tracks: MidiTrack[];
}

/** 播放列表元信息（单条记录，items 单独存储） */
export interface PlaylistMeta {
    id: number;
    owner: string;
    name: string;
    public: boolean;
    playCount: number;
    createdAt: number;
    updatedAt: number;
}