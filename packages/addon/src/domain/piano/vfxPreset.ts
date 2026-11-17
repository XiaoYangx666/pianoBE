import {
    effectEmitters, VFX_EFFECTS, VFX_LIMITS, validateVfxOptions, type NumericParameter,
    type VfxEffect, type VfxEmitter, type VfxMode, type VfxOptions,
} from "./vfxLab";
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
interface VfxLayer {
    effect: VfxEffect;
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
        { effect: "field", mode: "continuous", map: [
            { input: "activity", parameter: "intensity", from: 0.36, to: 0.9 },
            { input: "velocity", parameter: "speed", from: 0.55, to: 1.25 },
        ] },
        { effect: "beam", priority: 3, options: { width: 0.085, lanes: 1, beamColor: "#C1B9FD" }, map: [
            { input: "pitch", parameter: "height", from: -0.5, to: 0.85 },
            { input: "sustain", parameter: "length", from: 0.65, to: 1.85 },
            { input: "activity", parameter: "intensity", from: 0.09, to: 0.7 },
        ] },
        { effect: "orbit", options: { density: 0.6, intensity: 0.52 } },
    ] },
    neon: { layers: [
        { effect: "wave", priority: 3, options: { intensity: 0.81 }, map: [
            { input: "density", parameter: "amplitude", from: 0.14, to: 0.62 },
            { input: "velocity", parameter: "opacity", from: 0.38, to: 0.82 },
        ] },
        { effect: "beam", options: { beamColor: "#FFBAAD", width: 0.103 }, map: [
            { input: "activity", parameter: "intensity", from: 0.16, to: 0.83 },
            { input: "pitch", parameter: "height", from: -0.35, to: 0.72 },
        ] },
        { effect: "ripple", gate: "chord", priority: 5, options: { intensity: 0.67 }, map: [
            { input: "chord", parameter: "range", from: 0.88, to: 1.35 },
        ] },
    ] },
    stage: { layers: [
        { effect: "fountain", priority: 3, map: [
            { input: "density", parameter: "speed", from: 0.6, to: 1.36 },
            { input: "density", parameter: "density", from: 0.4, to: 1.25 },
            { input: "activity", parameter: "intensity", from: 0.06, to: 0.92 },
        ] },
        { effect: "curtain", options: { curtainColor: "#9B97DD" }, map: [
            { input: "density", parameter: "length", from: 0.58, to: 2.08 },
            { input: "activity", parameter: "intensity", from: 0.22, to: 0.8 },
            { input: "high", parameter: "speed", from: 0.64, to: 1.42 },
        ] },
        { effect: "ripple", gate: "chord", priority: 5, map: [
            { input: "low", parameter: "range", from: 0.7, to: 1.42 },
            { input: "chord", parameter: "intensity", from: 0.4, to: 0.73 },
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
            const { effect, mode, options, map, priority, gate } = record(layer);
            if (!isVfxEffect(effect)) throw new Error(`未知特效 ${effect}`);
            if (mode !== undefined && mode !== "autonomous" && mode !== "continuous" && mode !== "trigger") throw new Error("无效的 mode");
            if (gate !== undefined && gate !== "onset" && gate !== "chord") throw new Error("gate 需要是 onset 或 chord");
            if (map !== undefined && (!Array.isArray(map) || map.length > 6)) throw new Error("图层最多 6 个参数映射");
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
            return { effect, mode, gate, map: validatedMap,
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

/** Future score drivers can supply the same presets with features and an external tick clock. */
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

    update(tick: number, music: Readonly<MusicFeatures>, solo = false): VfxBatch[] {
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
            options.intensity = envelope * (options.intensity ?? 1);
            const emitters = effectEmitters(layer.effect, options, {
                music: mode === "autonomous" ? quietFeatures : music,
                previous: state.previous ?? options,
            });
            state.next = tick + effect.interval;
            state.previous = options;
            batches.push({ priority: layer.priority ?? (mode === "trigger" ? 4 : 2), emitters });
        }
        return batches.sort((a, b) => b.priority - a.priority);
    }
}
