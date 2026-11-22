import {
    compilePerformanceSource as compileCorePerformanceSource,
    type PerformanceCue,
    type PerformanceSourceBlackoutCue,
    type PerformanceSourceCue,
    type PerformanceSourceDocument,
    type PerformanceSourceEffectCue,
    type PerformanceSourceSection,
} from "@piano/core";
import { validateEffectCustomParams } from "./effects";
import { vfxRegistry, type VfxRegistry } from "./registry";

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
