import {
    resolvePerformanceColor,
    type PerformanceBrush, type PerformanceMethod, type PerformanceMotion, type PerformanceZone,
} from "@piano/core";
import type { InstrumentDefinition } from "../instrument/definition";
import {
    blendHex, catmullRom, cinemaEmitter, colorVars, deriveAccentHex, drawGroundRing, drawPoints,
    drawPolygonFrame, drawStrokeSegments, hexToUnitRgb, keyOriginFor, motionFactors, pitchGradientHex,
    resolveBrush, resolveStrokeBrush, sampleArch, sampleLissajous, sampleStarPolygon, sampleWingPair,
    ZONE_Y_OFFSET, type Point3,
} from "./vfxDraw";
import { effectEmitters, type VfxEffect, type VfxEmitter, type VfxOptions } from "./vfxLab";
import { clampUnit, mix, quietFeatures, type MusicFeatures, type VfxKeyNote } from "./vfxMusic";
import type { VfxBatch } from "./vfxPreset";
import type { PianoParticleOverride } from "./particleOverride";
import { vfxStageFrame } from "./vfxStage";

export type PainterCategory = "atmosphere" | "curve" | "stage" | "keys" | "accent";

export interface PainterContext {
    color: string;
    color2: string;
    intensity: number;
    scale: number;
    brush?: PerformanceBrush;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    music: Readonly<MusicFeatures>;
    recentNotes?: readonly VfxKeyNote[];
    lastNoteTick?: number;
    definition?: InstrumentDefinition;
    previousLength?: number;
    previousAmplitude?: number;
    phase?: number;
    solo?: boolean;
}

export interface PainterResult {
    emitters: VfxEmitter[];
    priority: number;
    nextLength?: number;
    nextAmplitude?: number;
}

export interface PainterDefinition {
    label: string;
    category: PainterCategory;
    instant: boolean;
    interval: number;
    priority: number;
    defaultBrush: Exclude<PerformanceBrush, "default">;
    emit(context: PainterContext): PainterResult;
}

function withEffectColor(effect: VfxEffect, color: string, options: VfxOptions): VfxOptions {
    return { ...options, [`${effect}Color`]: color };
}

function zoneBaseY(zone: PerformanceZone | undefined, base: number, floorMin = 0.06): number {
    const raw = base + ZONE_Y_OFFSET[zone ?? "stage"];
    return Math.max(floorMin, raw);
}

function pickRecentKeys(
    recentNotes: readonly VfxKeyNote[] | undefined,
    lastNoteTick: number,
    phase: number,
    solo: boolean,
    maxCount: number,
): VfxKeyNote[] {
    const fresh = (recentNotes ?? []).filter((note) => note.tick > lastNoteTick).sort((a, b) => a.midi - b.midi);
    let candidates: VfxKeyNote[];
    if (fresh.length) {
        if (maxCount <= 2) {
            candidates = fresh.length === 1 ? [fresh[0]] : [fresh[0], fresh[fresh.length - 1]];
        } else {
            candidates = fresh.slice(-maxCount);
        }
    } else if (solo) {
        const base = 44 + Math.round(phase % 20);
        candidates = maxCount <= 2
            ? [
                { midi: base, velocity: 0.78, duration: 0.8, tick: 0 },
                { midi: base + 20, velocity: 0.88, duration: 0.9, tick: 0 },
            ]
            : [
                { midi: base, velocity: 0.75, duration: 0.8, tick: 0 },
                { midi: base + 7, velocity: 0.82, duration: 0.8, tick: 0 },
                { midi: base + 12, velocity: 0.86, duration: 0.9, tick: 0 },
                { midi: base + 19, velocity: 0.92, duration: 0.9, tick: 0 },
            ];
    } else {
        return [];
    }
    const seen = new Set<number>();
    const result: VfxKeyNote[] = [];
    for (const note of candidates) {
        if (seen.has(note.midi)) continue;
        seen.add(note.midi);
        result.push(note);
        if (result.length >= maxCount) break;
    }
    return result.sort((a, b) => a.midi - b.midi);
}

