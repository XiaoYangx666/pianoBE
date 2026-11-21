import {
    PERFORMANCE_MOTIONS, PERFORMANCE_ZONES, isValidPerformanceSymbol, resolvePerformanceColor,
    type PerformanceMotion, type PerformanceParams, type PerformanceZone,
} from "@piano/core";
import { isValidBrush } from "./brushes";
import { validateEffectCustomParams, VFX_EFFECTS } from "./effects";
import { validateKeyParticleOverride } from "./keyParticles";
import { quietFeatures, type MusicFeatures } from "./music";
import type { PianoParticleOverride } from "./types";

export interface VfxThemeLevelMapping {
    input: keyof MusicFeatures;
    from: number;
    to: number;
}

export interface VfxThemeGate {
    input: "chord" | "onset" | "surge";
    threshold: number;
    cooldown: number;
}

export interface VfxThemeLayer {
    effect: string;
    slot?: number;
    color: string;
    color2?: string;
    brush?: string;
    variant?: string;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    /** 特效专属参数 */
    params?: PerformanceParams;
    /** 强度百分比（0–100）或由音乐特征映射 */
    level: number | VfxThemeLevelMapping;
    /** 缩放百分比（50–170） */
    scale?: number;
    /** 瞬时特效门限（触发器超过阈值且冷却结束后触发） */
    gate?: VfxThemeGate;
}

export interface VfxTheme {
    label?: string;
    keyParticle?: PianoParticleOverride;
    layers: readonly VfxThemeLayer[];
    seconds?: number;
    fadeIn?: number;
    fadeOut?: number;
}

export const VFX_THEME_ORDER = [
    "galaxy",
    "neon",
    "stage",
    "sakura",
    "starlight",
    "cathedral",
    "carnival",
] as const;

export type VfxThemeId = (typeof VFX_THEME_ORDER)[number];

