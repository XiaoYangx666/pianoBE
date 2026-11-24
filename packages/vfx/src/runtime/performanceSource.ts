import {
    compilePerformanceSource as compileCorePerformanceSource,
    type PerformanceCue,
    type PerformanceSourceBlackoutCue,
    type PerformanceSourceCue,
    type PerformanceSourceDocument,
    type PerformanceSourceEffectCue,
    type PerformanceSourceSection,
} from "@piano/core";
import { validateEffectCustomParams } from "../domain/effects";
import { vfxRegistry, type VfxRegistry } from "../plugin/registry";
import { isValidBrush } from "../spatial/brushes";

export type {
    PerformanceSourceBlackoutCue,
    PerformanceSourceCue,
    PerformanceSourceDocument,
    PerformanceSourceEffectCue,
    PerformanceSourceSection,
};

/** 结合已注册 VFX 特效参数表校验并编译演出源 JSON。 */
export function compilePerformanceSource(
    source: unknown,
    expectedSongId?: string,
    registry: VfxRegistry = vfxRegistry,
): PerformanceCue[] {
    return compileCorePerformanceSource(source, {
        expectedSongId,
        validateParams: (effectId, raw) => validateEffectCustomParams(effectId, raw, registry),
    });
}

export function missingPerformanceResources(
    cues: readonly PerformanceCue[],
    registry: VfxRegistry = vfxRegistry,
): string[] {
    const missing = new Set<string>();
    for (const cue of cues) {
        if (!hasPerformanceEffect(cue.effect, registry)) missing.add(cue.effect);
        if (cue.brush && !isValidBrush(cue.brush)) missing.add(`brush:${cue.brush}`);
    }
    return [...missing];
}

function hasPerformanceEffect(effect: string, registry: VfxRegistry): boolean {
    const owner = registry.getEffectOwner(effect);
    return registry.hasEffect(effect) && (!owner || !registry.isPluginDisabled(owner));
}

export function hasAvailablePerformanceEffects(
    cues: readonly PerformanceCue[],
    registry: VfxRegistry = vfxRegistry,
): boolean {
    return cues.some(cue => hasPerformanceEffect(cue.effect, registry));
}
