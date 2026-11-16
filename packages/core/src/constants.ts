/** MIDI 时间缩放：秒 → 存储值（播放器按 40 tick/s 调度） */
export const TIME_SCALE = 40;
/** 音符时值缩放：秒 → 存储值（播放器按 100 tick/s 读数） */
export const OTHER_SCALE = 100;
/** MIDI 力度缩放：@tonejs/midi 的 0~1 力度 → PBE2 标准的 0~127 */
export const VELOCITY_SCALE = 127;