export const VFX_PAINTERS: Readonly<Record<PerformanceMethod, PainterDefinition>> = {
    starfield: {
        label: "星尘雾海",
        category: "atmosphere",
        instant: false,
        interval: 20,
        priority: 1,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const useDefaultCinema = (!brush || brush === "default") && (!zone || zone === "stage");
            if (useDefaultCinema) {
                const rgb = hexToUnitRgb(color);
                return {
                    priority: 1,
                    emitters: [cinemaEmitter("cinema_dust", 22, 1.65, {
                        ...rgb,
                        opacity: 0.22 + intensity * 0.48,
                        phase: phase * 22 * m.dir,
                        release: (0.25 + 0.85 * music.surge) * m.energy,
                        radius: (2.25 + 0.55 * music.sustain) * Math.min(1.08, Math.max(0.85, scale)) * m.spread,
                        coherence: 0.25 + 0.70 * intensity,
                        bright: intensity,
                    }, { scale })],
                };
            }
            const y = zoneBaseY(zone, 1.35, 0.25);
            return {
                priority: 1,
                emitters: [drawPoints({
                    count: 14,
                    life: 1.85,
                    lifeJitter: 0.28,
                    brush: resolveBrush(brush, 0),
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
    },

    petal_fall: {
        label: "落樱雪舞",
        category: "atmosphere",
        instant: false,
        interval: 16,
        priority: 2,
        defaultBrush: "petal",
        emit({ color, color2, intensity, scale, brush, zone, motion, music }) {
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 2.75, 1.2);
            const fallSpeed = (-0.48 - 0.24 * music.activity) * m.speed * m.dir;
            const resolvedBrush = resolveBrush(brush, 2);
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
    },

    firefly_rise: {
        label: "流萤升腾",
        category: "atmosphere",
        instant: false,
        interval: 16,
        priority: 2,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, brush, zone, motion, music }) {
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 0.35, 0.12);
            const riseVel = (0.36 + 0.34 * music.activity) * m.speed * m.dir;
            return {
                priority: 2,
                emitters: [drawPoints({
                    count: 14,
                    life: 1.85,
                    lifeJitter: 0.25,
                    brush: resolveBrush(brush, 0),
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
    },

    aurora_veil: {
        label: "极光天幕",
        category: "atmosphere",
        instant: false,
        interval: 24,
        priority: 3,
        defaultBrush: "mote",
        emit({ color, intensity, scale, zone, motion, music, previousLength }) {
            const m = motionFactors(motion);
            const length = (0.90 + 0.95 * music.sustain + 0.32 * music.surge) * m.energy;
            const opts = withEffectColor("curtain", color, {
                intensity,
                scale,
                z: 0.55,
                y: ZONE_Y_OFFSET[zone ?? "stage"],
                range: 1.17 * m.spread,
                width: 0.26,
                speed: (0.58 + 0.24 * music.activity) * m.speed,
                length: Math.min(2.4, length),
            });
            return {
                priority: 3,
                nextLength: opts.length,
                emitters: effectEmitters("curtain", opts, {
                    music,
                    previous: { ...opts, length: previousLength ?? opts.length },
                    layout: "aurora",
                }),
            };
        },
    },

    wing_curtain: {
        label: "双翼光幕",
        category: "atmosphere",
        instant: false,
        interval: 18,
        priority: 3,
        defaultBrush: "mote",
        emit({ color, intensity, scale, zone, motion, music, previousLength }) {
            const m = motionFactors(motion);
            const length = (0.78 + 1.08 * music.sustain + 0.38 * music.surge) * m.energy;
            const opts = withEffectColor("curtain", color, {
                intensity,
                scale,
                z: 0.52,
                y: -0.14 + ZONE_Y_OFFSET[zone ?? "stage"],
                range: 1.16 * m.spread,
                width: 0.25,
                speed: (0.60 + 0.22 * music.activity) * m.speed,
                length: Math.min(2.4, length),
            });
            return {
                priority: 3,
                nextLength: opts.length,
                emitters: effectEmitters("curtain", opts, {
                    music,
                    previous: { ...opts, length: previousLength ?? opts.length },
                    layout: "wings",
                }),
            };
        },
    },

    wing_ribbons: {
        label: "双翼流光丝带",
        category: "curve",
        instant: false,
        interval: 22,
        priority: 4,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, brush, zone, motion, music }) {
            const m = motionFactors(motion);
            const spread = (0.72 + 0.58 * Math.max(music.surge, intensity * 0.85)) * m.spread;
            const radius = (0.88 + 0.30 * (2.25 + 0.90 * intensity) * (0.85 + 0.15 * music.sustain)) * Math.max(0.85, Math.min(1.15, scale));
            const height = 0.42 + 1.18 * intensity + 0.28 * music.pitch;
            const yShift = ZONE_Y_OFFSET[zone ?? "stage"] * 0.65;
            const strokeBrush = resolveStrokeBrush(brush, 0);
            const makeWing = (side: 1 | -1, cA: string, cB: string, life: number, gain: number) => {
                const raw = sampleWingPair(side, radius, height, spread, yShift);
                const points = m.dir < 0 ? [...raw].reverse() : raw;
                return drawStrokeSegments(points, {
                    count: 16,
                    life,
                    brush: strokeBrush,
                    color: cA,
                    color2: cB,
                    opacity: Math.min(1, intensity * gain),
                    width: 0.145 + 0.04 * intensity,
                    scale,
                    travel: 0.18 * m.speed,
                    fadeIn: 0.14,
                    fadeOut: 0.32,
                });
            };
            const left = makeWing(-1, color, color2, 1.32, 0.78);
            const right = makeWing(1, color2, color, 1.42, 0.95);
            return {
                priority: 4,
                emitters: left.flatMap((emitter, index) => [emitter, right[index]]),
            };
        },
    },

    double_helix: {
        label: "双螺旋星轨",
        category: "curve",
        instant: false,
        interval: 18,
        priority: 3,
        defaultBrush: "star",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const baseY = zoneBaseY(zone, m.dir > 0 ? 0.30 : 2.35, 0.20);
            const resolvedBrush = resolveBrush(brush, 1);
            const radius = (2.20 + 0.35 * music.sustain) * m.spread;
            const rise = (1.95 + 0.65 * music.activity) * m.dir;
            const omega = (135 + 65 * music.activity) * m.dir * m.speed;
            return {
                priority: 3,
                emitters: [0, 180].map((offsetDeg, index) => drawPoints({
                    count: 7,
                    life: 1.75,
                    lifeJitter: 0.12,
                    brush: resolvedBrush,
                    color: index === 0 ? color : color2,
                    color2: index === 0 ? color2 : color,
                    opacity: 0.40 + 0.52 * intensity,
                    scale,
                    offset: [0, baseY, 0],
                    size: 0.068 + 0.025 * intensity,
                    sizeEnd: 0.042,
                    sizeJitter: 0.20,
                    phase: phase * 4 + offsetDeg,
                    phaseSpread: 28,
                    omega,
                    radius,
                    radiusEnd: radius * 0.86,
                    rise,
                    depthRatio: 0.88,
                    twinkle: 0.50,
                    fadeIn: 0.18,
                    fadeOut: 0.42,
                })),
            };
        },
    },

    orbit_halo: {
        label: "倾斜星芒环",
        category: "curve",
        instant: false,
        interval: 24,
        priority: 2,
        defaultBrush: "star",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 1.32, 0.35);
            const radius = (2.28 + 0.38 * music.sustain) * m.spread;
            return {
                priority: 2,
                emitters: [drawPoints({
                    count: 14,
                    life: 2.25,
                    lifeJitter: 0.10,
                    brush: resolveBrush(brush, 1),
                    color,
                    color2,
                    opacity: 0.34 + 0.56 * intensity,
                    scale,
                    offset: [0, y, 0],
                    size: 0.068 + 0.026 * intensity,
                    sizeEnd: 0.052,
                    sizeJitter: 0.30,
                    spinRate: 45 * m.dir,
                    phase: phase * 3,
                    phaseSpread: 360,
                    omega: (68 + 42 * music.activity) * m.dir * m.speed,
                    radius,
                    radiusEnd: radius * 1.04,
                    radialJitter: 0.16,
                    depthRatio: 0.89,
                    tilt: 0.52 * m.spread,
                    twinkle: 0.48,
                    fadeIn: 0.35,
                    fadeOut: 0.60,
                })],
            };
        },
    },

    silk_streams: {
        label: "穿场丝带",
        category: "curve",
        instant: false,
        interval: 24,
        priority: 3,
        defaultBrush: "mote",
        emit({ color, intensity, scale, zone, motion, music }) {
            const m = motionFactors(motion);
            const opts = withEffectColor("beam", color, {
                intensity,
                scale,
                x: -2.42 * m.dir,
                y: 0.42 + 0.42 * music.pitch + ZONE_Y_OFFSET[zone ?? "stage"],
                z: 0.12,
                heading: m.dir > 0 ? -99 : 81,
                bend: 0.66 * m.spread,
                range: 1.18 * m.spread,
                speed: 0.84 * m.speed,
                lanes: 1,
                segments: 2,
                width: 0.24,
                length: Math.min(2.4, (1.3 + 1.05 * music.sustain) * m.energy),
            });
            return {
                priority: 3,
                emitters: effectEmitters("beam", opts, { music, previous: opts, profile: "silk" }),
            };
        },
    },

    wave_ribbon: {
        label: "律动音浪环",
        category: "curve",
        instant: false,
        interval: 32,
        priority: 3,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, previousAmplitude, phase = 0 }) {
            const m = motionFactors(motion);
            if (!brush || brush === "default") {
                const amplitude = Math.min(1.1, (0.22 + 0.42 * music.activity) * m.energy);
                const opts = withEffectColor("wave", color, {
                    intensity: intensity * (0.65 + 0.35 * music.activity),
                    scale,
                    height: ZONE_Y_OFFSET[zone ?? "stage"] * 0.7,
                    range: 1.08 * m.spread,
                    density: 0.78,
                    size: 1.0,
                    speed: m.speed,
                    amplitude,
                    phase: phase * m.dir,
                });
                return {
                    priority: 3,
                    nextAmplitude: amplitude,
                    emitters: effectEmitters("wave", opts, {
                        music,
                        previous: { ...opts, amplitude: previousAmplitude ?? amplitude },
                    }),
                };
            }
            const y = zoneBaseY(zone, 1.18, 0.30);
            const amp = (0.34 + 0.45 * music.activity) * m.energy;
            const resolvedBrush = resolveBrush(brush, 1);
            return {
                priority: 3,
                nextAmplitude: amp,
                emitters: [0, 180].map((shift, idx) => drawPoints({
                    count: 14,
                    life: 1.85,
                    lifeJitter: 0.08,
                    brush: resolvedBrush,
                    color: idx === 0 ? color : color2,
                    color2: idx === 0 ? color2 : color,
                    opacity: 0.36 + 0.54 * intensity,
                    scale,
                    offset: [0, y, 0],
                    size: 0.082,
                    sizeEnd: 0.068,
                    sizeJitter: 0.15,
                    phase: phase * 3 + shift,
                    phaseSpread: 360,
                    omega: (110 + 50 * music.activity) * m.dir * m.speed,
                    radius: 2.30 * m.spread,
                    radiusEnd: (2.30 + 0.14 * idx) * m.spread,
                    depthRatio: 0.88,
                    tilt: amp,
                    fadeIn: 0.25,
                    fadeOut: 0.48,
                })),
            };
        },
    },

    vortex_column: {
        label: "时空旋涡柱",
        category: "curve",
        instant: false,
        interval: 16,
        priority: 3,
        defaultBrush: "star",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const reverse = motion === "reverse";
            const y = zoneBaseY(zone, reverse ? 2.45 : 0.22, 0.15);
            const resolvedBrush = resolveBrush(brush, 1);
            const omega = (210 + 90 * music.activity) * (reverse ? -1 : 1) * m.speed;
            return {
                priority: 3,
                emitters: [
                    drawPoints({
                        count: 8,
                        life: 1.55,
                        lifeJitter: 0.15,
                        brush: resolvedBrush,
                        color,
                        color2,
                        opacity: 0.42 + 0.52 * intensity,
                        scale,
                        offset: [0, y, 0],
                        size: 0.072 + 0.024 * intensity,
                        sizeEnd: 0.04,
                        phase: phase * 5,
                        phaseSpread: 360,
                        omega,
                        radius: (reverse ? 0.95 : 2.55) * m.spread,
                        radiusEnd: (reverse ? 2.55 : 0.95) * m.spread,
                        curve: 0.85,
                        depthRatio: 0.88,
                        rise: (reverse ? -2.1 : 2.1) * m.energy,
                        fadeIn: 0.18,
                        fadeOut: 0.36,
                    }),
                    drawPoints({
                        count: 6,
                        life: 1.40,
                        lifeJitter: 0.15,
                        brush: resolvedBrush,
                        color: color2,
                        color2: color,
                        opacity: 0.30 + 0.45 * intensity,
                        scale,
                        offset: [0, y + 0.15, 0],
                        size: 0.056,
                        sizeEnd: 0.035,
                        phase: phase * 5 + 90,
                        phaseSpread: 360,
                        omega: omega * 1.15,
                        radius: (reverse ? 1.35 : 2.95) * m.spread,
                        radiusEnd: (reverse ? 2.95 : 1.35) * m.spread,
                        curve: 0.85,
                        depthRatio: 0.88,
                        rise: (reverse ? -1.85 : 1.85) * m.energy,
                        twinkle: 0.6,
                        fadeIn: 0.18,
                        fadeOut: 0.36,
                    }),
                ],
            };
        },
    },

    lissajous_weave: {
        label: "利萨如织光",
        category: "curve",
        instant: false,
        interval: 22,
        priority: 3,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const yCenter = zoneBaseY(zone, 1.55, 0.75);
            const raw = sampleLissajous(
                (2.35 + 0.35 * music.sustain) * m.spread,
                (0.68 + 0.35 * music.activity) * m.energy,
                (1.85 + 0.30 * music.sustain) * m.spread,
                yCenter,
                2,
                3,
                2,
                phase * 2.5 * m.dir,
                36,
            );
            const points = catmullRom(raw, 4);
            return {
                priority: 3,
                emitters: drawStrokeSegments(points, {
                    count: 18,
                    life: 1.35,
                    brush: resolveStrokeBrush(brush, 3),
                    color,
                    color2,
                    opacity: 0.36 + 0.54 * intensity,
                    width: 0.13 + 0.04 * intensity,
                    scale,
                    travel: 0.16 * m.speed * m.dir,
                    taperEnds: false,
                    fadeIn: 0.18,
                    fadeOut: 0.36,
                }),
            };
        },
    },

    light_pillars: {
        label: "霓虹灯柱阵",
        category: "stage",
        instant: false,
        interval: 16,
        priority: 4,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, zone, motion, music, previousLength }) {
            const m = motionFactors(motion);
            const length = Math.min(2.4, (1.28 + 0.85 * music.sustain + 0.30 * music.activity) * m.energy);
            const yOffset = ZONE_Y_OFFSET[zone ?? "stage"] * 0.6;
            const sidesOpts = withEffectColor("shaft", color, {
                intensity,
                scale,
                y: yOffset,
                range: 1.05 * m.spread,
                width: 0.21,
                length,
            });
            const rearOpts = withEffectColor("shaft", color2, {
                intensity: intensity * 0.82,
                scale,
                y: yOffset,
                range: 1.08 * m.spread,
                width: 0.18,
                length: Math.min(2.4, length * 1.12),
            });
            const prev = previousLength ?? length;
            return {
                priority: 4,
                nextLength: length,
                emitters: [
                    ...effectEmitters("shaft", sidesOpts, { music, previous: { ...sidesOpts, length: prev }, layout: "neon-sides" }),
                    ...effectEmitters("shaft", rearOpts, { music, previous: { ...rearOpts, length: prev * 1.12 }, layout: "neon-rear" }),
                ],
            };
        },
    },

    crown_fan: {
        label: "圣光扇束冠冕",
        category: "stage",
        instant: false,
        interval: 20,
        priority: 5,
        defaultBrush: "mote",
        emit({ color, intensity, scale, zone, motion, music, previousLength }) {
            const m = motionFactors(motion);
            const length = Math.min(2.4, (1.10 + 1.15 * music.sustain + 0.24 * music.surge) * m.energy);
            const opts = withEffectColor("shaft", color, {
                intensity,
                scale,
                y: ZONE_Y_OFFSET[zone ?? "stage"] * 0.7,
                range: 1.05 * m.spread,
                width: 0.22,
                length,
            });
            return {
                priority: 5,
                nextLength: length,
                emitters: effectEmitters("shaft", opts, {
                    music,
                    previous: { ...opts, length: previousLength ?? length },
                    layout: "fan",
                }),
            };
        },
    },

    stage_truss: {
        label: "舞台门架光框",
        category: "stage",
        instant: false,
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        emit({ color, intensity, scale, zone, motion, music, previousLength }) {
            const m = motionFactors(motion);
            const length = Math.min(2.4, (1.20 + 0.90 * music.density + 0.30 * music.activity) * m.energy);
            const opts = withEffectColor("shaft", color, {
                intensity,
                scale,
                y: ZONE_Y_OFFSET[zone ?? "stage"] * 0.5,
                range: 1.02 * m.spread,
                width: 0.20,
                length,
            });
            return {
                priority: 4,
                nextLength: length,
                emitters: effectEmitters("shaft", opts, {
                    music,
                    previous: { ...opts, length: previousLength ?? length },
                    layout: "truss",
                }),
            };
        },
    },

    magic_circle: {
        label: "星辰法阵",
        category: "stage",
        instant: false,
        interval: 22,
        priority: 4,
        defaultBrush: "star",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, phase = 0 }) {
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.45 : zone === "high" ? 1.25 : 0.08;
            const radius = (2.42 + 0.28 * music.sustain) * m.spread;
            const rot = phase * 3.5 * m.dir;
            const triA = sampleStarPolygon(radius * 0.95, 3, y, rot, 0.88);
            const triB = sampleStarPolygon(radius * 0.95, 3, y, rot + 60, 0.88);
            const strokeBrush = resolveStrokeBrush(brush, 1);
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
                        brush: resolveBrush(brush, 1),
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
    },

    portal_arch: {
        label: "时空光拱门",
        category: "stage",
        instant: false,
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        emit({ color, color2, intensity, scale, brush, zone, motion, music }) {
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
                        brush: resolveStrokeBrush(brush, 1),
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
                        brush: resolveBrush(brush, 1),
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
    },

    key_notes: {
        label: "琴键飞音符",
        category: "keys",
        instant: false,
        interval: 1,
        priority: 5,
        defaultBrush: "note",
        emit({ color, color2, intensity, scale, brush, zone, motion, music, recentNotes, lastNoteTick = -1, definition, phase = 0, solo = false }) {
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 2);
            const resolvedBrush = resolveBrush(brush, 4);
            const yShift = ZONE_Y_OFFSET[zone ?? "stage"] * 0.4;
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, definition);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const keyColor = pitchGradientHex(color, color2, note.midi);
                const driftX = (pitch - 0.5) * (1.25 + 0.45 * music.sustain) * m.spread;
                const riseVy = (1.10 + 0.72 * pitch) * m.speed * m.dir;
                emitters.push({
                    ...drawPoints({
                        count: 2,
                        life: 0.52 + pitch * 0.14,
                        lifeJitter: 0.12,
                        brush: resolvedBrush,
                        color: keyColor,
                        color2,
                        opacity: intensity * note.velocity * 0.90,
                        scale,
                        size: 0.085 + 0.025 * note.velocity,
                        sizeEnd: 0.048,
                        sizeJitter: 0.22,
                        velocity: [driftX, riseVy, 0.72 + pitch * 0.95],
                        accel: [0, -0.85 * m.dir, 0],
                        flutter: 0.05,
                        fadeIn: 0.05,
                        fadeOut: 0.26,
                    }),
                    transform: { x: origin[0], y: origin[1] + yShift, z: origin[2], scale },
                });
            }
            return { priority: 5, emitters };
        },
    },

    key_fountain: {
        label: "琴键音泉喷涌",
        category: "keys",
        instant: false,
        interval: 2,
        priority: 4,
        defaultBrush: "spark",
        emit({ color, color2, intensity, scale, brush, zone, motion, recentNotes, lastNoteTick = -1, definition, phase = 0, solo = false }) {
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 2);
            const resolvedBrush = resolveBrush(brush, 6);
            const yShift = ZONE_Y_OFFSET[zone ?? "stage"] * 0.4;
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, definition);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const keyColor = pitchGradientHex(color, color2, note.midi);
                emitters.push({
                    ...drawPoints({
                        count: 4,
                        life: 0.68,
                        lifeJitter: 0.18,
                        brush: resolvedBrush,
                        color: keyColor,
                        color2,
                        opacity: intensity * (0.45 + 0.55 * note.velocity),
                        scale,
                        size: 0.072,
                        sizeEnd: 0.032,
                        sizeJitter: 0.30,
                        spinJitter: 60,
                        spinRate: 120 * m.dir,
                        spread: [0.06, 0.04, 0.04],
                        velocity: [(pitch - 0.5) * 0.9 * m.spread, (1.85 + 0.55 * note.velocity) * m.speed, 0.55],
                        accel: [0, -4.6 * m.energy, 0.18],
                        flutter: resolvedBrush === 2 || resolvedBrush === 3 ? 0.14 : 0.04,
                        fadeIn: 0.05,
                        fadeOut: 0.30,
                    }),
                    transform: { x: origin[0], y: origin[1] + yShift, z: origin[2], scale },
                });
            }
            return { priority: 4, emitters };
        },
    },

    key_constellation: {
        label: "琴键星座连线",
        category: "keys",
        instant: false,
        interval: 4,
        priority: 4,
        defaultBrush: "star",
        emit({ color, color2, intensity, scale, brush, zone, motion, recentNotes, lastNoteTick = -1, definition, phase = 0, solo = false }) {
            const m = motionFactors(motion);
            const targets = pickRecentKeys(recentNotes, lastNoteTick, phase, solo, 4);
            if (!targets.length) return { priority: 4, emitters: [] };
            const yShift = ZONE_Y_OFFSET[zone ?? "stage"] * 0.5;
            const resolvedBrush = resolveBrush(brush, 1);
            const strokeBrush = resolveStrokeBrush(brush, 1);
            const lifted: Point3[] = [];
            const emitters: VfxEmitter[] = [];
            for (const note of targets) {
                const origin = keyOriginFor(note.midi, definition);
                if (!origin) continue;
                const pitch = (note.midi - 21) / 87;
                const pt: Point3 = [origin[0], origin[1] + 0.42 + pitch * 0.72 + yShift, origin[2] + 0.18];
                lifted.push(pt);
                emitters.push({
                    ...drawPoints({
                        count: 1,
                        life: 0.85,
                        lifeJitter: 0,
                        brush: resolvedBrush,
                        color: pitchGradientHex(color, color2, note.midi),
                        color2,
                        opacity: intensity * (0.55 + 0.45 * note.velocity),
                        scale,
                        size: 0.095,
                        sizeEnd: 0.048,
                        velocity: [0, 0.18 * m.dir * m.speed, 0.08],
                        twinkle: 0.75,
                        fadeIn: 0.06,
                        fadeOut: 0.36,
                    }),
                    transform: { x: pt[0], y: pt[1], z: pt[2], scale },
                });
            }
            if (lifted.length >= 2) {
                const stageDepth = vfxStageFrame(definition).depth;
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
                        effect: "beam",
                        particle: "draw_stroke",
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
    },

    floor_sweep: {
        label: "地面扫光弧",
        category: "accent",
        instant: true,
        interval: 0,
        priority: 8,
        defaultBrush: "spark",
        emit({ color, color2, intensity, scale, brush, zone, motion, phase = 0 }) {
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.38 : zone === "high" ? 1.15 : 0.07;
            const extent = (2.15 + 0.55 * Math.max(0, intensity - 0.5)) * m.spread;
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
                    brush: resolveStrokeBrush(brush, 2),
                    color,
                    color2,
                    opacity: 0.45 + 0.50 * intensity,
                    width: 0.16,
                    scale,
                    travel: 0.24 * m.speed,
                    fadeIn: 0.12,
                    fadeOut: 0.34,
                }),
            };
        },
    },

    shockwave: {
        label: "重拍冲击波",
        category: "accent",
        instant: true,
        interval: 0,
        priority: 8,
        defaultBrush: "ring",
        emit({ color, color2, intensity, scale, brush, zone, motion, phase = 0 }) {
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.42 : zone === "high" ? 1.25 : 0.08;
            const shockRgb = hexToUnitRgb(color);
            const spikeRadius = (2.15 + 0.55 * intensity) * m.spread;
            const spikes = Array.from({ length: 8 }, (_, i) => {
                const a = ((i / 8) * 360 + phase * 11) * Math.PI / 180;
                const cos = Math.cos(a);
                const sin = Math.sin(a);
                return {
                    effect: "beam" as const,
                    particle: "draw_stroke" as const,
                    offset: { x: cos * 0.85, y: y + 0.04, z: sin * 0.85 },
                    particles: 1,
                    lifetime: 0.85,
                    transform: { scale },
                    variables: {
                        count: 1,
                        life: 0.85,
                        brush: resolveStrokeBrush(brush, 2),
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
                    radiusEnd: (2.85 + 0.65 * intensity) * m.spread,
                    curve: 0.65,
                    spinRate: 24 * m.dir,
                    style: 0,
                    fadeIn: 0.08,
                    fadeOut: 0.52,
                }),
                drawGroundRing({
                    life: 1.28,
                    color: color2,
                    color2: color,
                    opacity: 0.34 + 0.42 * intensity,
                    scale,
                    offset: [0, y + 0.05, 0],
                    radiusStart: 0.70,
                    radiusEnd: (3.40 + 0.65 * intensity) * m.spread,
                    curve: 0.72,
                    spinRate: -18 * m.dir,
                    style: 1,
                    fadeIn: 0.12,
                    fadeOut: 0.58,
                }),
                cinemaEmitter("cinema_shock", intensity < 0.85 ? 14 : 16, 1.15, {
                    ...shockRgb,
                    opacity: intensity,
                    strength: intensity,
                    phase: (phase * 37) % 360,
                }, { y, scale }),
                ...spikes,
            ];
            if (brush && brush !== "default" && brush !== "ring") {
                emitters.push(drawPoints({
                    count: 10,
                    life: 1.05,
                    lifeJitter: 0.15,
                    brush: resolveBrush(brush, 7),
                    color: color2,
                    color2: color,
                    opacity: 0.48 + 0.46 * intensity,
                    scale,
                    offset: [0, y + 0.15, 0],
                    size: 0.11,
                    sizeEnd: 0.05,
                    radius: 0.65,
                    radiusEnd: (2.9 + 0.5 * intensity) * m.spread,
                    curve: 0.65,
                    omega: 35 * m.dir,
                    depthRatio: 0.90,
                    fadeIn: 0.08,
                    fadeOut: 0.45,
                }));
            }
            return { priority: 8, emitters };
        },
    },

    prism_rewind: {
        label: "棱晶时空回卷",
        category: "accent",
        instant: true,
        interval: 0,
        priority: 7,
        defaultBrush: "shard",
        emit({ color, color2, intensity, scale, brush, zone, motion, music }) {
            const m = motionFactors(motion);
            const reverse = motion === "reverse";
            const flow = reverse ? 1 : -1;
            const yShift = ZONE_Y_OFFSET[zone ?? "stage"] * 0.7;
            const shardOpts = withEffectColor("shard", color, {
                intensity,
                scale,
                height: yShift,
                flow,
                range: (reverse ? 1.24 : 1.18) * m.spread,
                speed: (reverse ? 1.14 : 0.90) * m.speed,
                size: reverse ? 1.16 : 0.96,
                density: 0.80,
            });
            const resolvedBrush = resolveBrush(brush, 5);
            const innerR = reverse ? 0.85 : 2.55 * m.spread;
            const outerR = reverse ? 2.65 * m.spread : 0.75;
            return {
                priority: 7,
                emitters: [
                    ...effectEmitters("shard", shardOpts, { music, previous: shardOpts }),
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
                        spinRate: (reverse ? 90 : -90) * m.speed,
                        phaseSpread: 360,
                        omega: (reverse ? 52 : -58) * m.speed,
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
    },

    firework_bloom: {
        label: "高空烟花盛放",
        category: "accent",
        instant: true,
        interval: 0,
        priority: 8,
        defaultBrush: "spark",
        emit({ color, color2, intensity, scale, brush, zone, motion }) {
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 2.55, 1.45);
            const resolvedBrush = resolveBrush(brush, 6);
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
                size: 0.095 + 0.025 * intensity,
                sizeEnd: 0.032,
                sizeJitter: 0.25,
                spinJitter: 90,
                spinRate: 110 * m.dir,
                phase: index * 47,
                phaseSpread: 360,
                omega: 26 * m.dir,
                radius: 0.08,
                radiusEnd: (1.55 + 0.35 * intensity) * m.spread,
                curve: 0.52,
                radialJitter: 0.22,
                depthRatio: 0.95,
                tilt: 0.58 * (index % 2 === 0 ? 1 : -1),
                velocity: [0, 0.78 * m.speed, 0],
                accel: [0, -2.35 * m.energy, 0],
                twinkle: 0.58,
                fadeIn: 0.06,
                fadeOut: 0.45,
            }));
            if (intensity >= 0.75) {
                const count = 6;
                for (const side of [-1, 1] as const) {
                    emitters.push({
                        effect: "fountain",
                        offset: { x: side * 1.88, y: 0.32 + ZONE_Y_OFFSET[zone ?? "stage"] * 0.4, z: -0.18 },
                        lifetime: 1.35,
                        particles: count,
                        transform: { scale },
                        variables: {
                            ...hexToUnitRgb(color),
                            opacity: 0.62 * intensity,
                            count,
                            life: 1.15,
                            side,
                            speed: 1.12 * m.speed,
                            size: 0.95,
                        },
                    });
                }
            }
            return { priority: 8, emitters };
        },
    },

    key_style: {
        label: "弹奏粒子样式",
        category: "keys",
        instant: false,
        interval: 20,
        priority: 0,
        defaultBrush: "spark",
        emit() {
            return { priority: 0, emitters: [] };
        },
    },
};

