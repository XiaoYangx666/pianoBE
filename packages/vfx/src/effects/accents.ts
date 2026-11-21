import { colorVars } from "../color";
import { catmullRom, motionFactors, zoneBaseY, ZONE_Y_OFFSET, type Point3 } from "../geometry";
import { mix } from "../music";
import { resolveSchemaParams } from "../parameters";
import {
    drawFountain, drawGroundRing, drawPoints, drawShards, drawShock, drawStrokeSegments,
    resolvePointBrush, resolveStrokeBrush,
} from "../primitives";
import type { VfxEffectDefinition, VfxEmitter, VfxParameterSchema } from "../types";

const FLOOR_SWEEP_PARAMS = {
    extent: { label: "扫光跨度", default: 2.15, min: 0.8, max: 4.0, step: 0.1 },
    width: { label: "光弧宽度", default: 0.16, min: 0.06, max: 0.4, step: 0.01 },
    speed: { label: "推进速度", default: 0.24, min: 0.05, max: 0.8, step: 0.02 },
} as const satisfies VfxParameterSchema;

const SHOCKWAVE_PARAMS = {
    radius: { label: "扩散半径", default: 2.85, min: 1.0, max: 5.0, step: 0.1 },
    spikeLength: { label: "放射芒长", default: 2.15, min: 0.5, max: 4.0, step: 0.1 },
    dualRing: { type: "boolean", label: "双层冲击环", default: true },
} as const satisfies VfxParameterSchema;

const PRISM_REWIND_PARAMS = {
    radius: { label: "回卷半径", default: 2.55, min: 0.8, max: 4.2, step: 0.1 },
    speed: { label: "回卷速度", default: 1.0, min: 0.4, max: 2.2, step: 0.1 },
} as const satisfies VfxParameterSchema;

const FIREWORK_BLOOM_PARAMS = {
    burstRadius: { label: "爆炸半径", default: 1.55, min: 0.6, max: 3.5, step: 0.1 },
    burstShape: { type: "enum", label: "爆炸形态", options: ["sphere", "ring"] as const, default: "sphere" },
    particleSize: { label: "火花大小", default: 0.095, min: 0.03, max: 0.2, step: 0.005 },
    fountain: { type: "boolean", label: "底部伴随喷泉", default: true },
} as const satisfies VfxParameterSchema;

const HANABI_LAUNCH_PARAMS = {
    apexHeight: { label: "升空高度", default: 2.75, min: 1.2, max: 4.8, step: 0.1 },
    spread: { label: "横向偏移", default: 1.12, min: 0.2, max: 2.5, step: 0.1 },
    trailWidth: { label: "尾迹宽度", default: 0.085, min: 0.03, max: 0.25, step: 0.005 },
} as const satisfies VfxParameterSchema;

const COMET_SPLIT_PARAMS = {
    length: { label: "彗尾长度", default: 3.1, min: 1.2, max: 5.5, step: 0.1 },
    speed: { label: "掠空速度", default: 1.65, min: 0.6, max: 3.2, step: 0.1 },
    split: { type: "boolean", label: "双生分裂", default: true },
} as const satisfies VfxParameterSchema;

