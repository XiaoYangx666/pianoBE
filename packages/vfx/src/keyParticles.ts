import { PERFORMANCE_PALETTES, resolvePerformanceColor } from "@piano/core";
import { POINT_BRUSH_INDEX, type PointBrushId } from "./brushes";
import { blendHex, colorVars, hexToUnitRgb } from "./color";
import type { Point3 } from "./geometry";
import type { PianoParticleOverride, VfxEffectParams, VfxParticle } from "./types";

export interface KeyParticlePalette {
    value: number;
    label: string;
    colors: readonly string[];
}

/** Player-facing palettes for free-color styles. Values stay stable; retired slots are not reused. */
export const PIANO_PARTICLE_PALETTES: readonly KeyParticlePalette[] = [
    { value: 0, label: "极光 · 青蓝到淡紫", colors: ["#64DBF2", "#E1A0F7"] },
    { value: 1, label: "琥珀 · 暖橙到浅金", colors: ["#E88F54", "#FFE0A1"] },
    { value: 3, label: "月白 · 冷白与浅蓝", colors: ["#D5E6FF", "#9FC9FF"] },
    { value: 4, label: "虹谱 · 紫蓝、青、绿、金、橙红", colors: ["#9362F5", "#45CFFF", "#60E7A4", "#FADF65", "#FA694F"] },
];

const BLUE_TEAR_PALETTES: readonly KeyParticlePalette[] = [
    { value: 0, label: "冰蓝 · 深蓝到亮青", colors: ["#2F6BFF", "#6FE9FF"] },
    { value: 1, label: "青碧 · 湖蓝到薄荷", colors: ["#1FB6D8", "#A6F5EA"] },
    { value: 2, label: "月白 · 冰白到淡蓝", colors: ["#C8E6FF", "#7FB8FF"] },
];

const PRISM_PALETTES: readonly KeyParticlePalette[] = [
    { value: 0, label: "棱彩 · 青蓝到紫金", colors: ["#4EEBFF", "#C58CFF", "#FFE29A"] },
    { value: 1, label: "霞光 · 粉金到浅橙", colors: ["#FF8DA8", "#FFB870", "#FFE29A"] },
    { value: 2, label: "极光棱 · 青蓝到淡紫", colors: ["#64DBF2", "#9E8CFF", "#E1A0F7"] },
];

const SAKURA_PALETTE = ["#F2A7C3", "#FFF4E8"] as const;
const SNOW_PALETTE = ["#DCEBFF", "#FFFFFF"] as const;

type KeyParticleColor =
    /** Pitch-gradient over the four curated player palettes. */
    | { mode: "free" }
    /** Only the palettes declared by this style. */
    | { mode: "limited"; palettes: readonly KeyParticlePalette[] }
    /** Natural look: the style owns its colors and the player cannot recolor it. */
    | { mode: "fixed"; colors: readonly string[] };

interface KeyParticleDraw {
    count: number;
    life: number;
    lifeJitter?: number;
    size?: number;
    sizeEnd?: number;
    sizeJitter?: number;
    /** Height multiplier for non-square billboards. */
    aspect?: number;
    /** Exponential drag used by the stream primitive. */
    drag?: number;
    /** >0.5 mixes each particle between color and highlight instead of fading over age. */
    colorRandom?: number;
    spin?: number;
    spinJitter?: number;
    spinRate?: number;
    phase?: number;
    phaseSpread?: number;
    omega?: number;
    radius?: number;
    radiusEnd?: number;
    curve?: number;
    radialJitter?: number;
    depthRatio?: number;
    tilt?: number;
    rise?: number;
    flutter?: number;
    spread?: Point3;
    velocity?: Point3;
    accel?: Point3;
    fadeIn?: number;
    fadeOut?: number;
    twinkle?: number;
}

interface RenderStyle {
    label: string;
    /** Stable numeric value persisted in piano settings; undefined for cue-only styles. */
    value?: number;
    render: "point" | "stream" | "drift";
    /** Optional dedicated particle document overriding the render primitive. */
    particle?: VfxParticle;
    brush: PointBrushId;
    alpha: number;
    color: KeyParticleColor;
    draw: KeyParticleDraw;
}

interface SpecialStyle {
    label: string;
    special: "inherit" | "glimmer" | "none";
}

type KeyParticleStyle = RenderStyle | SpecialStyle;