export interface StageThemeLayer {
    method: PerformanceMethod;
    color: string;
    color2?: string;
    brush?: PerformanceBrush;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    /** Level in percent (0–100) or mapped from a music feature. */
    level: number | { input: keyof MusicFeatures; from: number; to: number };
    scale?: number;
    /** For instant methods: trigger when feature exceeds threshold. */
    gate?: { input: "chord" | "onset" | "surge"; threshold: number; cooldown: number };
}

export interface StageThemeSpec {
    label: string;
    keyParticle?: PianoParticleOverride;
    layers: readonly StageThemeLayer[];
}

export const VFX_STAGE_THEMES: Readonly<Record<"sakura" | "starlight" | "cathedral" | "carnival", StageThemeSpec>> = {
    sakura: {
        label: "落樱星庭",
        keyParticle: { style: "sakura_drift", colors: ["#FFB7D5", "#FFF4DC"], glimmer: true },
        layers: [
            { method: "petal_fall", color: "#FFB7D5", color2: "#FFF4DC", brush: "petal", zone: "high",
                level: { input: "activity", from: 45, to: 88 } },
            { method: "firefly_rise", color: "#FFE29A", color2: "#FFB7D5", brush: "mote", zone: "low",
                level: { input: "activity", from: 35, to: 75 } },
            { method: "silk_streams", color: "#FFB7D5", color2: "#D6EAFF",
                level: { input: "sustain", from: 30, to: 82 } },
            { method: "key_fountain", color: "#FFB7D5", color2: "#FFE29A", brush: "petal", level: 78 },
        ],
    },
    starlight: {
        label: "星空法阵",
        keyParticle: { style: "stardust", colors: ["#8EB8FF", "#68E4FF"], glimmer: true },
        layers: [
            { method: "starfield", color: "#8EB8FF", color2: "#D6EAFF", motion: "gentle", level: 55 },
            { method: "magic_circle", color: "#68E4FF", color2: "#C58CFF",
                level: { input: "activity", from: 45, to: 90 } },
            { method: "double_helix", color: "#7C92FF", color2: "#4EEBFF", brush: "star",
                level: { input: "surge", from: 25, to: 88 } },
            { method: "key_constellation", color: "#D6EAFF", color2: "#68E4FF", brush: "star", level: 82 },
        ],
    },
    cathedral: {
        label: "圣光时空",
        keyParticle: { style: "magic_trail", colors: ["#D6EAFF", "#FFE29A"], glimmer: true },
        layers: [
            { method: "aurora_veil", color: "#7C92FF", color2: "#68E4FF",
                level: { input: "activity", from: 52, to: 88 } },
            { method: "portal_arch", color: "#8EB8FF", color2: "#FFE29A",
                level: { input: "sustain", from: 35, to: 92 } },
            { method: "crown_fan", color: "#FFE29A", color2: "#FFB870",
                level: { input: "surge", from: 0, to: 95 } },
            { method: "key_notes", color: "#D6EAFF", color2: "#FFE29A", brush: "note", level: 84 },
            { method: "prism_rewind", color: "#68E4FF", color2: "#FFE29A", level: 78,
                gate: { input: "surge", threshold: 0.72, cooldown: 52 } },
        ],
    },
    carnival: {
        label: "璀璨烟花夜",
        keyParticle: { style: "prism_shards", colors: ["#FFB870", "#FF8DA8"], glimmer: true },
        layers: [
            { method: "firefly_rise", color: "#FFB870", color2: "#FF8DA8", brush: "mote", level: 58 },
            { method: "wing_ribbons", color: "#FFB870", color2: "#FF8DA8",
                level: { input: "activity", from: 38, to: 90 } },
            { method: "light_pillars", color: "#4EEBFF", color2: "#C58CFF",
                level: { input: "density", from: 32, to: 78 } },
            { method: "firework_bloom", color: "#FFE29A", color2: "#FF8DA8", level: 85,
                gate: { input: "chord", threshold: 0.35, cooldown: 36 } },
        ],
    },
};

