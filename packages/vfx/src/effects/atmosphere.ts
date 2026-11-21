import { blendHex, hexToUnitRgb } from "../color";
import { motionFactors, zoneBaseY, ZONE_Y_OFFSET } from "../geometry";
import { mix } from "../music";
import {
    drawCloud, drawComet, drawCurtain, drawDust, drawField, drawFountain, drawPoints, resolvePointBrush,
} from "../primitives";
import type { VfxEffectDefinition } from "../types";

export const ATMOSPHERE_EFFECTS = {
    starfield: {
        id: "starfield",
        label: "星尘雾海",
        category: "atmosphere",
        trigger: "continuous",
        interval: 20,
        priority: 1,
        defaultBrush: "mote",
        variants: ["cinema", "volume", "points"],
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, variant, zone, motion } = params;
            const m = motionFactors(motion);
            if (variant === "volume") {
                return {
                    priority: 1,
                    emitters: [drawField({
                        color,
                        opacity: 0.68 * intensity,
                        rate: 10,
                        seconds: 1.7,
                        range: 1.26 * m.spread,
                        size: 0.72,
                        density: 0.86,
                        speed: (0.62 + 0.28 * music.sustain) * m.speed,
                        height: ZONE_Y_OFFSET[zone],
                        scale,
                    })],
                };
            }
            const usePoints = variant === "points" || (
                variant !== "cinema" && (
                    (brush !== undefined && brush !== "mote" && brush !== "default")
                    || zone !== "stage"
                )
            );
            if (!usePoints) {
                return {
                    priority: 1,
                    emitters: [drawDust({
                        color,
                        opacity: 0.22 + intensity * 0.48,
                        count: 22,
                        life: 1.65,
                        phase: phase * 22 * m.dir,
                        release: (0.25 + 0.85 * music.surge) * m.energy,
                        radius: (2.25 + 0.55 * music.sustain) * Math.min(1.08, Math.max(0.85, scale)) * m.spread,
                        coherence: 0.25 + 0.70 * intensity,
                        bright: intensity,
                        scale,
                    })],
                };
            }
            const y = zoneBaseY(zone, 1.35, 0.25);
            return {
                priority: 1,
                emitters: [drawPoints({
                    count: 14,
                    life: 1.85,
                    lifeJitter: 0.28,
                    brush: resolvePointBrush(brush, "mote"),
                    color,
                    color2,
                    opacity: 0.26 + 0.54 * intensity,
                    scale,
                    offset: [0, y, 0],
                    size: 0.055 + 0.03 * intensity,
                    sizeEnd: 0.04,
                    sizeJitter: 0.45,
                    spread: [2.8 * m.spread, 0.95, 2.2 * m.spread],
                    velocity: [0, 0.07 * m.dir * m.speed, 0],
                    flutter: 0.14 * m.energy,
                    twinkle: 0.65,
                    fadeIn: 0.35,
                    fadeOut: 0.55,
                })],
            };
        },
    } satisfies VfxEffectDefinition,

    petal_fall: {
        id: "petal_fall",
        label: "落樱雪舞",
        category: "atmosphere",
        trigger: "continuous",
        interval: 16,
        priority: 2,
        defaultBrush: "petal",
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 2.75, 1.2);
            const fallSpeed = (-0.48 - 0.24 * music.activity) * m.speed * m.dir;
            const resolvedBrush = resolvePointBrush(brush, "petal");
            return {
                priority: 2,
                emitters: ([-1, 1] as const).map((side) => drawPoints({
                    count: 7,
                    life: 2.0,
                    lifeJitter: 0.24,
                    brush: resolvedBrush,
                    color,
                    color2,
                    opacity: 0.34 + 0.52 * intensity,
                    scale,
                    offset: [side * 1.95 * m.spread, y, 0.25],
                    size: 0.085 + 0.03 * intensity,
                    sizeEnd: 0.06,
                    sizeJitter: 0.28,
                    spin: side * 25,
                    spinJitter: 45,
                    spinRate: side * 85 * m.dir * m.speed,
                    spread: [1.35 * m.spread, 0.45, 1.95 * m.spread],
                    velocity: [side * 0.14 * m.energy, fallSpeed, 0.06],
                    flutter: 0.24 * m.energy,
                    fadeIn: 0.25,
                    fadeOut: 0.55,
                })),
            };
        },
    } satisfies VfxEffectDefinition,

    firefly_rise: {
        id: "firefly_rise",
        label: "流萤升腾",
        category: "atmosphere",
        trigger: "continuous",
        interval: 16,
        priority: 2,
        defaultBrush: "mote",
        variants: ["fireflies", "fountain"],
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, variant, zone, motion } = params;
            const m = motionFactors(motion);
            if (variant === "fountain") {
                const count = Math.round(8 * mix(0.4, 0.92, music.surge));
                return {
                    priority: 2,
                    emitters: drawFountain({
                        color,
                        opacity: 0.63 * intensity,
                        count,
                        speed: mix(0.64, 1.22, music.surge) * m.speed,
                        size: 0.8,
                        range: 1.18 * m.spread,
                        yOffset: ZONE_Y_OFFSET[zone],
                        zOffset: 2.61,
                        scale,
                    }),
                };
            }
            const y = zoneBaseY(zone, 0.35, 0.12);
            const riseVel = (0.36 + 0.34 * music.activity) * m.speed * m.dir;
            return {
                priority: 2,
                emitters: [drawPoints({
                    count: 14,
                    life: 1.85,
                    lifeJitter: 0.25,
                    brush: resolvePointBrush(brush, "mote"),
                    color,
                    color2,
                    opacity: 0.35 + 0.55 * intensity,
                    scale,
                    offset: [0, y, 0],
                    size: 0.062 + 0.025 * intensity,
                    sizeEnd: 0.032,
                    sizeJitter: 0.35,
                    spread: [2.45 * m.spread, 0.35, 1.75 * m.spread],
                    velocity: [0, riseVel, 0],
                    accel: [0, 0.08 * m.dir, 0],
                    flutter: 0.20 * m.energy,
                    twinkle: 0.85,
                    fadeIn: 0.22,
                    fadeOut: 0.58,
                })],
            };
        },
    } satisfies VfxEffectDefinition,

    aurora_veil: {
        id: "aurora_veil",
        label: "极光天幕",
        category: "atmosphere",
        trigger: "continuous",
        interval: 24,
        priority: 3,
        defaultBrush: "mote",
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, zone, motion } = params;
            const m = motionFactors(motion);
            const length = Math.min(2.4, (0.90 + 0.95 * music.sustain + 0.32 * music.surge) * m.energy);
            const previousLength = state.previousLength ?? length;
            state.previousLength = length;
            return {
                priority: 3,
                emitters: drawCurtain({
                    layout: "aurora",
                    color,
                    opacity: intensity,
                    length,
                    previousLength,
                    width: 0.26,
                    speed: (0.58 + 0.24 * music.activity) * m.speed,
                    range: 1.17 * m.spread,
                    yOffset: ZONE_Y_OFFSET[zone],
                    zOffset: 0.55,
                    scale,
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    wing_curtain: {
        id: "wing_curtain",
        label: "双翼光幕",
        category: "atmosphere",
        trigger: "continuous",
        interval: 18,
        priority: 3,
        defaultBrush: "mote",
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, zone, motion } = params;
            const m = motionFactors(motion);
            const length = Math.min(2.4, (0.78 + 1.08 * music.sustain + 0.38 * music.surge) * m.energy);
            const previousLength = state.previousLength ?? length;
            state.previousLength = length;
            return {
                priority: 3,
                emitters: drawCurtain({
                    layout: "wings",
                    color,
                    opacity: intensity,
                    length,
                    previousLength,
                    width: 0.25,
                    speed: (0.60 + 0.22 * music.activity) * m.speed,
                    range: 1.16 * m.spread,
                    yOffset: -0.14 + ZONE_Y_OFFSET[zone],
                    zOffset: 0.52,
                    scale,
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    dandelion_drift: {
        id: "dandelion_drift",
        label: "夏风白絮",
        category: "atmosphere",
        trigger: "continuous",
        interval: 18,
        priority: 2,
        defaultBrush: "blossom",
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const ascending = motion === "reverse";
            const y = zoneBaseY(zone, ascending ? 0.65 : 1.75, 0.22);
            const resolvedBrush = resolvePointBrush(brush, "blossom");
            const vx = ascending
                ? (0.14 + 0.08 * music.activity) * m.speed
                : (0.38 + 0.18 * music.activity) * m.speed;
            const vy = ascending
                ? (0.32 + 0.18 * music.sustain) * m.speed
                : (-0.09 - 0.05 * music.activity) * m.speed;
            const ay = ascending ? 0.05 : -0.015;
            return {
                priority: 2,
                emitters: [drawPoints({
                    count: 9,
                    life: 2.75,
                    lifeJitter: 0.26,
                    brush: resolvedBrush,
                    color,
                    color2,
                    opacity: 0.28 + 0.52 * intensity,
                    scale,
                    offset: [ascending ? 0 : -1.05 * m.spread, y, 0.28],
                    size: 0.072 + 0.028 * intensity,
                    sizeEnd: ascending ? 0.036 : 0.056,
                    sizeJitter: 0.34,
                    spin: 12,
                    spinJitter: 60,
                    spinRate: (ascending ? 28 : 44) * m.speed,
                    spread: [2.45 * m.spread, ascending ? 0.65 : 1.05, 1.95 * m.spread],
                    velocity: [vx, vy, -0.08],
                    accel: [0, ay, 0],
                    flutter: (ascending ? 0.15 : 0.21) * m.energy,
                    twinkle: ascending ? 0.55 : 0.22,
                    fadeIn: 0.32,
                    fadeOut: 0.55,
                })],
            };
        },
    } satisfies VfxEffectDefinition,

    meteor_shower: {
        id: "meteor_shower",
        label: "划空流星雨",
        category: "atmosphere",
        trigger: "continuous",
        interval: 12,
        priority: 3,
        defaultBrush: "star",
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 3.25, 1.95);
            const count = motion === "intense" ? 3 : motion === "gentle" ? 1 : 2;
            const resolvedBrush = resolvePointBrush(brush, "star");
            const dirX = m.dir;
            const tx = dirX * 0.86;
            const ty = -0.49;
            const tz = -0.14;
            const emitters = [];
            for (let i = 0; i < count; i++) {
                const seed = Math.abs(Math.sin((phase + 1) * 12.9898 + i * 78.233) * 43758.5453) % 1;
                const seed2 = Math.abs(Math.sin((phase + 3) * 39.346 + i * 19.19) * 24634.6345) % 1;
                const startX = -dirX * (0.6 + seed * 2.9) * m.spread + (seed2 - 0.5) * 1.4;
                const startY = yBase + (seed2 - 0.20) * 1.45;
                const startZ = 1.05 + seed * 2.35;
                const speed = (2.65 + 0.95 * seed2 + 0.45 * music.activity) * m.speed;
                const life = 0.95 + 0.35 * seed;
                const len = (1.85 + 0.95 * seed2 + 0.55 * intensity) * scale;
                const width = (0.30 + 0.14 * seed + 0.08 * intensity) * scale;
                const streakColor = i % 2 === 0 ? color : color2;
                const tailColor = i % 2 === 0 ? color2 : color;
                emitters.push(drawComet({
                    offset: [startX, startY, startZ],
                    life,
                    length: len * 0.72,
                    lengthEnd: len * 1.18,
                    width,
                    direction: [tx, ty, tz],
                    velocity: [tx * speed, ty * speed, tz * speed],
                    accel: [0, -0.16, 0],
                    color: streakColor,
                    color2: tailColor,
                    opacity: 0.58 + 0.42 * intensity,
                    scale,
                    fadeIn: 0.09,
                    fadeOut: 0.56,
                }));
                emitters.push(drawPoints({
                    count: 3,
                    life: life * 1.25,
                    lifeJitter: 0.22,
                    brush: resolvedBrush,
                    color: "#FFF4DC",
                    color2: tailColor,
                    opacity: 0.36 + 0.40 * intensity,
                    scale,
                    offset: [startX - tx * 0.25, startY - ty * 0.25, startZ],
                    size: 0.048 + 0.020 * intensity,
                    sizeEnd: 0.016,
                    sizeJitter: 0.35,
                    spread: [0.22, 0.14, 0.16],
                    velocity: [tx * speed * 0.38, ty * speed * 0.38, tz * speed * 0.38],
                    accel: [0, -0.24, 0],
                    flutter: 0.10,
                    twinkle: 0.88,
                    fadeIn: 0.12,
                    fadeOut: 0.62,
                }));
            }
            return { priority: 3, emitters };
        },
    } satisfies VfxEffectDefinition,

    twilight_mist: {
        id: "twilight_mist",
        label: "黄昏云海",
        category: "atmosphere",
        trigger: "continuous",
        interval: 26,
        priority: 2,
        defaultBrush: "mote",
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, zone, motion } = params;
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 1.85, 0.65);
            const driftX = (0.16 + 0.08 * music.activity) * m.speed * m.dir;
            const emitters = [];
            for (let i = 0; i < 3; i++) {
                const seed = Math.abs(Math.sin((phase + 2) * 17.13 + i * 43.7) * 19381.4) % 1;
                const xPos = (i - 1) * 2.55 * m.spread + (seed - 0.5) * 0.9;
                const yPos = yBase + (i === 1 ? 0.45 : -0.15) + (seed - 0.5) * 0.45;
                const zPos = 2.85 + (i % 2) * 0.75 + seed * 0.55;
                const baseSize = (1.15 + 0.45 * intensity + 0.20 * seed) * scale;
                emitters.push(drawCloud({
                    count: 2,
                    life: 3.8,
                    lifeJitter: 0.16,
                    color: i === 1 ? color2 : color,
                    color2: i === 1 ? color : color2,
                    opacity: 0.16 + 0.24 * intensity,
                    scale,
                    offset: [xPos, yPos, zPos],
                    size: baseSize,
                    sizeEnd: baseSize * 1.24,
                    sizeJitter: 0.22,
                    spin: (seed - 0.5) * 16,
                    spinJitter: 10,
                    spinRate: (i % 2 === 0 ? 1.8 : -1.8) * m.speed,
                    spread: [0.75, 0.28, 0.35],
                    velocity: [driftX, 0.03 * m.speed, 0],
                    fadeIn: 0.95,
                    fadeOut: 1.25,
                }));
            }
            return { priority: 2, emitters };
        },
    } satisfies VfxEffectDefinition,
};
