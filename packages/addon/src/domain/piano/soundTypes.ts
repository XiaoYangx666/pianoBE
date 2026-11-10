import type { PianoSoundLayer } from "@piano/core";

/** 玩家面板选择“跟随钢琴设置”时的哨兵值 */
export const FOLLOW_PIANO_LAYER = -1;

export const soundTypes: readonly { name: string; layer: PianoSoundLayer }[] = [
    { name: "长音(4s)", layer: "long" },
    { name: "标准音(2s)", layer: "standard" },
    { name: "短音(0.5s)", layer: "short" },
];

export function isSoundLayer(value: unknown): value is PianoSoundLayer {
    return soundTypes.some(type => type.layer === value);
}

export function soundLayerAt(index: number | undefined): PianoSoundLayer | undefined {
    return index === undefined ? undefined : soundTypes[index]?.layer;
}

export function soundLayerIndexOf(layer: PianoSoundLayer): number {
    const index = soundTypes.findIndex(type => type.layer === layer);
    return index < 0 ? 0 : index;
}

/** 玩家覆盖优先，未覆盖（-1/非法值）时跟随钢琴设置。 */
export function resolveSoundLayer(override: number, pianoLayer: PianoSoundLayer): PianoSoundLayer {
    return soundLayerAt(override) ?? pianoLayer;
}
