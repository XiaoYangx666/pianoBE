import { PERFORMANCE_PALETTES, resolvePerformanceColor } from "@piano/core";
import { POINT_BRUSH_INDEX, type PointBrushId } from "./brushes";
import { blendHex, colorVars, hexToUnitRgb } from "./color";
import type { DrawPointsSpec } from "./primitives";
import type { PianoParticleOverride, VfxEffectParams } from "./types";

type PointStyleDraw = Omit<DrawPointsSpec, "brush" | "color" | "color2" | "opacity">;

interface PointStyle {
    label: string;
    /** Stable numeric value persisted in piano settings; undefined for cue-only styles. */
    value?: number;
    brush: PointBrushId;
    alpha: number;
    draw: PointStyleDraw;
}

interface SpecialStyle {
    label: string;
    special: "inherit" | "glimmer" | "none";
}

type KeyParticleStyle = PointStyle | SpecialStyle;

/**
 * Single source of truth for every note particle. Adding a style means adding one
 * entry here; labels, the settings dropdown, cue variants and `resolveKeyParticle`
 * all derive from this table. Every sound style reuses `pbe:vfx_draw_point` and the
 * shared vfx_lab atlas, so it needs no dedicated Bedrock particle document.
 */
export const KEY_PARTICLE_STYLES = {
    inherit: { label: "沿用钢琴设置", special: "inherit" },
    magic_trail: {
        label: "魔法流光",
        value: 3,
        brush: "spark",
        alpha: 0.92,
        draw: {
            count: 1, life: 0.62, size: 0.09, sizeEnd: 0.045,
            velocity: [0, 1.35, 0], accel: [0, 0.16, 0],
            twinkle: 0.18, fadeIn: 0.04, fadeOut: 0.34,
        },
    },
    blue_tears: {
        label: "蓝眼泪 · 发光气泡",
        value: 4,
        brush: "mote",
        alpha: 0.9,
        draw: {
            count: 5, life: 0.6, lifeJitter: 0.3, size: 0.045, sizeEnd: 0.028, sizeJitter: 0.32,
            spread: [0.05, 0.14, 0.05], velocity: [0, 1.5, 0], accel: [0, 0.34, 0],
            twinkle: 0.45, fadeIn: 0.04, fadeOut: 0.36,
        },
    },
    neon_note: {
        label: "霓虹音符",
        value: 0,
        brush: "note",
        alpha: 0.94,
        draw: {
            count: 1, life: 0.48, size: 0.105, sizeEnd: 0.075, spinJitter: 10, spinRate: 24,
            velocity: [0, 1.1, 0], accel: [0, 0.24, 0], fadeIn: 0.03, fadeOut: 0.3,
        },
    },
    pulse_ring: {
        label: "电光涟漪",
        value: 2,
        brush: "ring",
        alpha: 0.9,
        draw: {
            count: 1, life: 0.36, size: 0.05, sizeEnd: 0.19,
            velocity: [0, 0.8, 0], accel: [0, 0.2, 0], fadeIn: 0.03, fadeOut: 0.3,
        },
    },
    sakura_drift: {
        label: "樱吹雪 · 粉色花瓣",
        value: 5,
        brush: "petal",
        alpha: 0.94,
        draw: {
            count: 3, life: 0.85, lifeJitter: 0.2, size: 0.058, sizeEnd: 0.042, sizeJitter: 0.3,
            spread: [0.06, 0.08, 0.06], velocity: [0, 1, 0], accel: [0, 0.12, 0],
            flutter: 0.12, spinJitter: 180, spinRate: 135, fadeIn: 0.05, fadeOut: 0.42,
        },
    },
    stardust: {
        label: "星火 · 闪烁星芒",
        value: 6,
        brush: "star",
        alpha: 0.9,
        draw: {
            count: 4, life: 0.55, lifeJitter: 0.3, size: 0.045, sizeEnd: 0.024, sizeJitter: 0.36,
            spread: [0.08, 0.1, 0.08], velocity: [0, 1.2, 0], accel: [0, 0.26, 0],
            twinkle: 0.82, fadeIn: 0.03, fadeOut: 0.3,
        },
    },
    prism_shards: {
        label: "棱光 · 彩色晶片",
        value: 7,
        brush: "shard",
        alpha: 0.86,
        draw: {
            count: 3, life: 0.6, lifeJitter: 0.25, size: 0.062, sizeEnd: 0.034, sizeJitter: 0.3,
            spread: [0.06, 0.1, 0.06], velocity: [0, 1.4, 0], accel: [0, 0.28, 0],
            spinJitter: 180, spinRate: 180, twinkle: 0.3, fadeOut: 0.32,
        },
    },
    snow: {
        label: "雪晶飘雪",
        brush: "snow",
        alpha: 0.9,
        draw: {
            count: 4, life: 0.82, lifeJitter: 0.22, size: 0.056, sizeEnd: 0.03, sizeJitter: 0.28,
            spread: [0.05, 0.03, 0.04], velocity: [0, 0.92, 0], accel: [0, -0.42, 0],
            flutter: 0.09, spinJitter: 180, spinRate: 95, twinkle: 0.45, fadeIn: 0.08, fadeOut: 0.34,
        },
    },
    glimmer: { label: "仅琴键微光", special: "glimmer" },
    none: { label: "隐藏弹奏粒子", special: "none" },
} as const satisfies Readonly<Record<string, KeyParticleStyle>>;

