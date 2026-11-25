import {
    parsePerformanceRgb, resolvePerformanceColor, TIME_SCALE,
    type PerformanceCue, type PerformanceMotion, type PerformanceParams, type PerformanceParamValue,
    type PerformanceZone,
} from "@piano/core";
import { deriveAccentHex, rgbToHex } from "../spatial/color";
import { getVfxEffect, resolveEffectCustomParams } from "../domain/effects";
import { clampUnit, mix, type MusicFeatures } from "./music";
import type { TimelineTick } from "./time";
import { interpolateSchemaParams } from "../plugin/parameters";
import { vfxRegistry, type VfxRegistry } from "../plugin/registry";
import type { VfxTheme } from "../domain/themes";
import type { PianoParticleOverride, VfxEffectParams, VfxParameterSchema } from "../types";

export interface ProgramChannelSample {
    params: VfxEffectParams;
    gated?: boolean;
    cooldownTicks?: number;
}

export interface ProgramChannel {
    key: string;
    effect: string;
    slot: number;
    sample(timeSeconds: number, timelineTick: TimelineTick, music: Readonly<MusicFeatures>, solo: boolean): ProgramChannelSample | undefined;
}

export interface ProgramFlash {
    tick40: number;
    effect: string;
    params: VfxEffectParams;
}

export interface VfxProgram {
    durationSeconds: number;
    channels: readonly ProgramChannel[];
    flashes: readonly ProgramFlash[];
    staticKeyParticle?: PianoParticleOverride;
}

interface ChannelState {
    intensity: number;
    scale: number;
    r: number;
    g: number;
    b: number;
    r2: number;
    g2: number;
    b2: number;
    brush?: string;
    variant?: string;
    zone: PerformanceZone;
    motion: PerformanceMotion;
    schema?: VfxParameterSchema;
    custom: Record<string, PerformanceParamValue>;
}

interface Transition {
    tick40: number;
    fade40: number;
    from: ChannelState;
    to: ChannelState;
}

const DEFAULT_CHANNEL_STATE: ChannelState = {
    intensity: 0,
    scale: 1,
    r: 255, g: 255, b: 255,
    r2: 255, g2: 255, b2: 255,
    zone: "stage",
    motion: "normal",
    custom: {},
};

function sampleTransitions(transitions: readonly Transition[], tick40: number): ChannelState {
    let index = transitions.length - 1;
    while (index >= 0 && transitions[index].tick40 > tick40) index--;
    const transition = transitions[index];
    if (!transition) return DEFAULT_CHANNEL_STATE;
    const progress = transition.fade40 ? clampUnit((tick40 - transition.tick40) / transition.fade40) : 1;
    const smooth = progress * progress * (3 - 2 * progress);
    const schema = transition.to.schema;
    return {
        intensity: mix(transition.from.intensity, transition.to.intensity, smooth),
        scale: mix(transition.from.scale, transition.to.scale, smooth),
        r: mix(transition.from.r, transition.to.r, smooth),
        g: mix(transition.from.g, transition.to.g, smooth),
        b: mix(transition.from.b, transition.to.b, smooth),
        r2: mix(transition.from.r2, transition.to.r2, smooth),
        g2: mix(transition.from.g2, transition.to.g2, smooth),
        b2: mix(transition.from.b2, transition.to.b2, smooth),
        brush: transition.to.brush,
        variant: transition.to.variant,
        zone: transition.to.zone,
        motion: transition.to.motion,
        schema,
        custom: schema
            ? interpolateSchemaParams(schema, transition.from.custom, transition.to.custom, smooth)
            : {},
    };
}

function toEffectParams(state: ChannelState): VfxEffectParams {
    return {
        color: rgbToHex(state.r, state.g, state.b),
        color2: rgbToHex(state.r2, state.g2, state.b2),
        intensity: state.intensity,
        scale: state.scale,
        brush: state.brush,
        variant: state.variant,
        zone: state.zone,
        motion: state.motion,
        ...(state.schema ? { custom: state.custom } : {}),
    };
}