export const ACCENT_EFFECTS = {
    floor_sweep: {
        id: "floor_sweep",
        label: "地面扫光弧",
        category: "accent",
        trigger: "instant",
        interval: 0,
        priority: 8,
        defaultBrush: "spark",
        defaultStroke: "comet",
        parameters: FLOOR_SWEEP_PARAMS,
        emit({ params, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(FLOOR_SWEEP_PARAMS, params.custom);
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.38 : zone === "high" ? 1.15 : 0.07;
            const extent = (c.extent + 0.55 * Math.max(0, intensity - 0.5)) * m.spread;
            const raw: Point3[] = [
                [-extent, y, -0.45 - 0.08 * (phase % 3)],
                [-extent * 0.42, y - 0.02, extent * 0.52],
                [extent * 0.42, y - 0.02, extent * 0.52],
                [extent, y, -0.45 - 0.08 * (phase % 3)],
            ];
            const points = m.dir < 0 ? [...raw].reverse() : raw;
            return {
                priority: 8,
                emitters: drawStrokeSegments(points, {
                    count: 16,
                    life: 1.45,
                    brush: resolveStrokeBrush(brush, "comet"),
                    color,
                    color2,
                    opacity: 0.45 + 0.50 * intensity,
                    width: c.width,
                    scale,
                    travel: c.speed * m.speed,
                    fadeIn: 0.12,
                    fadeOut: 0.34,
                }),
            };
        },
    } satisfies VfxEffectDefinition,

    shockwave: {
        id: "shockwave",
        label: "重拍冲击波",
        category: "accent",
        trigger: "instant",
        interval: 0,
        priority: 8,
        defaultBrush: "ring",
        defaultStroke: "comet",
        parameters: SHOCKWAVE_PARAMS,
        yields: { tag: "ribbon", ticks: 12 },
        emit({ params, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(SHOCKWAVE_PARAMS, params.custom);
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.42 : zone === "high" ? 1.25 : 0.08;
            const spikeRadius = (c.spikeLength + 0.55 * intensity) * m.spread;
            const strokeBrush = resolveStrokeBrush(brush, "comet");
            const spikes: VfxEmitter[] = Array.from({ length: 8 }, (_, i) => {
                const a = (((i / 8) * 360 + phase * 11) * Math.PI) / 180;
                const cos = Math.cos(a);
                const sin = Math.sin(a);
                return {
                    particle: "draw_stroke",
                    group: "beam",
                    offset: { x: cos * 0.85, y: y + 0.04, z: sin * 0.85 },
                    particles: 1,
                    lifetime: 0.85,
                    transform: { scale },
                    variables: {
                        count: 1,
                        life: 0.85,
                        brush: strokeBrush,
                        length: 0.58,
                        length_end: 0.95,
                        width: 0.11,
                        vx: cos * spikeRadius * 0.85 * m.speed,
                        vy: 0.08,
                        vz: sin * spikeRadius * 0.85 * m.speed,
                        ax: 0, ay: 0, az: 0,
                        tx: cos, ty: 0.05, tz: sin,
                        ...colorVars(color, color2, 0.48 + 0.48 * intensity),
                        fade_in: 0.06,
                        fade_out: 0.32,
                    },
                };
            });
            const emitters: VfxEmitter[] = [
                drawGroundRing({
                    life: 1.15,
                    color,
                    color2,
                    opacity: 0.45 + 0.48 * intensity,
                    scale,
                    offset: [0, y, 0],
                    radiusStart: 0.55,
                    radiusEnd: (c.radius + 0.65 * intensity) * m.spread,
                    curve: 0.65,
                    spinRate: 24 * m.dir,
                    style: 0,
                    fadeIn: 0.08,
                    fadeOut: 0.52,
                }),
                ...(c.dualRing ? [drawGroundRing({
                    life: 1.28,
                    color: color2,
                    color2: color,
                    opacity: 0.34 + 0.42 * intensity,
                    scale,
                    offset: [0, y + 0.05, 0],
                    radiusStart: 0.70,
                    radiusEnd: (c.radius + 0.55 + 0.65 * intensity) * m.spread,
                    curve: 0.72,
                    spinRate: -18 * m.dir,
                    style: 1,
                    fadeIn: 0.12,
                    fadeOut: 0.58,
                })] : []),
                drawShock({
                    color,
                    opacity: intensity,
                    count: intensity < 0.85 ? 14 : 16,
                    life: 1.15,
                    strength: intensity,
                    phase: (phase * 37) % 360,
                    y,
                    scale,
                }),
                ...spikes,
            ];
            if (brush && brush !== "default" && brush !== "ring") {
                emitters.push(drawPoints({
                    count: 10,
                    life: 1.05,
                    lifeJitter: 0.15,
                    brush: resolvePointBrush(brush, "ring"),
                    color: color2,
                    color2: color,
                    opacity: 0.48 + 0.46 * intensity,
                    scale,
                    offset: [0, y + 0.15, 0],
                    size: 0.11,
                    sizeEnd: 0.05,
                    radius: 0.65,
                    radiusEnd: (c.radius + 0.05 + 0.5 * intensity) * m.spread,
                    curve: 0.65,
                    omega: 35 * m.dir,
                    depthRatio: 0.90,
                    fadeIn: 0.08,
                    fadeOut: 0.45,
                }));
            }
            return { priority: 8, emitters };
        },
    } satisfies VfxEffectDefinition,

    prism_rewind: {
        id: "prism_rewind",
        label: "棱晶时空回卷",
        category: "accent",
        trigger: "instant",
        interval: 0,
        priority: 7,
        defaultBrush: "shard",
        parameters: PRISM_REWIND_PARAMS,
        emit({ params }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(PRISM_REWIND_PARAMS, params.custom);
            const m = motionFactors(motion);
            const reverse = motion === "reverse";
            const flow = reverse ? 1 : -1;
            const yShift = ZONE_Y_OFFSET[zone] * 0.7;
            const resolvedBrush = resolvePointBrush(brush, "shard");
            const radiusScale = c.radius / 2.55;
            const innerR = reverse ? 0.85 : c.radius * m.spread;
            const outerR = reverse ? (c.radius + 0.1) * m.spread : 0.75;
            return {
                priority: 7,
                emitters: [
                    ...drawShards({
                        color,
                        opacity: intensity,
                        count: Math.round(5 * 0.80),
                        speed: (reverse ? 1.14 : 0.90) * c.speed * m.speed,
                        flow,
                        range: (reverse ? 1.24 : 1.18) * radiusScale * m.spread,
                        size: reverse ? 1.16 : 0.96,
                        yOffset: yShift,
                        scale,
                    }),
                    drawPoints({
                        count: 10,
                        life: 1.65,
                        lifeJitter: 0.16,
                        brush: resolvedBrush,
                        color: color2,
                        color2: color,
                        opacity: 0.42 + 0.48 * intensity,
                        scale,
                        offset: [0, Math.max(0.45, 1.35 + yShift), 0],
                        size: 0.105,
                        sizeEnd: reverse ? 0.06 : 0.045,
                        spinJitter: 45,
                        spinRate: (reverse ? 90 : -90) * c.speed * m.speed,
                        phaseSpread: 360,
                        omega: (reverse ? 52 : -58) * c.speed * m.speed,
                        radius: innerR,
                        radiusEnd: outerR,
                        curve: 0.78,
                        radialJitter: 0.25,
                        depthRatio: 0.90,
                        tilt: 0.45,
                        fadeIn: 0.15,
                        fadeOut: 0.48,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition,

    firework_bloom: {
        id: "firework_bloom",
        label: "高空烟花盛放",
        category: "accent",
        trigger: "instant",
        interval: 0,
        priority: 8,
        defaultBrush: "spark",
        parameters: FIREWORK_BLOOM_PARAMS,
        yields: { tag: "ribbon", ticks: 12 },
        emit({ params }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(FIREWORK_BLOOM_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 2.55, 1.45);
            const resolvedBrush = resolvePointBrush(brush, "spark");
            const isRing = c.burstShape === "ring";
            const centers: Point3[] = intensity >= 0.75
                ? [[-1.65, yBase, 1.80], [1.65, yBase + 0.18, 1.80], [0, yBase + 0.62, 2.20]]
                : [[-1.55, yBase, 1.75], [1.55, yBase + 0.16, 1.75]];
            const emitters: VfxEmitter[] = centers.map(([cx, cy, cz], index) => drawPoints({
                count: 11,
                life: 1.32,
                lifeJitter: 0.16,
                brush: resolvedBrush,
                color: index % 2 === 0 ? color : color2,
                color2: index % 2 === 0 ? color2 : color,
                opacity: 0.55 + 0.42 * intensity,
                scale,
                offset: [cx * m.spread, cy, cz],
                size: c.particleSize + 0.025 * intensity,
                sizeEnd: (c.particleSize / 0.095) * 0.032,
                sizeJitter: 0.25,
                spinJitter: 90,
                spinRate: 110 * m.dir,
                phase: index * 47,
                phaseSpread: 360,
                omega: 26 * m.dir,
                radius: 0.08,
                radiusEnd: (c.burstRadius + 0.35 * intensity) * m.spread,
                curve: 0.52,
                radialJitter: isRing ? 0.08 : 0.22,
                depthRatio: isRing ? 0.32 : 0.95,
                tilt: (isRing ? 0.16 : 0.58) * (index % 2 === 0 ? 1 : -1),
                velocity: [0, 0.78 * m.speed, 0],
                accel: [0, -2.35 * m.energy, 0],
                twinkle: 0.58,
                fadeIn: 0.06,
                fadeOut: 0.45,
            }));
            if (c.fountain && intensity >= 0.75) {
                emitters.push(...drawFountain({
                    color,
                    opacity: 0.62 * intensity,
                    count: 6,
                    speed: 1.12 * m.speed,
                    size: 0.95,
                    yOffset: ZONE_Y_OFFSET[zone] * 0.4,
                    scale,
                }));
            }
            return { priority: 8, emitters };
        },
    } satisfies VfxEffectDefinition,

    hanabi_launch: {
        id: "hanabi_launch",
        label: "龙势升空",
        category: "accent",
        trigger: "instant",
        interval: 0,
        priority: 7,
        defaultBrush: "spark",
        defaultStroke: "comet",
        parameters: HANABI_LAUNCH_PARAMS,
        emit({ params }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(HANABI_LAUNCH_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 0.35, 0.15);
            const apex = yBase + (c.apexHeight + 0.75 * intensity) * m.spread;
            const side = motion === "intense" ? 0 : m.dir < 0 ? 1 : -1;
            const xStart = side * c.spread * m.spread;
            const xPeak = side * (c.spread / 1.12) * 1.48 * m.spread;
            const zLaunch = motion === "intense" ? 2.15 : 1.85;
            const path = catmullRom([
                [xStart, yBase, zLaunch],
                [mix(xStart, xPeak, 0.35), mix(yBase, apex, 0.38), zLaunch + 0.08],
                [mix(xStart, xPeak, 0.78), mix(yBase, apex, 0.76), zLaunch + 0.14],
                [xPeak, apex, zLaunch + 0.18],
            ], 8);
            const resolvedBrush = resolvePointBrush(brush, "spark");
            const strokeBrush = resolveStrokeBrush(brush, "comet");
            const trail = drawStrokeSegments(path, {
                count: 9,
                life: 1.05,
                brush: strokeBrush,
                color,
                color2,
                opacity: 0.45 + 0.48 * intensity,
                width: c.trailWidth + 0.03 * intensity,
                scale,
                travel: 0.52 * m.speed,
                fadeIn: 0.06,
                fadeOut: 0.42,
            });
            const embers = drawPoints({
                count: 7,
                life: 1.15,
                lifeJitter: 0.18,
                brush: resolvedBrush,
                color: color2,
                color2: color,
                opacity: 0.55 + 0.40 * intensity,
                scale,
                offset: [xStart, yBase + 0.25, zLaunch],
                size: 0.068 + 0.02 * intensity,
                sizeEnd: 0.024,
                sizeJitter: 0.3,
                spread: [0.16, 0.14, 0.16],
                velocity: [(xPeak - xStart) * 0.85, (apex - yBase) * 0.92 * m.speed, 0.12],
                accel: [0, -0.55, 0],
                flutter: 0.09,
                twinkle: 0.75,
                fadeIn: 0.04,
                fadeOut: 0.36,
            });
            return { priority: 7, emitters: [...trail, embers] };
        },
    } satisfies VfxEffectDefinition,

    comet_split: {
        id: "comet_split",
        label: "彗星分裂",
        category: "accent",
        trigger: "instant",
        interval: 0,
        priority: 8,
        defaultBrush: "star",
        parameters: COMET_SPLIT_PARAMS,
        emit({ params }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(COMET_SPLIT_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yTop = zoneBaseY(zone, 3.85, 2.35);
            const zBase = 2.65;
            const resolvedBrush = resolvePointBrush(brush, "star");
            const dir = m.dir;
            const lengthScale = c.length / 3.1;
            const speedScale = c.speed / 1.65;
            if (motion === "gentle") {
                const tx = dir * 0.92;
                const ty = -0.36;
                const tz = -0.14;
                const speed = 1.05 * speedScale * m.speed;
                return {
                    priority: 8,
                    emitters: [
                        {
                            particle: "draw_comet",
                            group: "beam",
                            offset: { x: -dir * 2.1, y: yTop + 0.35, z: zBase + 0.35 },
                            particles: 1,
                            lifetime: 3.6,
                            transform: { x: 0, y: 0, z: 0, scale },
                            variables: {
                                count: 1,
                                life: 3.6,
                                length: 3.2 * lengthScale * scale,
                                length_end: 3.9 * lengthScale * scale,
                                width: 0.62 * scale,
                                vx: tx * speed,
                                vy: ty * speed,
                                vz: tz * speed,
                                ax: 0, ay: 0, az: 0,
                                tx, ty, tz,
                                ...colorVars(color, color2, 0.52 + 0.42 * intensity),
                                fade_in: 0.45,
                                fade_out: 0.85,
                            },
                        },
                        drawPoints({
                            count: 8,
                            life: 3.0,
                            lifeJitter: 0.25,
                            brush: resolvedBrush,
                            color: color2,
                            color2: color,
                            opacity: 0.34 + 0.36 * intensity,
                            scale,
                            offset: [-dir * 1.8, yTop + 0.25, zBase + 0.30],
                            size: 0.058,
                            sizeEnd: 0.022,
                            sizeJitter: 0.35,
                            spread: [0.65, 0.25, 0.25],
                            velocity: [tx * speed * 0.72, ty * speed * 0.72, tz * speed * 0.72],
                            flutter: 0.08,
                            twinkle: 0.85,
                            fadeIn: 0.35,
                            fadeOut: 0.75,
                        }),
                    ],
                };
            }
            const mainTx = -dir * 0.88;
            const mainTy = -0.44;
            const mainTz = -0.16;
            const splitTx = dir * 0.72;
            const splitTy = -0.66;
            const splitTz = -0.20;
            const mainSpeed = c.speed * m.speed;
            const splitSpeed = 2.05 * speedScale * m.speed;
            const emitters: VfxEmitter[] = [
                {
                    particle: "draw_comet",
                    group: "beam",
                    offset: { x: -dir * 0.25, y: yTop, z: zBase },
                    particles: 1,
                    lifetime: 2.35,
                    transform: { x: 0, y: 0, z: 0, scale },
                    variables: {
                        count: 1,
                        life: 2.35,
                        length: c.length * scale,
                        length_end: 4.2 * lengthScale * scale,
                        width: 0.68 * scale,
                        vx: mainTx * mainSpeed,
                        vy: mainTy * mainSpeed,
                        vz: mainTz * mainSpeed,
                        ax: 0, ay: -0.12, az: 0,
                        tx: mainTx, ty: mainTy, tz: mainTz,
                        ...colorVars(color, "#FFFFFF", 0.65 + 0.35 * intensity),
                        fade_in: 0.12,
                        fade_out: 0.75,
                    },
                },
            ];
            if (c.split) {
                emitters.push({
                    particle: "draw_comet",
                    group: "beam",
                    offset: { x: dir * 0.25, y: yTop - 0.08, z: zBase - 0.06 },
                    particles: 1,
                    lifetime: 2.15,
                    transform: { x: 0, y: 0, z: 0, scale },
                    variables: {
                        count: 1,
                        life: 2.15,
                        length: 2.6 * lengthScale * scale,
                        length_end: 3.6 * lengthScale * scale,
                        width: 0.58 * scale,
                        vx: splitTx * splitSpeed,
                        vy: splitTy * splitSpeed,
                        vz: splitTz * splitSpeed,
                        ax: 0, ay: -0.26, az: 0,
                        tx: splitTx, ty: splitTy, tz: splitTz,
                        ...colorVars(color2, "#FFF4DC", 0.65 + 0.35 * intensity),
                        fade_in: 0.14,
                        fade_out: 0.72,
                    },
                });
            }
            emitters.push(
                drawPoints({
                    count: 10,
                    life: 1.55,
                    lifeJitter: 0.18,
                    brush: resolvedBrush,
                    color: "#FFF4DC",
                    color2: color,
                    opacity: 0.76 + 0.24 * intensity,
                    scale,
                    offset: [0, yTop, zBase],
                    size: 0.13 + 0.04 * intensity,
                    sizeEnd: 0.032,
                    sizeJitter: 0.26,
                    spinJitter: 90,
                    spinRate: 130 * dir,
                    phaseSpread: 360,
                    radius: 0.08,
                    radiusEnd: (1.35 + 0.35 * intensity) * m.spread,
                    curve: 0.52,
                    radialJitter: 0.20,
                    depthRatio: 0.85,
                    twinkle: 0.88,
                    fadeIn: 0.05,
                    fadeOut: 0.52,
                }),
                drawPoints({
                    count: 9,
                    life: 2.1,
                    lifeJitter: 0.22,
                    brush: resolvedBrush,
                    color,
                    color2: color2,
                    opacity: 0.52 + 0.42 * intensity,
                    scale,
                    offset: [0, yTop - 0.12, zBase - 0.08],
                    size: 0.072 + 0.025 * intensity,
                    sizeEnd: 0.022,
                    sizeJitter: 0.34,
                    spread: [0.65, 0.28, 0.28],
                    velocity: [
                        (c.split ? splitTx * splitSpeed : mainTx * mainSpeed) * 0.62,
                        (c.split ? splitTy * splitSpeed : mainTy * mainSpeed) * 0.62,
                        (c.split ? splitTz * splitSpeed : mainTz * mainSpeed) * 0.62,
                    ],
                    accel: [0, -0.32, 0],
                    flutter: 0.14,
                    twinkle: 0.85,
                    fadeIn: 0.08,
                    fadeOut: 0.60,
                }),
            );
            return { priority: 8, emitters };
        },
    } satisfies VfxEffectDefinition,
};
