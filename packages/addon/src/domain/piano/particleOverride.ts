import {
    PERFORMANCE_PALETTES,
    resolvePerformanceColor,
    type PerformanceBrush,
    type PerformanceMotion,
} from "@piano/core";
import { blendHex, hexToUnitRgb } from "./vfxDraw";

export const PIANO_PARTICLE_STYLES = [
    { value: 3, label: "魔法流光", effect: "pbe:magic_trail" },
    { value: 4, label: "蓝眼泪 · 发光气泡", effect: "pbe:blue_tears" },
    { value: 0, label: "霓虹音符", effect: "pbe:neon_note" },
    { value: 2, label: "电光涟漪", effect: "pbe:pulse_ring" },
    { value: 5, label: "樱吹雪 · 粉色花瓣", effect: "pbe:sakura_drift" },
    { value: 6, label: "星火 · 闪烁星芒", effect: "pbe:stardust" },
    { value: 7, label: "棱光 · 彩色晶片", effect: "pbe:prism_shards" },
] as const;

export const PIANO_PARTICLE_PALETTES = [
    { value: 0, label: "极光 · 青蓝到淡紫", colors: ["#64DBF2", "#E1A0F7"] },
    { value: 1, label: "琥珀 · 暖橙到浅金", colors: ["#E88F54", "#FFE0A1"] },
    { value: 2, label: "森语 · 青绿到嫩黄", colors: ["#48C4AD", "#D4ED92"] },
    { value: 3, label: "月白 · 冷白", colors: ["#D5E6FF", "#D5E6FF"] },
    { value: 4, label: "虹谱 · 紫蓝、青、绿、金、橙红", colors: ["#9362F5", "#45CFFF", "#60E7A4", "#FADF65", "#FA694F"] },
    { value: 5, label: "冰火 · 冰蓝、紫红、金橙", colors: ["#43DBFF", "#CD67F4", "#F5638A", "#FFC061"] },
    { value: 6, label: "深海 · 深蓝到亮青", colors: ["#176FFF", "#29B6FF", "#4DE8FF"] },
] as const;

export const KEY_PARTICLE_STYLE_IDS = [
    "inherit",
    "magic_trail",
    "blue_tears",
    "neon_note",
    "pulse_ring",
    "sakura_drift",
    "stardust",
    "prism_shards",
    "snow",
    "none",
] as const;

export type KeyParticleStyleId = (typeof KEY_PARTICLE_STYLE_IDS)[number];

export const KEY_PARTICLE_STYLE_LABELS: Readonly<Record<KeyParticleStyleId, string>> = {
    inherit: "沿用钢琴设置",
    magic_trail: "魔法流光",
    blue_tears: "蓝眼泪",
    neon_note: "霓虹音符",
    pulse_ring: "电光涟漪",
    sakura_drift: "樱吹雪",
    stardust: "星火",
    prism_shards: "棱光晶片",
    snow: "雪晶飘雪",
    none: "仅微光／隐藏",
};

export const KEY_PARTICLE_STYLE_EFFECTS: Readonly<Record<Exclude<KeyParticleStyleId, "inherit" | "snow" | "none">, string>> = {
    magic_trail: "pbe:magic_trail",
    blue_tears: "pbe:blue_tears",
    neon_note: "pbe:neon_note",
    pulse_ring: "pbe:pulse_ring",
    sakura_drift: "pbe:sakura_drift",
    stardust: "pbe:stardust",
    prism_shards: "pbe:prism_shards",
};

const EFFECT_TO_STYLE_ID = new Map<string, KeyParticleStyleId>(
    Object.entries(KEY_PARTICLE_STYLE_EFFECTS).map(([style, effect]) => [effect, style as KeyParticleStyleId]),
);

const BRUSH_TO_KEY_STYLE: Readonly<Record<PerformanceBrush, KeyParticleStyleId>> = {
    default: "inherit",
    spark: "magic_trail",
    mote: "blue_tears",
    note: "neon_note",
    ring: "pulse_ring",
    petal: "sakura_drift",
    star: "stardust",
    shard: "prism_shards",
    snow: "snow",
    blossom: "sakura_drift",
};