export type VfxStageThemeName = keyof typeof VFX_STAGE_THEMES;

export function isVfxStageTheme(name: string): name is VfxStageThemeName {
    return Object.hasOwn(VFX_STAGE_THEMES, name);
}

interface ThemeLayerState {
    nextTick: number;
    lastNoteTick: number;
    previousLength?: number;
    previousAmplitude?: number;
}

/** Reactive player for painter-based stage themes (`sakura`, `starlight`, `cathedral`, `carnival`). */
export class VfxThemePlayer {
    private readonly states: ThemeLayerState[];
    private soloStep = 0;
    readonly duration: number;

    constructor(
        private readonly theme: StageThemeSpec,
        private readonly definition?: InstrumentDefinition,
        seconds = Infinity,
    ) {
        this.states = theme.layers.map(() => ({ nextTick: 0, lastNoteTick: -1 }));
        this.duration = Number.isFinite(seconds) ? Math.ceil(seconds * 20) : Infinity;
    }

    reset(tick: number) {
        for (const state of this.states) {
            state.nextTick = tick;
            state.lastNoteTick = -1;
            state.previousLength = undefined;
            state.previousAmplitude = undefined;
        }
        this.soloStep = 0;
    }

    keyParticleOverride(): PianoParticleOverride | undefined {
        return this.theme.keyParticle;
    }

