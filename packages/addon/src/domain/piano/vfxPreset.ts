import {
    effectEmitters, VFX_EFFECTS, VFX_LIMITS, validateVfxOptions, type NumericParameter,
    type VfxEffect, type VfxEmitter, type VfxMode, type VfxOptions,
} from "./vfxLab";
import type { VfxLayout } from "./vfxLighting";
import { clampUnit, mix, quietFeatures, type MusicFeatures } from "./vfxMusic";

const inputs = ["live", "phrase", "note", "chord", "dense", "solo"] as const;
export type VfxInput = typeof inputs[number];
export function vfxInput(value: string): VfxInput {
    const input = inputs.find(input => input === value);
    if (!input) throw new Error(`输入源需为 ${inputs.join(" / ")}`);
    return input;
}

interface VfxMapping {
    input: keyof MusicFeatures;
    parameter: NumericParameter;
    from: number;
    to: number;
}
export interface VfxLayer {
    effect: VfxEffect;
    layout?: VfxLayout;
    profile?: "silk";
    mode?: VfxMode;
    priority?: number;
    options?: VfxOptions;
    map?: VfxMapping[];
    gate?: "onset" | "chord";
}
export interface VfxPreset {
    layers: VfxLayer[];
    seconds?: number;
    fadeIn?: number;
    fadeOut?: number;
}

export const VFX_PRESETS: Record<string, VfxPreset> = {
    galaxy: { layers: [
        { effect: "field", mode: "continuous", options: { range: 1.26, size: 0.72, density: 0.86, fieldColor: "#9EBCFF" }, map: [
            { input: "activity", parameter: "intensity", from: 0.46, to: 0.83 },
            { input: "sustain", parameter: "speed", from: 0.62, to: 0.9 },
        ] },
        { effect: "curtain", layout: "aurora", options: { width: 0.26, speed: 0.52, curtainColor: "#9CBAFF" }, map: [
            { input: "activity", parameter: "intensity", from: 0.58, to: 0.85 },
            { input: "sustain", parameter: "length", from: 1.12, to: 1.45 },
        ] },
        { effect: "beam", profile: "silk", priority: 3, options: { x: 2.67, z: 0.21, heading: 82, bend: 0.64, range: 1.18,
            width: 0.23, lanes: 1, segments: 3, speed: 0.7, beamColor: "#A0CAFF" }, map: [
            { input: "pitch", parameter: "height", from: -0.4, to: 0.62 },
            { input: "sustain", parameter: "length", from: 1.72, to: 2.39 },
            { input: "activity", parameter: "intensity", from: 0.46, to: 0.96 },
        ] },
        { effect: "beam", profile: "silk", options: { x: -2.86, z: 0.48, y: 0.66, heading: -102, bend: 0.86, range: 1.28,
            width: 0.26, lanes: 1, segments: 2, speed: 0.56, beamColor: "#AF8AF6" }, map: [
            { input: "sustain", parameter: "length", from: 1.52, to: 2.4 },
            { input: "activity", parameter: "intensity", from: 0.4, to: 0.73 },
        ] },
    ] },
    neon: { layers: [
        { effect: "shaft", layout: "neon-sides", priority: 3, options: { width: 0.21, shaftColor: "#70CCFF" }, map: [
            { input: "activity", parameter: "intensity", from: 0.25, to: 0.57 },
            { input: "sustain", parameter: "length", from: 1.42, to: 1.96 },
        ] },
        { effect: "shaft", layout: "neon-rear", options: { width: 0.18, shaftColor: "#B4A0FF" }, map: [
            { input: "density", parameter: "intensity", from: 0.20, to: 0.47 },
            { input: "density", parameter: "length", from: 1.72, to: 2.15 },
        ] },
    ] },
    stage: { layers: [
        { effect: "curtain", layout: "wings", options: { width: 0.25, speed: 0.65, curtainColor: "#FFAD65" }, map: [
            { input: "surge", parameter: "length", from: 0.68, to: 2.31 },
            { input: "surge", parameter: "intensity", from: 0.07, to: 0.91 },
        ] },
        { effect: "shaft", layout: "backline", options: { z: 0.1, width: 0.26, shaftColor: "#B57BE4" }, map: [
            { input: "activity", parameter: "intensity", from: 0.20, to: 0.49 },
            { input: "surge", parameter: "length", from: 1.38, to: 2.35 },
        ] },
        { effect: "shaft", layout: "fan", priority: 3, options: { width: 0.24, shaftColor: "#FFB467" }, map: [
            { input: "surge", parameter: "length", from: 0.46, to: 2.4 },
            { input: "surge", parameter: "intensity", from: 0.0, to: 1.0 },
        ] },
        { effect: "fountain", options: { z: 2.61, range: 1.18, size: 0.8, fountainColor: "#FFB37A" }, map: [
            { input: "surge", parameter: "intensity", from: 0, to: 0.62 },
            { input: "surge", parameter: "density", from: 0.4, to: 0.92 },
            { input: "surge", parameter: "speed", from: 0.64, to: 1.22 },
        ] },
    ] },
};

const shared = ["x", "y", "z", "rotation", "scale", "intensity"];
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要 JSON 对象");
    return value as Record<string, unknown>;
}