const ALIAS_MAP: Readonly<Record<string, { brush?: PerformanceBrush; motion?: PerformanceMotion }>> = {
    magic_trail: { brush: "spark" },
    blue_tears: { brush: "mote" },
    neon_note: { brush: "note" },
    pulse_ring: { brush: "ring" },
    sakura_drift: { brush: "petal" },
    stardust: { brush: "star" },
    prism_shards: { brush: "shard" },
    snow: { brush: "snow" },
    inherit: { brush: "default" },
    glimmer: { motion: "gentle" },
    none: { motion: "reverse" },
    off: { motion: "reverse" },
};

export interface PianoParticleOverride {
    style?: KeyParticleStyleId;
    colors?: readonly string[];
    glimmer?: boolean;
    intensity?: number;
    scale?: number;
}

export interface ResolvedKeyParticle {
    mainParticle?: string;
    drawPointVars?: Record<string, number>;
    color: { red: number; green: number; blue: number };
    glimmer: boolean;
    style: KeyParticleStyleId;
    colors: readonly string[];
    overridden: boolean;
}

export function keyParticleStyleForBrush(brush?: PerformanceBrush): KeyParticleStyleId {
    return brush ? BRUSH_TO_KEY_STYLE[brush] ?? "inherit" : "inherit";
}

export function parseKeyParticleAlias(style: string): { brush?: PerformanceBrush; motion?: PerformanceMotion } | undefined {
    const normalized = style.trim().toLowerCase();
    return Object.hasOwn(ALIAS_MAP, normalized) ? ALIAS_MAP[normalized] : undefined;
}

export function keyParticleOverrideFromCue(input: {
    brush?: PerformanceBrush;
    motion?: PerformanceMotion;
    color: string;
    color2?: string;
    intensity: number;
    scale: number;
}): PianoParticleOverride | undefined {
    if (!Number.isFinite(input.intensity) || input.intensity < 0.005) return undefined;
    const style: KeyParticleStyleId =
        input.motion === "reverse" || input.motion === "gentle"
            ? "none"
            : keyParticleStyleForBrush(input.brush);
    const colors = input.color2 && input.color2 !== input.color
        ? [input.color, input.color2]
        : [input.color];
    return {
        style,
        colors,
        glimmer: input.motion !== "reverse",
        intensity: Math.min(1, Math.max(0, input.intensity)),
        scale: Math.min(1.7, Math.max(0.5, Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1)),
    };
}

export function validateKeyParticleOverride(value: unknown): PianoParticleOverride {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("keyParticle 需要是 JSON 对象");
    }
    const record = value as Record<string, unknown>;
    const allowedKeys = new Set(["style", "colors", "glimmer", "intensity", "scale"]);
    for (const key of Object.keys(record)) {
        if (!allowedKeys.has(key)) throw new Error(`keyParticle 包含未知字段 ${key}`);
    }
    const result: PianoParticleOverride = {};
    if (record.style !== undefined) {
        if (typeof record.style !== "string" || !KEY_PARTICLE_STYLE_IDS.includes(record.style as KeyParticleStyleId)) {
            throw new Error(`未知弹奏粒子样式 ${record.style}`);
        }
        result.style = record.style as KeyParticleStyleId;
    }
    if (record.colors !== undefined) {
        if (!Array.isArray(record.colors) || record.colors.length < 1 || record.colors.length > 6) {
            throw new Error("keyParticle.colors 需要是 1–6 个颜色值");
        }
        result.colors = record.colors.map(item => {
            if (typeof item !== "string" && !Object.hasOwn(PERFORMANCE_PALETTES, String(item))) {
                throw new Error(`无效弹奏粒子颜色 ${item}`);
            }
            return resolvePerformanceColor(String(item));
        });
    }
    if (record.glimmer !== undefined) {
        if (typeof record.glimmer !== "boolean") throw new Error("keyParticle.glimmer 需要是布尔值");
        result.glimmer = record.glimmer;
    }
    if (record.intensity !== undefined) {
        if (typeof record.intensity !== "number" || !Number.isFinite(record.intensity) || record.intensity < 0 || record.intensity > 1) {
            throw new Error("keyParticle.intensity 需要在 0 到 1 之间");
        }
        result.intensity = record.intensity;
    }
    if (record.scale !== undefined) {
        if (typeof record.scale !== "number" || !Number.isFinite(record.scale) || record.scale < 0.5 || record.scale > 1.7) {
            throw new Error("keyParticle.scale 需要在 0.5 到 1.7 之间");
        }
        result.scale = record.scale;
    }
    return result;
}

