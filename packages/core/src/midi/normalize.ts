import { velocityVolume } from "./note.js";

/** 逐曲响度归一化的目标值（基于音符能量的相对 dB，不是标准 LUFS）。 */
export const NORMALIZE_TARGET_DB = 8.0;
/** 单曲最大增益调整，避免把极安静的曲子硬拉爆。 */
export const NORMALIZE_MAX_GAIN_DB = 8;

/** 参与响度估算的最小音符结构。 */
export interface NormalizationNote {
    /** MIDI 力度 0~127 */
    velocity: number;
    /** 音符可闻时长（秒） */
    durationSeconds: number;
}

/**
 * 估算一首曲子的相对响度并返回归一化增益（dB）。
 *
 * 只用于可选的逐曲归一化：用力度音量 + 可闻时长做能量代理，
 * 不改变音符力度层选择，也不改变原始 MIDI 动态。
 */
export function computeNormalizationGainDbFromNotes(
    notes: readonly NormalizationNote[],
    durationSec: number,
    targetDb = NORMALIZE_TARGET_DB,
    maxGainDb = NORMALIZE_MAX_GAIN_DB
): number {
    if (notes.length === 0 || durationSec <= 0) return 0;
    let energy = 0;
    for (const note of notes) {
        if (note.velocity <= 0) continue;
        const amp = velocityVolume(note.velocity) * 0.95;
        // 与播放器一致：采样最多约 4 秒，Note Off 后还有 600ms 释放。
        const audible = Math.min(4, Math.max(0.05, note.durationSeconds) + 0.6);
        energy += amp * amp * audible;
    }
    if (energy <= 0) return 0;
    const loudnessDb = 10 * Math.log10(energy / durationSec);
    return Math.max(-maxGainDb, Math.min(maxGainDb, targetDb - loudnessDb));
}
