/** 手动敲键的力度预设；新增的是力度，不再有采样时长档位。 */
export const manualVelocityPresets = [
    { name: "轻触", velocity: 64 },
    { name: "标准", velocity: 96 },
    { name: "强奏", velocity: 116 },
] as const;

/** 跟随钢琴设置（玩家覆盖值为 -1 时使用）。 */
export const FOLLOW_PIANO_VELOCITY = -1;

/** 默认手动敲键力度，与“标准”预设一致。 */
export const DEFAULT_MANUAL_VELOCITY = manualVelocityPresets[1].velocity;

export function isManualVelocity(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 127;
}

export function manualVelocityAt(index: number | undefined): number | undefined {
    return index === undefined ? undefined : manualVelocityPresets[index]?.velocity;
}

export function manualVelocityIndexOf(velocity: number): number {
    const index = manualVelocityPresets.findIndex(preset => preset.velocity === velocity);
    return index < 0 ? 1 : index;
}

/** 玩家覆盖力度（预设下标，-1 = 跟随钢琴），未命中时回退到钢琴设置。 */
export function resolveManualVelocity(override: number, pianoVelocity: number): number {
    return manualVelocityAt(override) ?? pianoVelocity;
}