export type KeyParticleStyleId = keyof typeof KEY_PARTICLE_STYLES;
export const KEY_PARTICLE_STYLE_IDS = Object.keys(KEY_PARTICLE_STYLES) as KeyParticleStyleId[];

export const KEY_PARTICLE_STYLE_LABELS = Object.fromEntries(
    Object.entries(KEY_PARTICLE_STYLES).map(([id, style]) => [id, style.label]),
) as Readonly<Record<KeyParticleStyleId, string>>;

/** Styles exposed in the piano settings dropdown, in their persisted order. */
export const PIANO_PARTICLE_STYLES = KEY_PARTICLE_STYLE_IDS.flatMap(id => {
    const style = KEY_PARTICLE_STYLES[id];
    return "value" in style && style.value !== undefined
        ? [{ value: style.value, label: style.label, style: id }]
        : [];
});

export const PIANO_PARTICLE_PALETTES = [
    { value: 0, label: "极光 · 青蓝到淡紫", colors: ["#64DBF2", "#E1A0F7"] },
    { value: 1, label: "琥珀 · 暖橙到浅金", colors: ["#E88F54", "#FFE0A1"] },
    { value: 2, label: "森语 · 青绿到嫩黄", colors: ["#48C4AD", "#D4ED92"] },
    { value: 3, label: "月白 · 冷白", colors: ["#D5E6FF", "#D5E6FF"] },
    { value: 4, label: "虹谱 · 紫蓝、青、绿、金、橙红", colors: ["#9362F5", "#45CFFF", "#60E7A4", "#FADF65", "#FA694F"] },
    { value: 5, label: "冰火 · 冰蓝、紫红、金橙", colors: ["#43DBFF", "#CD67F4", "#F5638A", "#FFC061"] },
    { value: 6, label: "深海 · 深蓝到亮青", colors: ["#176FFF", "#29B6FF", "#4DE8FF"] },
] as const;

export type { PianoParticleOverride };

const STYLE_SET = new Set<string>(KEY_PARTICLE_STYLE_IDS);

export interface KeyParticleEmitter {
    particle: "pbe:vfx_draw_point";
    variables: Record<string, number>;
    /** Glimmer is anchored on the key surface instead of the shared emission line. */
    onKey?: boolean;
}

export interface ResolvedKeyParticle {
    color: { red: number; green: number; blue: number };
    glimmer: boolean;
    style: KeyParticleStyleId;
    colors: readonly string[];
    overridden: boolean;
    emitters: KeyParticleEmitter[];
}

export function isKeyParticleStyleId(value: unknown): value is KeyParticleStyleId {
    return typeof value === "string" && STYLE_SET.has(value);
}

