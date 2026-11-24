import type { ContentOrigin, PerformanceDescriptor } from "./music/domain.js";

/** 曲目元信息（列表/注册表用，不含音符数据） */
export interface MidiSongMeta {
    id: string;
    name: string;
    /** 时长，已按 TIME_SCALE 缩放（与 addon 模块中的 duration 字段同值） */
    duration: number;
    /** PBE3 音符总数（来源提供时用于歌曲详情展示） */
    noteCount?: number;
    /** PBE3 原始字节数（来源提供时用于歌曲详情展示与内容校验） */
    bytes?: number;
    /** 规范化音乐内容指纹（独立于曲名、ID、编码压缩和演出） */
    musicFingerprint?: string;
    /** 同一音乐本体合并后保留的别名 */
    aliases?: readonly string[];
    /** 所属逻辑曲库 ID 列表 */
    libraries?: readonly string[];
    /** 主要来源 */
    origin?: ContentOrigin;
    /** 全部来源（多来源合并同一音乐本体时保留） */
    origins?: readonly ContentOrigin[];
    /** 具有稳定 ID 与名称的独立演出列表 */
    performanceEntries?: readonly PerformanceDescriptor[];
    /** 额外演出与 PBE3 内的默认演出共用音符数据。 */
    performances?: readonly (readonly import("./pbe3/performance.js").PerformanceCue[])[];
}

export interface MidiTrackInstrument {
    family: string;
    number: number;
    name: string;
}

export interface MidiTrack {
    instrument: MidiTrackInstrument;
    /** 四元组扁平数组：midi, time, soundDuration, velocity（time/duration/velocity 均已缩放） */
    notes: number[];
    /**
     * 与 notes 一一对应的琴键实际按下时长（1/100 秒）。
     * 缺省表示等于 soundDuration（没有踏板延音）。
     */
    keyDurations?: number[];
}

/** 一首曲目的完整数据（可 JSON 序列化；addon 播放时再解码为 Uint16Array） */
export interface MidiSong {
    id: string;
    name: string;
    duration: number;
    tracks: MidiTrack[];
    performance?: readonly import("./pbe3/performance.js").PerformanceCue[];
}