function bounded(value: unknown, min: number, max: number, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${name} 需要在 ${min} 到 ${max} 之间`);
    }
    return value;
}
export function isVfxEffect(value: unknown): value is VfxEffect {
    return typeof value === "string" && Object.hasOwn(VFX_EFFECTS, value);
}

export function validateEffectOptions(effect: VfxEffect, value: unknown): VfxOptions {
    const options = validateVfxOptions(value);
    for (const key of Object.keys(options)) {
        if (key !== `${effect}Color` && !shared.includes(key) && !VFX_EFFECTS[effect].options.includes(key as NumericParameter)) {
            throw new Error(`${effect} 无参数 ${key}`);
        }
    }
    return options;
}

export function validateVfxPreset(value: unknown): VfxPreset {
    const { layers, seconds, fadeIn, fadeOut } = record(value);
    if (!Array.isArray(layers) || !layers.length || layers.length > 6) throw new Error("预设需要 1–6 个特效图层");
    return {
        seconds: seconds === undefined ? undefined : bounded(seconds, 5, 180, "seconds"),
        fadeIn: fadeIn === undefined ? undefined : bounded(fadeIn, 0, 4, "fadeIn"),
        fadeOut: fadeOut === undefined ? undefined : bounded(fadeOut, 0, 4, "fadeOut"),
        layers: layers.map(layer => {
            const { effect, mode, options, map, priority, gate, layout, profile } = record(layer);
            if (!isVfxEffect(effect)) throw new Error(`未知特效 ${effect}`);
            if (mode !== undefined && mode !== "autonomous" && mode !== "continuous" && mode !== "trigger") throw new Error("无效的 mode");
            if (gate !== undefined && gate !== "onset" && gate !== "chord") throw new Error("gate 需要是 onset 或 chord");
            if (map !== undefined && (!Array.isArray(map) || map.length > 6)) throw new Error("图层最多 6 个参数映射");
            const validLayout = VFX_EFFECTS[effect].layouts?.find(item => item === layout);
            if (layout !== undefined && !validLayout) throw new Error("无效的图层布局");
            if (profile !== undefined && (effect !== "beam" || profile !== "silk")) throw new Error("无效的流光纹理");
            const parameters = new Set<string>();
            const validatedMap = map?.map(value => {
                const { input, parameter, from, to } = record(value);
                if (typeof input !== "string" || !Object.hasOwn(quietFeatures, input)) throw new Error("未知音乐特征");
                if (typeof parameter !== "string" || !Object.hasOwn(VFX_LIMITS, parameter) ||
                    ![...shared, ...VFX_EFFECTS[effect].options].includes(parameter) ||
                    parameter === "lanes" || parameter === "segments" || parameters.has(parameter)) {
                    throw new Error(`不支持映射参数 ${parameter}`);
                }
                parameters.add(parameter);
                const [min, max] = VFX_LIMITS[parameter as NumericParameter];
                return { input: input as keyof MusicFeatures, parameter: parameter as NumericParameter,
                    from: bounded(from, min, max, "from"), to: bounded(to, min, max, "to") };
            });
            return { effect, mode, gate, layout: validLayout, profile, map: validatedMap,
                priority: priority === undefined ? undefined : bounded(priority, 0, 5, "priority"),
                options: options === undefined ? undefined : validateEffectOptions(effect, options) };
        }),
    };
}

interface LayerState {
    next: number;
    previous?: VfxOptions;
}

export interface VfxBatch {
    priority: number;
    emitters: VfxEmitter[];
}

export class VfxPresetPlayer {
    private readonly states: LayerState[];
    readonly duration: number;

    constructor(private readonly preset: VfxPreset) {
        this.states = preset.layers.map(() => ({ next: 0 }));
        this.duration = Math.ceil((preset.seconds ?? 45) * 20);
    }

    reset(tick: number) {
        for (const state of this.states) {
            state.next = tick;
            state.previous = undefined;
        }
    }

    update(tick: number, music: Readonly<MusicFeatures>, solo = false,
        levels?: readonly { intensity: number; scale: number }[]): VfxBatch[] {
        if (tick >= this.duration) return [];
        const rise = (this.preset.fadeIn ?? 0.48) * 20;
        const fall = (this.preset.fadeOut ?? 1.45) * 20;
        const envelope = clampUnit((tick + 4) / (rise || 1)) * clampUnit((this.duration - tick) / (fall || 1));
        const batches: VfxBatch[] = [];
        for (const [index, layer] of this.preset.layers.entries()) {
            const state = this.states[index];
            const effect = VFX_EFFECTS[layer.effect];
            const mode = solo ? "autonomous" : layer.mode ?? effect.mode;
            if (tick < state.next || (mode === "trigger" && music[layer.gate ?? "onset"] <= 0)) continue;
            const options = { ...layer.options };
            if (mode !== "autonomous") for (const mapping of layer.map ?? []) {
                const value = music[mapping.input];
                const weight = clampUnit(mapping.input === "dynamics" ? (value + 1) / 2 : value);
                options[mapping.parameter] = mix(mapping.from, mapping.to, weight);
            }
            const level = levels?.[index];
            options.intensity = envelope * (options.intensity ?? 1) * (level?.intensity ?? 1);
            if (level) options.scale = level.scale;
            if (options.intensity < 0.005) continue;
            const emitters = effectEmitters(layer.effect, options, {
                music: mode === "autonomous" ? quietFeatures : music,
                previous: state.previous ?? options,
                layout: layer.layout,
                profile: layer.profile,
            });
            state.next = tick + effect.interval;
            state.previous = options;
            batches.push({ priority: layer.priority ?? (mode === "trigger" ? 4 : 2), emitters });
        }
        return batches.sort((a, b) => b.priority - a.priority);
    }
}
