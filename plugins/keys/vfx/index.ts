import {
    blendHex,
    colorVars,
    drawPoints,
    keyOriginFor,
    keyParticleOverrideFromParams,
    motionFactors,
    pickRecentKeys,
    pitchGradientHex,
    POINT_BRUSH_INDEX,
    resolvePointBrush,
    resolveStrokeBrush,
    vfxStageFrame,
    ZONE_Y_OFFSET,
    type KeyParticlePalette,
    type KeyParticleRenderStyle,
    type Point3,
    type VfxEffectDefinition,
    type VfxEmitter,
    type VfxPluginManifest,
    type VfxPluginModule,
} from "@piano/vfx";
import rawManifest from "../plugin.json";

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

const KEYS_PARTICLE_STYLES: Readonly<Record<string, KeyParticleRenderStyle>> = {
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
};

const KEY_STYLE_VARIANTS = [
    "inherit",
    ...Object.keys(KEYS_PARTICLE_STYLES),
    "glimmer",
    "none",
] as const;

const KEY_EFFECTS: readonly VfxEffectDefinition[] = [
    {
        id: "key_notes",
        label: "琴键飞音符",
        category: "keys",
        trigger: "note",
        interval: 1,
        priority: 5,
        defaultBrush: "note",
        emit({ params, music, recentNotes, lastNoteSequence, instrument, phase, solo }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteSequence, phase, solo, 2);
            const resolvedBrush = resolvePointBrush(brush, "note");
            const yShift = ZONE_Y_OFFSET[zone] * 0.4;
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, instrument);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const keyColor = pitchGradientHex(color, color2, note.midi);
                const driftX = (pitch - 0.5) * (1.25 + 0.45 * music.sustain) * m.spread;
                const riseVy = (1.10 + 0.72 * pitch) * m.speed * m.dir;
                emitters.push(drawPoints({
                    count: 2,
                    life: 0.52 + pitch * 0.14,
                    lifeJitter: 0.12,
                    brush: resolvedBrush,
                    color: keyColor,
                    color2,
                    opacity: intensity * note.velocity * 0.90,
                    transform: { x: origin[0], y: origin[1] + yShift, z: origin[2], scale },
                    size: 0.085 + 0.025 * note.velocity,
                    sizeEnd: 0.048,
                    sizeJitter: 0.22,
                    velocity: [driftX, riseVy, 0.72 + pitch * 0.95],
                    accel: [0, -0.85 * m.dir, 0],
                    flutter: 0.05,
                    fadeIn: 0.05,
                    fadeOut: 0.26,
                }));
            }
            return { priority: 5, emitters };
        },
    } satisfies VfxEffectDefinition,

    {
        id: "key_fountain",
        label: "琴键音泉喷涌",
        category: "keys",
        trigger: "note",
        interval: 2,
        priority: 4,
        defaultBrush: "spark",
        emit({ params, recentNotes, lastNoteSequence, instrument, phase, solo }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteSequence, phase, solo, 2);
            const resolvedBrush = resolvePointBrush(brush, "spark");
            const yShift = ZONE_Y_OFFSET[zone] * 0.4;
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, instrument);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const keyColor = pitchGradientHex(color, color2, note.midi);
                emitters.push(drawPoints({
                    count: 4,
                    life: 0.68,
                    lifeJitter: 0.18,
                    brush: resolvedBrush,
                    color: keyColor,
                    color2,
                    opacity: intensity * (0.45 + 0.55 * note.velocity),
                    transform: { x: origin[0], y: origin[1] + yShift, z: origin[2], scale },
                    size: 0.072,
                    sizeEnd: 0.032,
                    sizeJitter: 0.30,
                    spinJitter: 60,
                    spinRate: 120 * m.dir,
                    spread: [0.06, 0.04, 0.04],
                    velocity: [(pitch - 0.5) * 0.9 * m.spread, (1.85 + 0.55 * note.velocity) * m.speed, 0.55],
                    accel: [0, -4.6 * m.energy, 0.18],
                    flutter: resolvedBrush === POINT_BRUSH_INDEX.petal || resolvedBrush === POINT_BRUSH_INDEX.snow ? 0.14 : 0.04,
                    fadeIn: 0.05,
                    fadeOut: 0.30,
                }));
            }
            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition,

    {
        id: "key_constellation",
        label: "琴键星座连线",
        category: "keys",
        trigger: "note",
        interval: 4,
        priority: 4,
        defaultBrush: "star",
        defaultStroke: "laser",
        emit({ params, recentNotes, lastNoteSequence, instrument, phase, solo }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteSequence, phase, solo, 4);
            if (!targets.length) return { priority: 4, emitters: [] };
            const yShift = ZONE_Y_OFFSET[zone] * 0.5;
            const resolvedBrush = resolvePointBrush(brush, "star");
            const strokeBrush = resolveStrokeBrush(brush, "laser");
            const lifted: Point3[] = [];
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, instrument);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const pt: Point3 = [origin[0], origin[1] + 0.42 + pitch * 0.72 + yShift, origin[2] + 0.18];
                lifted.push(pt);
                emitters.push(drawPoints({
                    count: 1,
                    life: 0.85,
                    lifeJitter: 0,
                    brush: resolvedBrush,
                    color: pitchGradientHex(color, color2, note.midi),
                    color2,
                    opacity: intensity * (0.55 + 0.45 * note.velocity),
                    transform: { x: pt[0], y: pt[1], z: pt[2], scale },
                    size: 0.095,
                    sizeEnd: 0.048,
                    velocity: [0, 0.18 * m.dir * m.speed, 0.08],
                    twinkle: 0.75,
                    fadeIn: 0.06,
                    fadeOut: 0.36,
                }));
            }
            if (lifted.length >= 2) {
                const stageDepth = vfxStageFrame(instrument).depth;
                const edges = lifted.length - 1;
                for (let i = 0; i < edges; i++) {
                    const a = lifted[i];
                    const b = lifted[i + 1];
                    const dx = b[0] - a[0];
                    const dy = b[1] - a[1];
                    const dz = b[2] - a[2];
                    const dist = Math.hypot(dx, dy, dz) || 0.01;
                    const edgeColor = blendHex(color, color2, edges > 1 ? i / edges : 0);
                    emitters.push({
                        particle: "draw_stroke",
                        group: "beam",
                        offset: { x: 0, y: 0, z: 0 },
                        particles: 1,
                        lifetime: 0.85,
                        transform: {
                            x: (a[0] + b[0]) * 0.5,
                            y: (a[1] + b[1]) * 0.5,
                            z: (a[2] + b[2]) * 0.5,
                            scale: 1,
                        },
                        variables: {
                            count: 1,
                            life: 0.85,
                            brush: strokeBrush,
                            length: dist * 1.04,
                            length_end: dist * 1.04,
                            width: 0.065 * scale,
                            vx: 0,
                            vy: 0.18 * m.dir * m.speed * scale,
                            vz: 0.08 * scale,
                            ax: 0, ay: 0, az: 0,
                            tx: dx / dist,
                            ty: dy / dist,
                            tz: (dz / dist) / stageDepth,
                            ...colorVars(edgeColor, color2, intensity * 0.72),
                            fade_in: 0.06,
                            fade_out: 0.36,
                        },
                    });
                }
            }
            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition,

    {
        id: "key_style",
        label: "弹奏粒子样式",
        category: "control",
        trigger: "control",
        interval: 20,
        priority: 0,
        variants: KEY_STYLE_VARIANTS,
        resolveKeyParticle: keyParticleOverrideFromParams,
    } satisfies VfxEffectDefinition,
];

export const keysPlugin: VfxPluginModule = {
    manifest: rawManifest as VfxPluginManifest,
    register(api) {
        for (const [id, style] of Object.entries(KEYS_PARTICLE_STYLES)) {
            api.registerKeyStyle(id, style);
        }
        for (const effect of KEY_EFFECTS) {
            api.registerEffect(effect);
        }
    },
};

export default keysPlugin;
