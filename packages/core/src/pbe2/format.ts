/**
 * PBE2 —— PianoBE 唯一运行时曲目格式。
 *
 * 设计目标：
 * - 元信息可不解压直接读取（列表/搜索不触发曲目解码）；
 * - 事件流按时间分组 + VarInt + 差分，紧凑且可增量读取；
 * - 事件流可选用 Raw DEFLATE 二次压缩，加载时只解压一次；
 * - 不兼容旧版曲库二进制（旧 `.bin` 仅作为离线迁移输入）。
 */

/** 文件头魔数（ASCII "PBE2"） */
export const PBE2_MAGIC = [0x50, 0x42, 0x45, 0x32] as const;
/** 当前格式版本 */
export const PBE2_VERSION = 1;

/** 事件流使用 Raw DEFLATE 压缩 */
export const PBE2_FLAG_COMPRESSED = 1 << 0;
/** 事件流包含力度字段（默认播放编码省略） */
export const PBE2_FLAG_VELOCITY = 1 << 1;

/** 头部固定字段之后的内容 */
export interface Pbe2Header {
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
    /** 事件流是否带力度 */
    hasVelocity: boolean;
    /** 压缩数据在整份 PBE2 中的起始偏移 */
    eventOffset: number;
    /** 整份 PBE2 字节数 */
    byteLength: number;
}

/** 事件流中的一条音符（时间单位均为内部 tick：40/秒，时长 100/秒） */
export interface Pbe2Note {
    /** 绝对起始时间（40 tick/秒） */
    time: number;
    midi: number;
    /** 持续时长（100/秒） */
    duration: number;
    /** 力度 0~127（未编码时回退为 100） */
    velocity: number;
}

/** 秒制音符事件（与 Web/生成器试听引擎的 NoteEvent 结构兼容） */
export interface Pbe2NoteEvent {
    midi: number;
    /** 起始时间（秒） */
    time: number;
    /** 时长（秒） */
    duration: number;
    /** 力度 0~1 */
    velocity: number;
}

/** 稀疏跳转索引：每 5 秒记录一个事件组起点 */
export interface SeekIndexEntry {
    /** 组起始时间（40 tick/秒） */
    ticks: number;
    /** 事件流字节偏移（指向组头） */
    offset: number;
    /** 该组之前已经过的音符数量 */
    noteIndex: number;
}

/** 默认稀疏索引间隔（秒） */
export const SEEK_INDEX_INTERVAL_SECONDS = 5;
/** 默认稀疏索引间隔（tick） */
export const SEEK_INDEX_STEP_TICKS = SEEK_INDEX_INTERVAL_SECONDS * 40;

/** 单曲事件流解压后的安全上限（防止压缩炸弹/损坏头部导致超大分配） */
export const MAX_PBE2_EVENT_BYTES = 32 * 1024 * 1024;
