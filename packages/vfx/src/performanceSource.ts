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

export type {
    PerformanceSourceBlackoutCue,
    PerformanceSourceCue,
    PerformanceSourceDocument,
    PerformanceSourceEffectCue,
    PerformanceSourceSection,
};

/** 结合内置 VFX 特效参数表校验并编译演出源 JSON。 */
export function compilePerformanceSource(source: unknown, expectedSongId?: string): PerformanceCue[] {
    return compileCorePerformanceSource(source, {
        expectedSongId,
        validateParams: validateEffectCustomParams,
    });
}
