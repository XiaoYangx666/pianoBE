import {
    PERFORMANCE_MOTIONS, PERFORMANCE_ZONES, isValidPerformanceSymbol, resolvePerformanceColor,
    type PerformanceMotion, type PerformanceParams, type PerformanceZone,
} from "@piano/core";
import { isValidBrush } from "./brushes";
import { isVfxEffect, validateEffectCustomParams } from "./effects";
import { validateKeyParticleOverride } from "./keyParticles";
import { quietFeatures, type MusicFeatures } from "./music";
import { vfxRegistry, type VfxRegistry } from "./registry";
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

export type VfxThemeId = string;

export function isVfxTheme(name: unknown, registry: VfxRegistry = vfxRegistry): name is VfxThemeId {
    return typeof name === "string" && registry.hasTheme(name);
}

export function getVfxTheme(id: string, registry: VfxRegistry = vfxRegistry): VfxTheme | undefined {
    return registry.getTheme(id);
}

export function getVfxThemeIds(registry: VfxRegistry = vfxRegistry): VfxThemeId[] {
    return registry.getThemeIds();
}

export function listVfxThemes(registry: VfxRegistry = vfxRegistry): { id: VfxThemeId; theme: VfxTheme }[] {
    return registry.listThemes();
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

export function validateVfxTheme(value: unknown, registry: VfxRegistry = vfxRegistry): VfxTheme {
    const { label, keyParticle, layers, seconds, fadeIn, fadeOut } = asRecord(value);
    if (!Array.isArray(layers) || !layers.length || layers.length > 8) {
        throw new Error("主题需要 1–8 个特效图层");
    }
    if (label !== undefined && (typeof label !== "string" || !label.trim())) {
        throw new Error("label 不能为空字符串");
    }

    const validatedLayers: VfxThemeLayer[] = layers.map((raw) => {
        const layer = asRecord(raw);
        if (typeof layer.effect !== "string" || !isVfxEffect(layer.effect, registry)) {
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

        const params = validateEffectCustomParams(layer.effect, layer.params, registry);

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
        ...(keyParticle !== undefined ? { keyParticle: validateKeyParticleOverride(keyParticle, registry) } : {}),
        ...(seconds !== undefined ? { seconds: bounded(seconds, 5, 180, "seconds") } : {}),
        ...(fadeIn !== undefined ? { fadeIn: bounded(fadeIn, 0, 4, "fadeIn") } : {}),
        ...(fadeOut !== undefined ? { fadeOut: bounded(fadeOut, 0, 4, "fadeOut") } : {}),
        layers: validatedLayers,
    };
}
