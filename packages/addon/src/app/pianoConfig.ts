export const VIEW_RANGE_SQUARED = 48 ** 2;
export const UNLOAD_GRACE = 200;
export const SWEEP_INTERVAL = 20;
export const VERIFY_INTERVAL = 10;

/** 公共曲库共享 SongCache 预算：缓存的是解压后事件流，不是单曲大小限制。 */
export const PUBLIC_LIBRARY_CACHE_BYTES = 1024 * 1024;
/** 每架钢琴的本地播放缓存预算（存储卡等来源）。 */
export const PIANO_LOCAL_CACHE_BYTES = 256 * 1024;

export const TEXT_SETTINGS = ["textVisible", "titleColor", "statusColor", "textScale",
    "textRight", "textUp", "textForward", "textDistance"] as const;

/** Note Off 后的淡出时长（秒）。短于此值会明显硬切，600ms 是听感折中。 */
export const NOTE_RELEASE_SECONDS = 0.6;