/**
 * Single source of truth for every note particle. Adding a style means adding one
 * entry here; labels, the settings dropdown, color capability, cue variants and
 * `resolveKeyParticle` all derive from this table.
 *
 * Most styles use the shared `draw_point` primitive. Only effects that genuinely
 * need another material, billboard orientation or body shape get a dedicated
 * primitive: `key_stream` (additive vertical streamer) and `key_drift` (normal
 * blended, naturally falling petal/snow).
 */
export const KEY_PARTICLE_STYLES = {
    inherit: { label: "沿用钢琴设置", special: "inherit" },
    magic_trail: {
        label: "魔法流光",
        value: 3,
        render: "stream",
        particle: "magic_trail",
        brush: "spark",
        alpha: 0.92,
        color: { mode: "free" },
        draw: {
            count: 1, life: 0.62, size: 0.09, sizeEnd: 0.045,
            velocity: [0, 1.35, 0], accel: [0, 0.16, 0],
            twinkle: 0.18, fadeIn: 0.04, fadeOut: 0.34,
        },
    },
    blue_tears: {
        label: "蓝眼泪 · 发光气泡",
        value: 4,
        render: "point",
        particle: "key_blue_tears",
        brush: "mote",
        alpha: 0.9,
        color: { mode: "limited", palettes: BLUE_TEAR_PALETTES },
        draw: {
            count: 5, life: 0.6, lifeJitter: 0.3, size: 0.045, sizeEnd: 0.028, sizeJitter: 0.32,
            spread: [0.05, 0.14, 0.05], velocity: [0, 1.5, 0], accel: [0, 0.34, 0],
            twinkle: 0.45, fadeIn: 0.04, fadeOut: 0.36,
        },
    },
    neon_note: {
        label: "霓虹音符",
        value: 0,
        render: "point",
        brush: "note",
        alpha: 0.94,
        color: { mode: "free" },
        draw: {
            count: 1, life: 0.48, size: 0.105, sizeEnd: 0.075, spinJitter: 10, spinRate: 24,
            velocity: [0, 1.1, 0], accel: [0, 0.24, 0], fadeIn: 0.03, fadeOut: 0.3,
        },
    },
    sakura_drift: {
        label: "樱吹雪 · 粉色花瓣",
        value: 5,
        render: "drift",
        brush: "petal",
        alpha: 0.94,
        color: { mode: "fixed", colors: SAKURA_PALETTE },
        draw: {
            count: 3, life: 0.85, lifeJitter: 0.2, size: 0.058, sizeEnd: 0.042, sizeJitter: 0.3, aspect: 1.15,
            spread: [0.06, 0.08, 0.06], velocity: [0, 1, 0], accel: [0, 0.12, 0],
            flutter: 0.12, spinJitter: 180, spinRate: 135, fadeIn: 0.05, fadeOut: 0.42,
        },
    },
    stardust: {
        label: "星火 · 闪烁星芒",
        value: 6,
        render: "point",
        brush: "star",
        alpha: 0.9,
        color: { mode: "free" },
        draw: {
            count: 4, life: 0.55, lifeJitter: 0.3, size: 0.045, sizeEnd: 0.024, sizeJitter: 0.36,
            spread: [0.08, 0.1, 0.08], velocity: [0, 1.2, 0], accel: [0, 0.26, 0],
            twinkle: 0.82, fadeIn: 0.03, fadeOut: 0.3,
        },
    },
    prism_shards: {
        label: "棱光 · 彩色晶片",
        value: 7,
        render: "point",
        brush: "shard",
        alpha: 0.86,
        color: { mode: "limited", palettes: PRISM_PALETTES },
        draw: {
            count: 3, life: 0.6, lifeJitter: 0.25, size: 0.052, sizeEnd: 0.028, sizeJitter: 0.3, aspect: 2.05,
            colorRandom: 1, spread: [0.06, 0.1, 0.06], velocity: [0, 1.4, 0], accel: [0, 0.28, 0],
            spinJitter: 180, spinRate: 180, twinkle: 0.3, fadeOut: 0.32,
        },
    },
    snow: {
        label: "雪晶飘雪",
        render: "drift",
        brush: "snow",
        alpha: 0.9,
        color: { mode: "fixed", colors: SNOW_PALETTE },
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

/** Shared default for addon settings and the Web lab. */
export const DEFAULT_KEY_PARTICLE_SETTINGS = {
    particleStyle: PIANO_PARTICLE_STYLES[0].value,
    particlePalette: PIANO_PARTICLE_PALETTES[0].value,
} as const;

const RENDER_PARTICLE: Readonly<Record<RenderStyle["render"], VfxParticle>> = {
    point: "draw_point",
    stream: "key_stream",
    drift: "key_drift",
};

export type KeyParticleColorMode = "free" | "limited" | "fixed" | "special";

export type { PianoParticleOverride };

const STYLE_SET = new Set<string>(KEY_PARTICLE_STYLE_IDS);

export interface KeyParticleEmitter {
    particle: VfxParticle;
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

/** Resolve a persisted numeric style value; retired values are intentionally absent. */
export function keyParticleStyleAt(value: unknown): KeyParticleStyleId | undefined {
    return typeof value === "number"
        ? PIANO_PARTICLE_STYLES.find(option => option.value === value)?.style
        : undefined;
}

export function keyParticleStyleValue(style: KeyParticleStyleId): number | undefined {
    return PIANO_PARTICLE_STYLES.find(option => option.style === style)?.value;
}

/** Color capability is part of the style definition, not a UI-side style-name table. */
export function keyParticleColorMode(style: KeyParticleStyleId | number): KeyParticleColorMode {
    const id = typeof style === "number" ? keyParticleStyleAt(style) : style;
    if (!id) return "special";
    const definition = KEY_PARTICLE_STYLES[id];
    if ("special" in definition) return "special";
    return definition.color.mode;
}

/**
 * Palettes shown for a style. `undefined` means the style has fixed natural colors
 * and the settings UI must hide the color option entirely.
 */
export function keyParticleColorOptions(
    style: KeyParticleStyleId | number,
): readonly KeyParticlePalette[] | undefined {
    const id = typeof style === "number" ? keyParticleStyleAt(style) : style;
    if (!id) return undefined;
    const definition = KEY_PARTICLE_STYLES[id];
    if ("special" in definition) return undefined;
    const color = definition.color;
    if (color.mode === "free") return PIANO_PARTICLE_PALETTES;
    if (color.mode === "limited") return color.palettes;
    return undefined;
}

/** Keep a persisted palette valid when the selected style or palette table changes. */
export function normalizeKeyParticlePalette(style: number, palette: number): number {
    const options = keyParticleColorOptions(style);
    if (!options) return 0;
    return options.find(option => option.value === palette)?.value ?? options[0].value;
}

function colorsForStyle(style: KeyParticleStyleId, palette: number): readonly string[] {
    const definition = KEY_PARTICLE_STYLES[style];
    if ("special" in definition) return PIANO_PARTICLE_PALETTES[0].colors;
    const color = definition.color;
    if (color.mode === "fixed") return color.colors;
    const options = color.mode === "free" ? PIANO_PARTICLE_PALETTES : color.palettes;
    return (options.find(option => option.value === palette) ?? options[0]).colors;
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

function styleVariables(
    style: RenderStyle,
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
        aspect: draw.aspect ?? 1,
        drag: draw.drag ?? 0,
        color_random: draw.colorRandom ?? 0,
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

    const style: KeyParticleStyleId = override?.style && override.style !== "inherit" && isKeyParticleStyleId(override.style)
        ? override.style
        : baseStyleId;
    const definition = KEY_PARTICLE_STYLES[style];
    const paletteColors = "special" in definition
        ? colorsForStyle(baseStyleId, settings.particlePalette)
        : colorsForStyle(style, settings.particlePalette);
    // Explicit cue/theme colors are the documented creator override and win for every style.
    const colors: readonly string[] = override?.colors?.length ? override.colors : paletteColors;
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

    if (!("special" in definition)) {
        emitters.push({
            particle: "particle" in definition ? definition.particle : RENDER_PARTICLE[definition.render],
            variables: styleVariables(
                definition,
                pitchHex,
                blendHex(pitchHex, highlightHex, 0.55),
                intensity,
                scale,
                right,
            ),
        });
    }
    if (glimmer) {
        emitters.push({
            particle: "draw_point",
            variables: {
                ...colorVars(pitchHex, highlightHex, GLIMMER.alpha * intensity),
                count: 1, life: GLIMMER.life, life_jitter: 0,
                brush: POINT_BRUSH_INDEX.mote,
                size: GLIMMER.size, size_end: GLIMMER.sizeEnd, size_jitter: 0,
                aspect: 1, color_random: 0,
                fade_in: 0.02, fade_out: 0.2, scale,
            },
            onKey: true,
        });
    }
    return { color, glimmer, style, colors, overridden, emitters };
}
