import { PERFORMANCE_PALETTES, resolvePerformanceColor } from "@piano/core";
import { POINT_BRUSH_INDEX, type PointBrushId } from "./brushes";
import { blendHex, colorVars, hexToUnitRgb } from "./color";
import type { Point3 } from "./geometry";
import { vfxRegistry, type VfxRegistry } from "./registry";
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

export type KeyParticleColor =
    /** Pitch-gradient over the four curated player palettes. */
    | { mode: "free" }
    /** Only the palettes declared by this style. */
    | { mode: "limited"; palettes: readonly KeyParticlePalette[] }
    /** Natural look: the style owns its colors and the player cannot recolor it. */
    | { mode: "fixed"; colors: readonly string[] };

export interface KeyParticleDraw {
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

export interface KeyParticleRenderStyle {
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

export interface KeyParticleSpecialStyle {
    label: string;
    special: "inherit" | "glimmer" | "none";
}

export type KeyParticleStyle = KeyParticleRenderStyle | KeyParticleSpecialStyle;

/** Host sentinel styles; render styles are provided by plugins. */
export const SPECIAL_KEY_PARTICLE_STYLES = {
    inherit: { label: "沿用钢琴设置", special: "inherit" },
    glimmer: { label: "仅琴键微光", special: "glimmer" },
    none: { label: "隐藏弹奏粒子", special: "none" },
} as const satisfies Readonly<Record<string, KeyParticleSpecialStyle>>;

export type KeyParticleStyleId = string;

/** Shared default for addon settings and the Web lab (value 3 = magic_trail when keys plugin is loaded). */
export const DEFAULT_KEY_PARTICLE_SETTINGS = {
    particleStyle: 3,
    particlePalette: PIANO_PARTICLE_PALETTES[0].value,
} as const;

const RENDER_PARTICLE: Readonly<Record<KeyParticleRenderStyle["render"], VfxParticle>> = {
    point: "draw_point",
    stream: "key_stream",
    drift: "key_drift",
};

export type KeyParticleColorMode = "free" | "limited" | "fixed" | "special";

export type { PianoParticleOverride };

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

function activeKeyStyle(id: string, registry: VfxRegistry): KeyParticleRenderStyle | undefined {
    const style = registry.getKeyStyle(id);
    if (!style) return undefined;
    const owner = registry.getKeyStyleOwner(id);
    if (owner && registry.isPluginDisabled(owner)) return undefined;
    return style;
}

export function listKeyParticleStyles(
    registry: VfxRegistry = vfxRegistry,
): { id: string; style: KeyParticleRenderStyle }[] {
    return registry.listKeyStyles();
}

/** Styles exposed in the piano settings dropdown, in their registration order. */
export function listPianoParticleStyles(
    registry: VfxRegistry = vfxRegistry,
): { value: number; label: string; style: KeyParticleStyleId }[] {
    const result: { value: number; label: string; style: KeyParticleStyleId }[] = [];
    for (const { id, style } of registry.listKeyStyles()) {
        if (style.value !== undefined) {
            result.push({ value: style.value, label: style.label, style: id });
        }
    }
    return result;
}

export function getKeyParticleStyleIds(registry: VfxRegistry = vfxRegistry): KeyParticleStyleId[] {
    return ["inherit", ...registry.getKeyStyleIds(), "glimmer", "none"];
}

export function getKeyParticleStyleLabel(id: string, registry: VfxRegistry = vfxRegistry): string {
    if (Object.hasOwn(SPECIAL_KEY_PARTICLE_STYLES, id)) {
        return SPECIAL_KEY_PARTICLE_STYLES[id as keyof typeof SPECIAL_KEY_PARTICLE_STYLES].label;
    }
    return registry.getKeyStyle(id)?.label ?? id;
}

export function isKeyParticleStyleId(
    value: unknown,
    registry: VfxRegistry = vfxRegistry,
): value is KeyParticleStyleId {
    if (typeof value !== "string") return false;
    return Object.hasOwn(SPECIAL_KEY_PARTICLE_STYLES, value) || registry.hasKeyStyle(value);
}

/** Resolve a persisted numeric style value; retired values are intentionally absent. */
export function keyParticleStyleAt(
    value: unknown,
    registry: VfxRegistry = vfxRegistry,
): KeyParticleStyleId | undefined {
    if (typeof value !== "number") return undefined;
    return listPianoParticleStyles(registry).find(option => option.value === value)?.style;
}

export function keyParticleStyleValue(
    style: KeyParticleStyleId,
    registry: VfxRegistry = vfxRegistry,
): number | undefined {
    return registry.getKeyStyle(style)?.value;
}

/** Color capability is part of the style definition, not a UI-side style-name table. */
export function keyParticleColorMode(
    style: KeyParticleStyleId | number,
    registry: VfxRegistry = vfxRegistry,
): KeyParticleColorMode {
    const id = typeof style === "number" ? keyParticleStyleAt(style, registry) : style;
    if (!id || Object.hasOwn(SPECIAL_KEY_PARTICLE_STYLES, id)) return "special";
    return registry.getKeyStyle(id)?.color.mode ?? "special";
}

/**
 * Palettes shown for a style. `undefined` means the style has fixed natural colors
 * and the settings UI must hide the color option entirely.
 */
export function keyParticleColorOptions(
    style: KeyParticleStyleId | number,
    registry: VfxRegistry = vfxRegistry,
): readonly KeyParticlePalette[] | undefined {
    const id = typeof style === "number" ? keyParticleStyleAt(style, registry) : style;
    if (!id || Object.hasOwn(SPECIAL_KEY_PARTICLE_STYLES, id)) return undefined;
    const definition = registry.getKeyStyle(id);
    if (!definition) return undefined;
    const color = definition.color;
    if (color.mode === "free") return PIANO_PARTICLE_PALETTES;
    if (color.mode === "limited") return color.palettes;
    return undefined;
}

/** Keep a persisted palette valid when the selected style or palette table changes. */
export function normalizeKeyParticlePalette(
    style: number,
    palette: number,
    registry: VfxRegistry = vfxRegistry,
): number {
    const options = keyParticleColorOptions(style, registry);
    if (!options) return 0;
    return options.find(option => option.value === palette)?.value ?? options[0].value;
}

function colorsForStyle(definition: KeyParticleRenderStyle | undefined, palette: number): readonly string[] {
    if (!definition) return PIANO_PARTICLE_PALETTES[0].colors;
    const color = definition.color;
    if (color.mode === "fixed") return color.colors;
    const options = color.mode === "free" ? PIANO_PARTICLE_PALETTES : color.palettes;
    return (options.find(option => option.value === palette) ?? options[0]).colors;
}

/** 从 `key_style` 的独立 `variant` 字段直接解析弹奏粒子覆盖，不复用 brush/motion。 */
export function keyParticleOverrideFromParams(
    params: VfxEffectParams,
    registry: VfxRegistry = vfxRegistry,
): PianoParticleOverride | undefined {
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
    const style: KeyParticleStyleId = isKeyParticleStyleId(raw, registry) ? raw : "inherit";
    return { style, colors, glimmer: true, intensity, scale };
}

export function validateKeyParticleOverride(
    value: unknown,
    registry: VfxRegistry = vfxRegistry,
): PianoParticleOverride {
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
        if (!isKeyParticleStyleId(record.style, registry)) {
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
    style: KeyParticleRenderStyle,
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
    registry: VfxRegistry = vfxRegistry,
): ResolvedKeyParticle {
    if (registry.listPlugins().length === 0) {
        const colors = PIANO_PARTICLE_PALETTES[0].colors;
        return {
            color: hexToUnitRgb(colors[0]),
            glimmer: false,
            style: "none",
            colors,
            overridden: false,
            emitters: [],
        };
    }

    const playerStyles = listPianoParticleStyles(registry).filter(
        option => activeKeyStyle(option.style, registry) !== undefined,
    );
    const baseStyle = playerStyles.find(option => option.value === settings.particleStyle) ?? playerStyles[0];
    const baseStyleId: KeyParticleStyleId = baseStyle?.style ?? "none";

    const style: KeyParticleStyleId = override?.style && override.style !== "inherit" && isKeyParticleStyleId(override.style, registry)
        ? override.style
        : baseStyleId;
    const isSpecial = Object.hasOwn(SPECIAL_KEY_PARTICLE_STYLES, style);
    const definition = isSpecial ? undefined : activeKeyStyle(style, registry);
    const baseDefinition = activeKeyStyle(baseStyleId, registry);
    const paletteColors = isSpecial
        ? colorsForStyle(baseDefinition, settings.particlePalette)
        : colorsForStyle(definition, settings.particlePalette);
    // Explicit cue/theme colors are the documented creator override and win for every style.
    const colors: readonly string[] = override?.colors?.length ? override.colors : paletteColors;
    const glimmer = style === "none"
        ? (override?.glimmer ?? false)
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

    if (definition) {
        emitters.push({
            particle: definition.particle ?? RENDER_PARTICLE[definition.render],
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