export const VFX_THEMES: Readonly<Record<VfxThemeId, VfxTheme>> = {
    galaxy: {
        label: "梦幻星河",
        keyParticle: { style: "blue_tears", colors: ["#8EB8FF", "#C58CFF"], glimmer: true },
        layers: [
            {
                effect: "starfield",
                variant: "volume",
                color: "#9EBCFF",
                level: { input: "activity", from: 46, to: 83 },
            },
            {
                effect: "aurora_veil",
                color: "#9CBAFF",
                level: { input: "activity", from: 58, to: 85 },
            },
            {
                effect: "silk_streams",
                slot: 0,
                variant: "right",
                color: "#A0CAFF",
                level: { input: "activity", from: 46, to: 96 },
            },
            {
                effect: "silk_streams",
                slot: 1,
                variant: "left",
                color: "#AF8AF6",
                level: { input: "activity", from: 40, to: 73 },
            },
        ],
    },
    neon: {
        label: "霓虹音乐会",
        keyParticle: { style: "neon_note", colors: ["#4EEBFF", "#C58CFF"], glimmer: true },
        layers: [
            {
                effect: "light_pillars",
                slot: 0,
                variant: "neon_sides",
                color: "#70CCFF",
                level: { input: "activity", from: 25, to: 57 },
            },
            {
                effect: "light_pillars",
                slot: 1,
                variant: "neon_rear",
                color: "#B4A0FF",
                level: { input: "density", from: 20, to: 47 },
            },
        ],
    },
    stage: {
        label: "高能舞台",
        keyParticle: { style: "magic_trail", colors: ["#FFB870", "#FFE29A"], glimmer: true },
        layers: [
            {
                effect: "wing_curtain",
                color: "#FFAD65",
                level: { input: "surge", from: 7, to: 91 },
            },
            {
                effect: "light_pillars",
                variant: "backline",
                color: "#B57BE4",
                level: { input: "activity", from: 20, to: 49 },
            },
            {
                effect: "crown_fan",
                color: "#FFB467",
                level: { input: "surge", from: 0, to: 100 },
            },
            {
                effect: "firefly_rise",
                variant: "fountain",
                color: "#FFB37A",
                level: { input: "surge", from: 0, to: 62 },
            },
        ],
    },
    sakura: {
        label: "落樱星庭",
        keyParticle: { style: "sakura_drift", colors: ["#FFB7D5", "#FFF4DC"], glimmer: true },
        layers: [
            {
                effect: "petal_fall",
                color: "#FFB7D5",
                color2: "#FFF4DC",
                brush: "petal",
                zone: "high",
                level: { input: "activity", from: 45, to: 88 },
            },
            {
                effect: "firefly_rise",
                color: "#FFE29A",
                color2: "#FFB7D5",
                brush: "mote",
                zone: "low",
                level: { input: "activity", from: 35, to: 75 },
            },
            {
                effect: "silk_streams",
                color: "#FFB7D5",
                color2: "#D6EAFF",
                level: { input: "sustain", from: 30, to: 82 },
            },
            {
                effect: "key_fountain",
                color: "#FFB7D5",
                color2: "#FFE29A",
                brush: "petal",
                level: 78,
            },
        ],
    },
    starlight: {
        label: "星空法阵",
        keyParticle: { style: "stardust", colors: ["#8EB8FF", "#68E4FF"], glimmer: true },
        layers: [
            {
                effect: "starfield",
                color: "#8EB8FF",
                color2: "#D6EAFF",
                motion: "gentle",
                level: 55,
            },
            {
                effect: "magic_circle",
                color: "#68E4FF",
                color2: "#C58CFF",
                level: { input: "activity", from: 45, to: 90 },
            },
            {
                effect: "double_helix",
                color: "#7C92FF",
                color2: "#4EEBFF",
                brush: "star",
                level: { input: "surge", from: 25, to: 88 },
            },
            {
                effect: "key_constellation",
                color: "#D6EAFF",
                color2: "#68E4FF",
                brush: "star",
                level: 82,
            },
        ],
    },
    cathedral: {
        label: "圣光时空",
        keyParticle: { style: "magic_trail", colors: ["#D6EAFF", "#FFE29A"], glimmer: true },
        layers: [
            {
                effect: "aurora_veil",
                color: "#7C92FF",
                color2: "#68E4FF",
                level: { input: "activity", from: 52, to: 88 },
            },
            {
                effect: "portal_arch",
                color: "#8EB8FF",
                color2: "#FFE29A",
                level: { input: "sustain", from: 35, to: 92 },
            },
            {
                effect: "crown_fan",
                color: "#FFE29A",
                color2: "#FFB870",
                level: { input: "surge", from: 0, to: 95 },
            },
            {
                effect: "key_notes",
                color: "#D6EAFF",
                color2: "#FFE29A",
                brush: "note",
                level: 84,
            },
            {
                effect: "prism_rewind",
                color: "#68E4FF",
                color2: "#FFE29A",
                level: 78,
                gate: { input: "surge", threshold: 0.72, cooldown: 52 },
            },
        ],
    },
    carnival: {
        label: "璀璨烟花夜",
        keyParticle: { style: "prism_shards", colors: ["#FFB870", "#FF8DA8"], glimmer: true },
        layers: [
            {
                effect: "firefly_rise",
                color: "#FFB870",
                color2: "#FF8DA8",
                brush: "mote",
                level: 58,
            },
            {
                effect: "wing_ribbons",
                color: "#FFB870",
                color2: "#FF8DA8",
                level: { input: "activity", from: 38, to: 90 },
            },
            {
                effect: "light_pillars",
                color: "#4EEBFF",
                color2: "#C58CFF",
                level: { input: "density", from: 32, to: 78 },
            },
            {
                effect: "firework_bloom",
                color: "#FFE29A",
                color2: "#FF8DA8",
                level: 85,
                gate: { input: "chord", threshold: 0.35, cooldown: 36 },
            },
        ],
    },
};

export function isVfxTheme(name: unknown): name is VfxThemeId {
    return typeof name === "string" && Object.hasOwn(VFX_THEMES, name);
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("需要 JSON 对象");
    return value as Record<string, unknown>;
}

