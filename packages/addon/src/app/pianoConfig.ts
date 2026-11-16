export const VIEW_RANGE_SQUARED = 48 ** 2;
export const UNLOAD_GRACE = 200;
export const SWEEP_INTERVAL = 20;
export const VERIFY_INTERVAL = 10;

export const TEXT_SETTINGS = ["textVisible", "titleColor", "statusColor", "textScale",
    "textRight", "textUp", "textForward", "textDistance"] as const;

/** Note Off 后的淡出时长（秒）。短于此值会明显硬切，600ms 是听感折中。 */
export const NOTE_RELEASE_SECONDS = 0.6;