/** 将 PBE3 演出提示编译为统一的 VfxProgram。未知特效安全跳过，不阻断播放。 */
export function createPerformanceProgram(
    cues: readonly PerformanceCue[],
    durationSeconds: number,
    registry: VfxRegistry = vfxRegistry,
): VfxProgram {
    const channels: ProgramChannel[] = [];
    const flashes: ProgramFlash[] = [];
    const byChannel = new Map<string, Transition[]>();

    for (const cue of cues) {
        const def = getVfxEffect(cue.effect, registry);
        if (!def) continue;
        if (cue.op === "flash" || def.trigger === "instant") {
            const color2 = cue.color2 ?? deriveAccentHex(cue.color);
            flashes.push({
                tick40: cue.tick,
                effect: cue.effect,
                params: {
                    color: cue.color,
                    color2,
                    intensity: cue.level / 100,
                    scale: cue.scale / 100,
                    brush: cue.brush,
                    variant: cue.variant,
                    zone: cue.zone ?? "stage",
                    motion: cue.motion ?? "normal",
                    ...(def.parameters ? { custom: resolveEffectCustomParams(def, cue.params, registry) } : {}),
                },
            });
            continue;
        }
        const slot = cue.slot ?? 0;
        const key = `${cue.effect}:${slot}`;
        let transitions = byChannel.get(key);
        if (!transitions) {
            transitions = [];
            byChannel.set(key, transitions);
            const list = transitions;
            channels.push({
                key,
                effect: cue.effect,
                slot,
                sample(timeSeconds) {
                    const state = sampleTransitions(list, timeSeconds * TIME_SCALE);
                    if (state.intensity < 0.005) return undefined;
                    return { params: toEffectParams(state) };
                },
            });
        }
        const [r, g, b] = parsePerformanceRgb(cue.color);
        const [r2, g2, b2] = parsePerformanceRgb(cue.color2 ?? deriveAccentHex(cue.color));
        const prev = sampleTransitions(transitions, cue.tick);
        const isActive = transitions.length > 0 && prev.intensity > 0.001;
        const custom = def.parameters
            ? resolveEffectCustomParams(def, isActive ? { ...prev.custom, ...cue.params } : cue.params, registry)
            : {};
        const target: ChannelState = {
            intensity: cue.level / 100,
            scale: cue.scale / 100,
            r, g, b, r2, g2, b2,
            brush: cue.brush,
            variant: cue.variant,
            zone: cue.zone ?? "stage",
            motion: cue.motion ?? "normal",
            schema: def.parameters,
            custom,
        };
        const from: ChannelState = !isActive
            ? { ...target, intensity: 0 }
            : prev;
        const to: ChannelState = cue.level === 0
            ? {
                ...prev,
                intensity: 0,
                brush: cue.brush ?? prev.brush,
                variant: cue.variant ?? prev.variant,
                zone: cue.zone ?? prev.zone,
                motion: cue.motion ?? prev.motion,
                schema: def.parameters,
                custom: def.parameters
                    ? resolveEffectCustomParams(def, { ...prev.custom, ...cue.params }, registry)
                    : {},
            }
            : target;
        transitions.push({ tick40: cue.tick, fade40: cue.op === "set" ? cue.fade : 0, from, to });
    }

    return { durationSeconds, channels, flashes };
}

export interface ThemeProgramOverrides {
    seconds?: number;
    layerControls?: readonly { intensity: number; scale: number }[];
}

