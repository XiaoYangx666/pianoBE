/** MIDI 时间缩放：秒 → 存储值（播放器按 40 tick/s 调度） */
export const TIME_SCALE = 40;
/** 音符时值缩放：秒 → 存储值（播放器按 100 tick/s 读数） */
export const OTHER_SCALE = 100;
/** MIDI 力度缩放：@tonejs/midi 的 0~1 力度 → MIDI 标准的 0~127 */
export const VELOCITY_SCALE = 127;
/** 服务端脚本一 tick（20 TPS）的秒数 */
export const GAME_TICK_SECONDS = 0.05;
/**
 * 最近 tick 调度：提前半个游戏 tick 触发音符，让量化误差居中而不是整体拖后。
 * 单位与 PBE3 事件时间一致（TIME_SCALE = 40/秒），即 1。
 */
export const SCHEDULE_LEAD_TICKS = (TIME_SCALE * GAME_TICK_SECONDS) / 2;