    update(
        tick: number,
        music: Readonly<MusicFeatures>,
        recentNotes?: readonly VfxKeyNote[],
        solo = false,
    ): VfxBatch[] {
        if (tick >= this.duration) return [];
        const envelope = Number.isFinite(this.duration)
            ? clampUnit((tick + 4) / 10) * clampUnit((this.duration - tick) / 28)
            : 1;
        const batches: VfxBatch[] = [];
        for (const [index, layer] of this.theme.layers.entries()) {
            if (layer.method === "key_style") continue;
            const painter = VFX_PAINTERS[layer.method];
            const state = this.states[index];
            if (tick < state.nextTick) continue;

            if (layer.gate) {
                const value = solo ? 1 : music[layer.gate.input];
                if (value < layer.gate.threshold) continue;
            }

            let hasFresh = false;
            if (painter.category === "keys") {
                hasFresh = Boolean(recentNotes?.some((note) => note.tick > state.lastNoteTick));
                if (!hasFresh && !solo) continue;
            }

            const rawLevel = typeof layer.level === "number"
                ? layer.level
                : solo
                    ? (layer.level.from + layer.level.to) * 0.5
                    : mix(layer.level.from, layer.level.to, clampUnit(music[layer.level.input]));
            const intensity = clampUnit((rawLevel / 100) * envelope);
            if (intensity < 0.005) continue;

            const color = resolvePerformanceColor(layer.color);
            const color2 = layer.color2 ? resolvePerformanceColor(layer.color2) : deriveAccentHex(color);
            const result = painter.emit({
                color,
                color2,
                intensity,
                scale: (layer.scale ?? 100) / 100,
                brush: layer.brush,
                zone: layer.zone,
                motion: layer.motion,
                music: solo ? quietFeatures : music,
                recentNotes,
                lastNoteTick: state.lastNoteTick,
                definition: this.definition,
                previousLength: state.previousLength,
                previousAmplitude: state.previousAmplitude,
                phase: painter.category === "keys" ? this.soloStep : (tick * 9 + index * 29) % 360,
                solo,
            });

            if (layer.gate) {
                state.nextTick = tick + layer.gate.cooldown;
            } else if (painter.category === "keys") {
                if (hasFresh) {
                    for (const note of recentNotes ?? []) {
                        if (note.tick > state.lastNoteTick) state.lastNoteTick = note.tick;
                    }
                    state.nextTick = tick + Math.max(1, painter.interval);
                } else {
                    state.nextTick = tick + 8;
                    this.soloStep += 5;
                }
            } else {
                state.nextTick = tick + Math.max(1, painter.interval);
            }
            if (result.nextLength !== undefined) state.previousLength = result.nextLength;
            if (result.nextAmplitude !== undefined) state.previousAmplitude = result.nextAmplitude;
            if (result.emitters.length) {
                batches.push({ priority: result.priority, emitters: result.emitters });
            }
        }
        return batches.sort((a, b) => b.priority - a.priority);
    }
}