function samplePitchHex(colors: readonly string[], midi: number): string {
    const resolved = colors.length ? colors : PIANO_PARTICLE_PALETTES[0].colors;
    const first = resolvePerformanceColor(resolved[0]);
    if (resolved.length === 1) return first;
    const clamped = Math.min(1, Math.max(0, (midi - 21) / 87));
    const position = clamped * (resolved.length - 1);
    const index = Math.min(Math.floor(position), resolved.length - 2);
    const low = resolvePerformanceColor(resolved[index]);
    const high = resolvePerformanceColor(resolved[index + 1]);
    return blendHex(low, high, position - index);
}

export function resolveKeyParticle(
    midi: number,
    settings: { particleStyle: number; particlePalette: number },
    right: { x: number; z: number },
    override?: PianoParticleOverride,
): ResolvedKeyParticle {
    const baseStyle = PIANO_PARTICLE_STYLES.find(option => option.value === settings.particleStyle) ?? PIANO_PARTICLE_STYLES[0];
    const baseStyleId = EFFECT_TO_STYLE_ID.get(baseStyle.effect) ?? "magic_trail";
    const basePalette = PIANO_PARTICLE_PALETTES.find(option => option.value === settings.particlePalette) ?? PIANO_PARTICLE_PALETTES[0];

    const style: KeyParticleStyleId = !override?.style || override.style === "inherit" ? baseStyleId : override.style;
    const colors: readonly string[] = override?.colors?.length ? override.colors : basePalette.colors;
    const glimmer = override?.glimmer ?? true;
    const overridden = Boolean(
        override && (
            (override.style !== undefined && override.style !== "inherit")
            || (override.colors !== undefined && override.colors.length > 0)
            || override.glimmer !== undefined
            || override.intensity !== undefined
            || override.scale !== undefined
        ),
    );

    const pitchHex = samplePitchHex(colors, midi);
    const color = hexToUnitRgb(pitchHex);

    if (style === "none") {
        return { mainParticle: undefined, color, glimmer, style, colors, overridden };
    }

    if (style === "snow") {
        const intensity = Math.min(1, Math.max(0, override?.intensity ?? 0.85));
        const scale = Math.min(1.7, Math.max(0.5, override?.scale ?? 1));
        const highlightHex = blendHex(pitchHex, "#FFFFFF", 0.45);
        const color2 = hexToUnitRgb(highlightHex);
        return {
            mainParticle: "pbe:vfx_draw_point",
            drawPointVars: {
                count: intensity >= 0.8 ? 4 : 3,
                life: 0.82,
                life_jitter: 0.22,
                brush: 3,
                spread_x: 0.05,
                spread_y: 0.03,
                spread_z: 0.04,
                vy: 0.92,
                ay: -0.42,
                flutter: 0.09,
                size: 0.056,
                size_end: 0.03,
                size_jitter: 0.25,
                spin_jitter: 180,
                spin_rate: 95,
                red: color.red,
                green: color.green,
                blue: color.blue,
                red2: color2.red,
                green2: color2.green,
                blue2: color2.blue,
                opacity: Math.min(1, 0.58 + 0.37 * intensity),
                fade_in: 0.08,
                fade_out: 0.34,
                twinkle: 0.45,
                right_x: right.x,
                right_z: right.z,
                scale,
                stage_depth: 1,
            },
            color,
            glimmer,
            style,
            colors,
            overridden,
        };
    }

    const mainParticle = style === "inherit"
        ? baseStyle.effect
        : KEY_PARTICLE_STYLE_EFFECTS[style];

    return { mainParticle, color, glimmer, style, colors, overridden };
}