function bounded(value: unknown, min: number, max: number, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${name} 需要在 ${min} 到 ${max} 之间`);
    }
    return value;
}

export function validateVfxTheme(value: unknown): VfxTheme {
    const { label, keyParticle, layers, seconds, fadeIn, fadeOut } = asRecord(value);
    if (!Array.isArray(layers) || !layers.length || layers.length > 8) {
        throw new Error("主题需要 1–8 个特效图层");
    }
    if (label !== undefined && (typeof label !== "string" || !label.trim())) {
        throw new Error("label 不能为空字符串");
    }

    const validatedLayers: VfxThemeLayer[] = layers.map((raw) => {
        const layer = asRecord(raw);
        if (typeof layer.effect !== "string" || !Object.hasOwn(VFX_EFFECTS, layer.effect)) {
            throw new Error(`未知特效 ${String(layer.effect)}`);
        }
        const slot = layer.slot === undefined ? undefined : bounded(layer.slot, 0, 7, "slot");
        if (slot !== undefined && !Number.isInteger(slot)) throw new Error("slot 需要是整数");
        const color = resolvePerformanceColor(String(layer.color ?? "moon"));
        const color2 = layer.color2 !== undefined ? resolvePerformanceColor(String(layer.color2)) : undefined;

        let brush: string | undefined;
        if (layer.brush !== undefined) {
            if (typeof layer.brush !== "string" || (layer.brush !== "default" && !isValidBrush(layer.brush))) {
                throw new Error(`未知画笔 ${String(layer.brush)}`);
            }
            if (layer.brush !== "default") brush = layer.brush;
        }

        let variant: string | undefined;
        if (layer.variant !== undefined) {
            if (!isValidPerformanceSymbol(layer.variant)) {
                throw new Error(`无效变体 ${String(layer.variant)}`);
            }
            variant = layer.variant;
        }

        let zone: PerformanceZone | undefined;
        if (layer.zone !== undefined) {
            if (typeof layer.zone !== "string" || !Object.hasOwn(PERFORMANCE_ZONES, layer.zone)) {
                throw new Error(`未知高度区域 ${String(layer.zone)}`);
            }
            zone = layer.zone as PerformanceZone;
        }

        let motion: PerformanceMotion | undefined;
        if (layer.motion !== undefined) {
            if (typeof layer.motion !== "string" || !Object.hasOwn(PERFORMANCE_MOTIONS, layer.motion)) {
                throw new Error(`未知运动修饰 ${String(layer.motion)}`);
            }
            motion = layer.motion as PerformanceMotion;
        }

        let level: VfxThemeLayer["level"];
        if (layer.level === undefined) {
            level = 85;
        } else if (typeof layer.level === "number") {
            level = bounded(layer.level, 0, 100, "level");
        } else {
            const mapping = asRecord(layer.level);
            if (typeof mapping.input !== "string" || !Object.hasOwn(quietFeatures, mapping.input)) {
                throw new Error(`未知音乐特征 ${String(mapping.input)}`);
            }
            level = {
                input: mapping.input as keyof MusicFeatures,
                from: bounded(mapping.from, 0, 100, "level.from"),
                to: bounded(mapping.to, 0, 100, "level.to"),
            };
        }

        const scale = layer.scale === undefined ? undefined : bounded(layer.scale, 50, 170, "scale");

        let gate: VfxThemeGate | undefined;
        if (layer.gate !== undefined) {
            const rawGate = asRecord(layer.gate);
            if (rawGate.input !== "chord" && rawGate.input !== "onset" && rawGate.input !== "surge") {
                throw new Error("gate.input 需为 chord / onset / surge");
            }
            const cooldown = bounded(rawGate.cooldown, 1, 400, "gate.cooldown");
            if (!Number.isInteger(cooldown)) throw new Error("gate.cooldown 需要是整数");
            gate = {
                input: rawGate.input,
                threshold: bounded(rawGate.threshold, 0, 1, "gate.threshold"),
                cooldown,
            };
        }

        const params = validateEffectCustomParams(layer.effect, layer.params);

        return {
            effect: layer.effect,
            ...(slot !== undefined ? { slot } : {}),
            color,
            ...(color2 !== undefined ? { color2 } : {}),
            ...(brush !== undefined ? { brush } : {}),
            ...(variant !== undefined ? { variant } : {}),
            ...(zone !== undefined ? { zone } : {}),
            ...(motion !== undefined ? { motion } : {}),
            ...(params !== undefined ? { params } : {}),
            level,
            ...(scale !== undefined ? { scale } : {}),
            ...(gate !== undefined ? { gate } : {}),
        };
    });

    return {
        ...(label !== undefined ? { label: label.trim() } : {}),
        ...(keyParticle !== undefined ? { keyParticle: validateKeyParticleOverride(keyParticle) } : {}),
        ...(seconds !== undefined ? { seconds: bounded(seconds, 5, 180, "seconds") } : {}),
        ...(fadeIn !== undefined ? { fadeIn: bounded(fadeIn, 0, 4, "fadeIn") } : {}),
        ...(fadeOut !== undefined ? { fadeOut: bounded(fadeOut, 0, 4, "fadeOut") } : {}),
        layers: validatedLayers,
    };
}