/** 从 `key_style` 的独立 `variant` 字段直接解析弹奏粒子覆盖，不复用 brush/motion。 */
export function keyParticleOverrideFromParams(params: VfxEffectParams): PianoParticleOverride | undefined {
    if (!Number.isFinite(params.intensity) || params.intensity < 0.005) return undefined;
    const raw = params.variant?.trim().toLowerCase() || "inherit";
    const colors = params.color2 && params.color2 !== params.color
        ? [params.color, params.color2]
        : [params.color];
    const intensity = Math.min(1, Math.max(0, params.intensity));
    const scale = Math.min(1.7, Math.max(0.5, Number.isFinite(params.scale) && params.scale > 0 ? params.scale : 1));

    if (raw === "glimmer") {
        return { style: "glimmer", colors, glimmer: true, intensity, scale };
    }
    if (raw === "none" || raw === "off") {
        return { style: "none", colors, glimmer: false, intensity, scale };
    }
    const style: KeyParticleStyleId = isKeyParticleStyleId(raw) ? raw : "inherit";
    return { style, colors, glimmer: true, intensity, scale };
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
        if (!isKeyParticleStyleId(record.style)) {
            throw new Error(`未知弹奏粒子样式 ${record.style}`);
        }
        result.style = record.style;
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

function pointVariables(
    style: PointStyle,
    color: string,
    color2: string,
    intensity: number,
    scale: number,
    right: { x: number; z: number },
) {
    const draw = style.draw;
    return {
        ...colorVars(color, color2, style.alpha * intensity),
        right_x: right.x,
        right_z: right.z,
        count: draw.count,
        life: draw.life,
        life_jitter: draw.lifeJitter ?? 0.2,
        brush: POINT_BRUSH_INDEX[style.brush],
        size: draw.size ?? 0.08,
        size_end: draw.sizeEnd ?? draw.size ?? 0.08,
        size_jitter: draw.sizeJitter ?? 0.22,
        spin: draw.spin ?? 0,
        spin_jitter: draw.spinJitter ?? 0,
        spin_rate: draw.spinRate ?? 0,
        phase: draw.phase ?? 0,
        phase_spread: draw.phaseSpread ?? 360,
        omega: draw.omega ?? 0,
        radius: draw.radius ?? 0,
        radius_end: draw.radiusEnd ?? draw.radius ?? 0,
        curve: draw.curve ?? 1,
        radial_jitter: draw.radialJitter ?? 0,
        depth_ratio: draw.depthRatio ?? 0.9,
        tilt: draw.tilt ?? 0,
        rise: draw.rise ?? 0,
        flutter: draw.flutter ?? 0,
        spread_x: draw.spread?.[0] ?? 0,
        spread_y: draw.spread?.[1] ?? 0,
        spread_z: draw.spread?.[2] ?? 0,
        vx: draw.velocity?.[0] ?? 0,
        vy: draw.velocity?.[1] ?? 0,
        vz: draw.velocity?.[2] ?? 0,
        ax: draw.accel?.[0] ?? 0,
        ay: draw.accel?.[1] ?? 0,
        az: draw.accel?.[2] ?? 0,
        fade_in: draw.fadeIn ?? 0.16,
        fade_out: draw.fadeOut ?? 0.35,
        twinkle: draw.twinkle ?? 0,
        scale,
    };
}

const GLIMMER = {
    life: 0.16,
    size: 0.03,
    sizeEnd: 0.018,
    alpha: 0.82,
} as const;

export function resolveKeyParticle(
    midi: number,
    settings: { particleStyle: number; particlePalette: number },
    right: { x: number; z: number },
    override?: PianoParticleOverride,
): ResolvedKeyParticle {
    const baseStyle = PIANO_PARTICLE_STYLES.find(option => option.value === settings.particleStyle) ?? PIANO_PARTICLE_STYLES[0];
    const baseStyleId = baseStyle.style;
    const basePalette = PIANO_PARTICLE_PALETTES.find(option => option.value === settings.particlePalette) ?? PIANO_PARTICLE_PALETTES[0];

    const style: KeyParticleStyleId = !override?.style || override.style === "inherit" ? baseStyleId : override.style;
    const colors: readonly string[] = override?.colors?.length ? override.colors : basePalette.colors;
    const glimmer = override?.style === "none"
        ? (override.glimmer ?? false)
        : override?.glimmer ?? true;
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
    const highlightHex = blendHex(pitchHex, "#FFFFFF", 0.42);
    const intensity = Math.min(1, Math.max(0, override?.intensity ?? 1));
    const scale = Math.min(1.7, Math.max(0.5, override?.scale ?? 1));
    const emitters: KeyParticleEmitter[] = [];

    const definition = KEY_PARTICLE_STYLES[style];
    if (!("special" in definition)) {
        emitters.push({
            particle: "pbe:vfx_draw_point",
            variables: pointVariables(definition, pitchHex, blendHex(pitchHex, highlightHex, 0.55), intensity, scale, right),
        });
    }
    if (glimmer) {
        emitters.push({
            particle: "pbe:vfx_draw_point",
            variables: {
                ...colorVars(pitchHex, highlightHex, GLIMMER.alpha * intensity),
                count: 1, life: GLIMMER.life, life_jitter: 0,
                brush: POINT_BRUSH_INDEX.mote,
                size: GLIMMER.size, size_end: GLIMMER.sizeEnd, size_jitter: 0,
                fade_in: 0.02, fade_out: 0.2, scale,
            },
            onKey: true,
        });
    }
    return { color, glimmer, style, colors, overridden, emitters };
}
