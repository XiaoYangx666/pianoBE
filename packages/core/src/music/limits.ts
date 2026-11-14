/**
 * 音乐存储的公共限制值。
 *
 * 应用层容量（管理员可配置）与单曲安全上限是两件事：
 * - 存储总量：见 budget.ts（默认 64 KiB，可配置）；
 * - 单曲结构安全上限：这里固定，避免损坏/压缩炸弹数据进入世界存储。
 */

/** 曲目 id 允许的字符集（与 PBE2 内容寻址 id 一致） */
export const MUSIC_ENTRY_ID_PATTERN = /^[0-9A-Za-z_-]{1,24}$/;

export interface MusicStorageLimits {
    /** 单首曲目原始 PBE2 上限 */
    maxSongBytes: number;
    maxNotes: number;
    /** 时长上限（40 tick/秒） */
    maxDurationTicks: number;
    /** 解压后事件流上限 */
    maxEventBytes: number;
}

export const DEFAULT_MUSIC_LIMITS: MusicStorageLimits = {
    maxSongBytes: 2 * 1024 * 1024,
    maxNotes: 250_000,
    maxDurationTicks: 40 * 60 * 60 * 6,
    maxEventBytes: 8 * 1024 * 1024,
};
