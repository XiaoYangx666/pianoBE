import {
    catmullRom, motionFactors, sampleArch, sampleStarPolygon, zoneBaseY, ZONE_Y_OFFSET,
} from "../geometry";
import {
    drawComet, drawGroundRing, drawPoints, drawPolygonFrame, drawShaft, drawStrokeSegments,
    resolvePointBrush, resolveStrokeBrush,
} from "../primitives";
import type { VfxEffectDefinition } from "../types";

export const STAGE_EFFECTS = {
    light_pillars: {
        id: "light_pillars",
        label: "霓虹灯柱阵",
        category: "stage",
        trigger: "continuous",
        interval: 16,
        priority: 4,
        defaultBrush: "mote",
        variants: ["neon", "neon_sides", "neon_rear", "backline", "rails"],
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, color2, intensity, scale, variant, zone, motion } = params;
            const m = motionFactors(motion);
            const yOffset = ZONE_Y_OFFSET[zone] * 0.6;
            if (variant === "backline" || variant === "rails" || variant === "neon_sides" || variant === "neon_rear") {
                const layout = variant === "neon_sides"
                    ? "neon-sides"
                    : variant === "neon_rear"
                        ? "neon-rear"
                        : variant;
                const length = variant === "backline"
                    ? Math.min(2.4, (1.38 + 0.97 * music.surge) * m.energy)
                    : variant === "neon_rear"
                        ? Math.min(2.4, (1.72 + 0.43 * music.density) * m.energy)
                        : Math.min(2.4, (1.42 + 0.54 * music.sustain) * m.energy);
                const previousLength = state.previousLength ?? length;
                state.previousLength = length;
                return {
                    priority: 4,
                    emitters: drawShaft({
                        layout,
                        color,
                        opacity: intensity,
                        length,
                        previousLength,
                        width: variant === "backline" ? 0.26 : variant === "neon_rear" ? 0.18 : 0.21,
                        range: 1.05 * m.spread,
                        yOffset,
                        zOffset: variant === "backline" ? 0.1 : 0,
                        scale,
                    }),
                };
            }
            const length = Math.min(2.4, (1.28 + 0.85 * music.sustain + 0.30 * music.activity) * m.energy);
            const prev = state.previousLength ?? length;
            state.previousLength = length;
            return {
                priority: 4,
                emitters: [
                    ...drawShaft({
                        layout: "neon-sides",
                        color,
                        opacity: intensity,
                        length,
                        previousLength: prev,
                        width: 0.21,
                        range: 1.05 * m.spread,
                        yOffset,
                        scale,
                    }),
                    ...drawShaft({
                        layout: "neon-rear",
                        color: color2,
                        opacity: intensity * 0.82,
                        length: Math.min(2.4, length * 1.12),
                        previousLength: prev * 1.12,
                        width: 0.18,
                        range: 1.08 * m.spread,
                        yOffset,
                        scale,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    crown_fan: {
        id: "crown_fan",
        label: "圣光扇束冠冕",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 5,
        defaultBrush: "mote",
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, zone, motion } = params;
            const m = motionFactors(motion);
            const length = Math.min(2.4, (1.10 + 1.15 * music.sustain + 0.24 * music.surge) * m.energy);
            const previousLength = state.previousLength ?? length;
            state.previousLength = length;
            return {
                priority: 5,
                emitters: drawShaft({
                    layout: "fan",
                    color,
                    opacity: intensity,
                    length,
                    previousLength,
                    width: 0.22,
                    range: 1.05 * m.spread,
                    yOffset: ZONE_Y_OFFSET[zone] * 0.7,
                    scale,
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    stage_truss: {
        id: "stage_truss",
        label: "舞台门架光框",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, zone, motion } = params;
            const m = motionFactors(motion);
            const length = Math.min(2.4, (1.20 + 0.90 * music.density + 0.30 * music.activity) * m.energy);
            const previousLength = state.previousLength ?? length;
            state.previousLength = length;
            return {
                priority: 4,
                emitters: drawShaft({
                    layout: "truss",
                    color,
                    opacity: intensity,
                    length,
                    previousLength,
                    width: 0.20,
                    range: 1.02 * m.spread,
                    yOffset: ZONE_Y_OFFSET[zone] * 0.5,
                    scale,
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    magic_circle: {
        id: "magic_circle",
        label: "星辰法阵",
        category: "stage",
        trigger: "continuous",
        interval: 22,
        priority: 4,
        defaultBrush: "star",
        defaultStroke: "laser",
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.45 : zone === "high" ? 1.25 : 0.08;
            const radius = (2.42 + 0.28 * music.sustain) * m.spread;
            const rot = phase * 3.5 * m.dir;
            const triA = sampleStarPolygon(radius * 0.95, 3, y, rot, 0.88);
            const triB = sampleStarPolygon(radius * 0.95, 3, y, rot + 60, 0.88);
            const strokeBrush = resolveStrokeBrush(brush, "laser");
            return {
                priority: 4,
                emitters: [
                    drawGroundRing({
                        life: 1.45,
                        color,
                        color2,
                        opacity: 0.34 + 0.48 * intensity,
                        scale,
                        offset: [0, y, 0],
                        radiusStart: radius,
                        radiusEnd: radius * (1.03 + 0.04 * music.activity),
                        curve: 1,
                        spin: rot,
                        spinRate: 28 * m.dir * m.speed,
                        style: 1,
                        fadeIn: 0.22,
                        fadeOut: 0.45,
                    }),
                    ...drawPolygonFrame(triA, {
                        life: 1.45,
                        brush: strokeBrush,
                        color,
                        color2,
                        opacity: 0.32 + 0.52 * intensity,
                        width: 0.095,
                        scale,
                        fadeIn: 0.20,
                        fadeOut: 0.40,
                    }),
                    ...drawPolygonFrame(triB, {
                        life: 1.45,
                        brush: strokeBrush,
                        color: color2,
                        color2: color,
                        opacity: 0.28 + 0.46 * intensity,
                        width: 0.085,
                        scale,
                        fadeIn: 0.20,
                        fadeOut: 0.40,
                    }),
                    drawPoints({
                        count: 6,
                        life: 1.45,
                        lifeJitter: 0.05,
                        brush: resolvePointBrush(brush, "star"),
                        color: color2,
                        color2: color,
                        opacity: 0.42 + 0.52 * intensity,
                        scale,
                        offset: [0, y + 0.06, 0],
                        size: 0.095 + 0.025 * intensity,
                        sizeEnd: 0.07,
                        phase: rot,
                        phaseSpread: 360,
                        omega: 28 * m.dir * m.speed,
                        radius: radius * 0.96,
                        radiusEnd: radius * 0.96,
                        depthRatio: 0.88,
                        twinkle: 0.55,
                        fadeIn: 0.18,
                        fadeOut: 0.38,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition,

    portal_arch: {
        id: "portal_arch",
        label: "时空光拱门",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        defaultStroke: "laser",
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 0.25, 0.12);
            const archWidth = (2.35 + 0.40 * music.sustain) * m.spread;
            const archHeight = (2.35 + 0.45 * intensity) * m.energy;
            const archPoints = sampleArch(archWidth, archHeight, 1.55, yBase, 24);
            return {
                priority: 4,
                emitters: [
                    ...drawStrokeSegments(archPoints, {
                        count: 12,
                        life: 1.35,
                        brush: resolveStrokeBrush(brush, "laser"),
                        color,
                        color2,
                        opacity: 0.38 + 0.54 * intensity,
                        width: 0.155 + 0.04 * intensity,
                        scale,
                        travel: 0.10 * m.dir * m.speed,
                        fadeIn: 0.18,
                        fadeOut: 0.38,
                    }),
                    drawPoints({
                        count: 6,
                        life: 1.45,
                        lifeJitter: 0.20,
                        brush: resolvePointBrush(brush, "star"),
                        color: color2,
                        color2: color,
                        opacity: 0.35 + 0.55 * intensity,
                        scale,
                        offset: [0, yBase + archHeight * 0.65, 1.55],
                        size: 0.068,
                        sizeEnd: 0.04,
                        spread: [archWidth * 0.85, archHeight * 0.35, 0.22],
                        velocity: [0, 0.22 * m.dir * m.speed, 0.08],
                        twinkle: 0.70,
                        fadeIn: 0.18,
                        fadeOut: 0.42,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition,

    horizon_glow: {
        id: "horizon_glow",
        label: "暮色天际光幕",
        category: "stage",
        trigger: "continuous",
        interval: 22,
        priority: 2,
        defaultBrush: "mote",
        defaultStroke: "silk",
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 0.78, 0.18);
            const span = (2.85 + 0.45 * music.sustain) * m.spread;
            const depth = 2.35 + 0.25 * m.spread;
            const lift = 0.28 + 0.22 * intensity + 0.14 * music.sustain;
            const arc = catmullRom([
                [-span, y - 0.10, depth - 0.32],
                [-span * 0.48, y + lift * 0.72, depth + 0.12],
                [0, y + lift, depth + 0.26],
                [span * 0.48, y + lift * 0.72, depth + 0.12],
                [span, y - 0.10, depth - 0.32],
            ], 6);
            return {
                priority: 2,
                emitters: [
                    ...drawStrokeSegments(arc, {
                        count: 10,
                        life: 2.05,
                        brush: resolveStrokeBrush(brush, "silk"),
                        color,
                        color2,
                        opacity: 0.15 + 0.32 * intensity,
                        width: 0.34 + 0.10 * intensity,
                        scale,
                        travel: 0.04 * m.speed * m.dir,
                        fadeIn: 0.42,
                        fadeOut: 0.58,
                    }),
                    drawPoints({
                        count: 6,
                        life: 2.35,
                        lifeJitter: 0.22,
                        brush: resolvePointBrush(brush, "mote"),
                        color: color2,
                        color2: color,
                        opacity: 0.14 + 0.26 * intensity,
                        scale,
                        offset: [0, y + lift * 0.45, depth + 0.18],
                        size: 0.11 + 0.04 * intensity,
                        sizeEnd: 0.08,
                        sizeJitter: 0.38,
                        spread: [span * 0.82, 0.38, 0.32],
                        velocity: [0, 0.04 * m.dir * m.speed, 0],
                        flutter: 0.07,
                        twinkle: 0.28,
                        fadeIn: 0.45,
                        fadeOut: 0.60,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition,

    starfall_impact: {
        id: "starfall_impact",
        label: "星落湖面",
        category: "stage",
        trigger: "continuous",
        interval: 14,
        priority: 4,
        defaultBrush: "star",
        emit({ params, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const m = motionFactors(motion);
            const yFloor = zone === "mid" ? 0.25 : 0.08;
            const resolvedBrush = resolvePointBrush(brush, "star");
            const seed = Math.abs(Math.sin((phase + 5) * 23.17) * 41293.7) % 1;
            const side = phase % 2 === 0 ? -1 : 1;
            const landX = side * (1.85 + seed * 1.35) * m.spread;
            const landZ = -0.25 + seed * 2.45;
            const dropH = 3.45;
            const dx = side * 0.85;
            const dy = -dropH;
            const dz = -0.35;
            const len = Math.hypot(dx, dy, dz) || 1;
            const fallLife = 0.58;
            const speed = len / fallLife;
            const impactColor = phase % 2 === 0 ? color : color2;
            const splashColor = phase % 2 === 0 ? color2 : color;
            return {
                priority: 4,
                emitters: [
                    drawComet({
                        offset: [landX - dx, yFloor + dropH, landZ - dz],
                        life: fallLife,
                        length: 1.45 * scale,
                        lengthEnd: 0.95 * scale,
                        width: 0.24 * scale,
                        direction: [dx / len, dy / len, dz / len],
                        velocity: [(dx / len) * speed, (dy / len) * speed, (dz / len) * speed],
                        accel: [0, -0.4, 0],
                        color: impactColor,
                        color2: "#FFFFFF",
                        opacity: 0.65 + 0.35 * intensity,
                        scale,
                        fadeIn: 0.06,
                        fadeOut: 0.16,
                    }),
                    drawGroundRing({
                        life: 1.35,
                        color: impactColor,
                        color2: splashColor,
                        opacity: 0.42 + 0.48 * intensity,
                        scale,
                        offset: [landX, yFloor, landZ],
                        radiusStart: 0.16,
                        radiusEnd: (1.35 + 0.45 * intensity) * m.spread,
                        curve: 0.62,
                        spinRate: side * 24,
                        style: 0,
                        fadeIn: 0.14,
                        fadeOut: 0.58,
                    }),
                    drawPoints({
                        count: 8,
                        life: 1.25,
                        lifeJitter: 0.20,
                        brush: resolvedBrush,
                        color: splashColor,
                        color2: "#FFF4DC",
                        opacity: 0.55 + 0.42 * intensity,
                        scale,
                        offset: [landX, yFloor + 0.12, landZ],
                        size: 0.078 + 0.025 * intensity,
                        sizeEnd: 0.024,
                        sizeJitter: 0.32,
                        spinJitter: 75,
                        spinRate: side * 110,
                        phaseSpread: 360,
                        radius: 0.06,
                        radiusEnd: 0.72 * m.spread,
                        curve: 0.68,
                        velocity: [0, (1.65 + 0.45 * intensity) * m.speed, 0],
                        accel: [0, -2.55, 0],
                        flutter: 0.08,
                        twinkle: 0.85,
                        fadeIn: 0.10,
                        fadeOut: 0.48,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition,
};
