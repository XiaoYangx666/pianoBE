/**
 * PBE3 —— PianoBE 运行时曲目格式。
 *
 * 核心设计：
 * - 歌曲级力度调色板：每个音只存调色板索引，恒定力度时 `velocityBits = 0`；
 * - `keyDuration`：区分琴键实际按下时长与声音持续时长（踏板延音），
 *   只有两者不同时才额外编码。
 *
 * 不再包含：轨道/左右手、独立 CC64 事件、段落/循环点、速度表。
 */

/** 文件头魔数（ASCII "PBE3"） */
export const PBE3_MAGIC = [0x50, 0x42, 0x45, 0x33] as const;
/** 当前格式版本 */
export const PBE3_VERSION = 1;
/** 带演出区块的版本；无演出曲目仍写版本 1。v3 起演出区块使用颜色表。 */
export const PBE3_PERFORMANCE_VERSION = 3;
/** 旧版演出区块（每条提示内联 RGB），仅保留解码兼容。 */
export const PBE3_PERFORMANCE_LEGACY_VERSION = 2;

/** 事件流使用 Raw DEFLATE 压缩 */
export const PBE3_FLAG_COMPRESSED = 1 << 0;

/** 单曲事件流解压后的安全上限（防止压缩炸弹/损坏头部导致超大分配） */
export const MAX_PBE3_EVENT_BYTES = 32 * 1024 * 1024;

/** 头部固定字段之后的内容 */
export interface Pbe3Header {
    id: string;
    name: string;
    /** 时长（TIME_SCALE=40 tick/秒） */
    duration: number;
    /** 音符总数 */
    noteCount: number;
    /** 未压缩事件流字节数 */
    uncompressedLength: number;
    /** 未压缩事件流 CRC32 */
    checksum: number;
    /** 原始 flags 位 */
    flags: number;
    /** 事件流是否压缩 */
    compressed: boolean;
    /** 歌曲级力度调色板（升序、去重，0~127） */
    palette: readonly number[];
    /** 每个音符的力度索引位数（0~7；0 表示所有音都用 palette[0]） */
    velocityBits: number;
    performance?: readonly import("./performance.js").PerformanceCue[];
    /** Encoded performance section size, including its length and checksum. */
    performanceBytes?: number;
    /** 压缩数据在整份 PBE3 中的起始偏移 */
    eventOffset: number;
    /** 整份 PBE3 字节数 */
    byteLength: number;
}

/** 事件流中的一条音符（时间与时长单位均为内部 tick：40/秒） */
export interface Pbe3Note {
    /** 绝对起始时间（40 tick/秒） */
    time: number;
    midi: number;
    /** 声音持续时长（40/秒 tick，与音符起始时间同一网格） */
    soundDuration: number;
    /** 琴键实际按下时长（40/秒 tick，与音符起始时间同一网格） */
    keyDuration: number;
    /** 力度 0~127 */
    velocity: number;
}

/** 秒制音符事件（与 Web/生成器试听引擎的 NoteEvent 结构兼容） */
export interface Pbe3NoteEvent {
    midi: number;
    /** 起始时间（秒） */
    time: number;
    /** 声音时长（秒） */
    duration: number;
    /** 琴键实际按下时长（秒） */
    keyDuration: number;
    /** 力度 0~1 */
    velocity: number;
}

/** 稀疏跳转索引：每 5 秒记录一个事件组起点 */
export interface Pbe3SeekIndexEntry {
    /** 组起始时间（40 tick/秒） */
    ticks: number;
    /** 事件流字节偏移（指向组头） */
    offset: number;
    /** 该组之前已经过的音符数量 */
    noteIndex: number;
}

/** 默认稀疏索引间隔（秒） */
export const PBE3_SEEK_INDEX_INTERVAL_SECONDS = 5;
/** 默认稀疏索引间隔（tick） */
export const PBE3_SEEK_INDEX_STEP_TICKS = PBE3_SEEK_INDEX_INTERVAL_SECONDS * 40;