/** 将音乐响应主题编译为统一的 VfxProgram。 */
export function createThemeProgram(
    theme: VfxTheme,
    overrides: ThemeProgramOverrides = {},
    registry: VfxRegistry = vfxRegistry,
): VfxProgram {
    const durationSeconds = overrides.seconds ?? theme.seconds ?? Infinity;
    const durationTicks = Number.isFinite(durationSeconds) ? Math.ceil(durationSeconds * 20) : Infinity;
    const fadeInTicks = (theme.fadeIn ?? 0.48) * 20;
    const fadeOutTicks = (theme.fadeOut ?? 1.45) * 20;

    const channels: ProgramChannel[] = theme.layers.map((layer, index) => {
        const color = resolvePerformanceColor(layer.color);
        const color2 = layer.color2 ? resolvePerformanceColor(layer.color2) : deriveAccentHex(color);
        const slot = layer.slot ?? index;
        const def = getVfxEffect(layer.effect, registry);
        const custom = def?.parameters ? resolveEffectCustomParams(def, layer.params, registry) : undefined;
        return {
            key: `layer:${index}:${layer.effect}:${slot}`,
            effect: layer.effect,
            slot,
            sample(_timeSeconds, timelineTick, music, solo) {
                const envelope = Number.isFinite(durationTicks)
                    ? clampUnit((timelineTick + 4) / (fadeInTicks || 1)) * clampUnit((durationTicks - timelineTick) / (fadeOutTicks || 1))
                    : 1;
                const rawLevel = typeof layer.level === "number"
                    ? layer.level
                    : solo
                        ? (layer.level.from + layer.level.to) * 0.5
                        : mix(layer.level.from, layer.level.to, clampUnit(
                            layer.level.input === "dynamics" ? (music.dynamics + 1) / 2 : music[layer.level.input],
                        ));
                const control = overrides.layerControls?.[index];
                const intensity = clampUnit((rawLevel / 100) * envelope * (control?.intensity ?? 1));
                if (intensity < 0.005) return undefined;
                const scale = control?.scale ?? (layer.scale ?? 100) / 100;
                const gated = layer.gate ? (solo || music[layer.gate.input] >= layer.gate.threshold) : true;
                return {
                    params: {
                        color,
                        color2,
                        intensity,
                        scale,
                        brush: layer.brush,
                        variant: layer.variant,
                        zone: layer.zone ?? "stage",
                        motion: layer.motion ?? "normal",
                        ...(custom ? { custom } : {}),
                    },
                    gated,
                    cooldownTicks: layer.gate?.cooldown,
                };
            },
        };
    });

    return {
        durationSeconds,
        channels,
        flashes: [],
        staticKeyParticle: theme.keyParticle,
    };
}

export interface SingleEffectConfig {
    effect: string;
    color: string;
    color2?: string;
    brush?: string;
    variant?: string;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    params?: PerformanceParams;
    level?: number;
    scale?: number;
    seconds?: number;
    /** 预览瞬时特效时的自动脉冲周期（游戏刻）；0 表示仅响应手动 triggerFlash() */
    autoPulseTicks?: number;
}

/** 将单个特效调试/预览配置编译为统一的 VfxProgram。 */
export function createSingleEffectProgram(
    config: SingleEffectConfig,
    registry: VfxRegistry = vfxRegistry,
): VfxProgram {
    const color = resolvePerformanceColor(config.color);
    const color2 = config.color2 ? resolvePerformanceColor(config.color2) : deriveAccentHex(color);
    const def = getVfxEffect(config.effect, registry);
    const custom = def?.parameters ? resolveEffectCustomParams(def, config.params, registry) : undefined;
    const params: VfxEffectParams = {
        color,
        color2,
        intensity: (config.level ?? 85) / 100,
        scale: (config.scale ?? 100) / 100,
        brush: config.brush,
        variant: config.variant,
        zone: config.zone ?? "stage",
        motion: config.motion ?? "normal",
        ...(custom ? { custom } : {}),
    };
    const autoPulse = config.autoPulseTicks ?? 45;
    return {
        durationSeconds: config.seconds ?? Infinity,
        flashes: [],
        channels: [
            {
                key: `single:${config.effect}:0`,
                effect: config.effect,
                slot: 0,
                sample() {
                    if (params.intensity < 0.005) return undefined;
                    return {
                        params,
                        gated: autoPulse > 0,
                        cooldownTicks: autoPulse,
                    };
                },
            },
        ],
    };
}
