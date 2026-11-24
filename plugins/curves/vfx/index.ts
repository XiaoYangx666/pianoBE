import {
    catmullRom,
    drawBeam,
    drawComet,
    drawPoints,
    drawStrokeSegments,
    drawWave,
    mix,
    motionFactors,
    resolvePointBrush,
    resolveSchemaParams,
    resolveStrokeBrush,
    sampleWingPair,
    zoneBaseY,
    ZONE_Y_OFFSET,
    type Point3,
    type VfxEffectDefinition,
    type VfxParameterSchema,
    type VfxPluginManifest,
    type VfxPluginModule,
} from "@piano/vfx";
import rawManifest from "../plugin.json";

const WING_RIBBONS_PARAMS = {
    radius: { label: "翼展半径", default: 1.56, min: 0.6, max: 3.2, step: 0.1 },
    height: { label: "翼展高度", default: 1.0, min: 0.3, max: 2.5, step: 0.1 },
    spread: { label: "展开张角", default: 0.72, min: 0.3, max: 1.8, step: 0.05 },
    width: { label: "丝带宽度", default: 0.145, min: 0.05, max: 0.35, step: 0.01 },
} as const satisfies VfxParameterSchema;

const DOUBLE_HELIX_PARAMS = {
    radius: { label: "螺旋半径", default: 2.2, min: 0.5, max: 4.0, step: 0.1 },
    height: { label: "上升高度", default: 1.95, min: 0.5, max: 5.0, step: 0.1 },
    angularSpeed: { label: "旋转角速度", default: 135, min: -360, max: 360, step: 5 },
    particleSize: { label: "粒子大小", default: 0.068, min: 0.02, max: 0.16, step: 0.005 },
} as const satisfies VfxParameterSchema;

const ORBIT_HALO_PARAMS = {
    radius: { label: "星环半径", default: 2.28, min: 0.8, max: 4.0, step: 0.1 },
    angularSpeed: { label: "公转角速度", default: 68, min: -240, max: 240, step: 5 },
    tilt: { label: "倾角", default: 0.52, min: -1.2, max: 1.2, step: 0.05 },
    particleSize: { label: "粒子大小", default: 0.068, min: 0.02, max: 0.16, step: 0.005 },
} as const satisfies VfxParameterSchema;

const SILK_STREAMS_PARAMS = {
    width: { label: "丝带宽度", default: 0.24, min: 0.08, max: 0.5, step: 0.01 },
    length: { label: "丝带长度", default: 1.3, min: 0.6, max: 2.8, step: 0.1 },
    bend: { label: "弯曲弧度", default: 0.66, min: -1.5, max: 1.5, step: 0.05 },
    speed: { label: "掠过速度", default: 0.84, min: 0.3, max: 2.0, step: 0.05 },
} as const satisfies VfxParameterSchema;

const WAVE_RIBBON_PARAMS = {
    amplitude: { label: "波峰振幅", default: 0.22, min: 0.05, max: 1.2, step: 0.05 },
    radius: { label: "音浪半径", default: 1.08, min: 0.5, max: 2.0, step: 0.05 },
    speed: { label: "律动速度", default: 1.0, min: 0.3, max: 2.5, step: 0.1 },
} as const satisfies VfxParameterSchema;

const INK_TRACE_PARAMS = {
    reach: { label: "笔迹长度", default: 1.0, min: 0.2, max: 1.0, step: 0.05 },
    width: { label: "笔触宽度", default: 0.14, min: 0.05, max: 0.32, step: 0.01 },
} as const satisfies VfxParameterSchema;

const MUSUBI_BRAID_PARAMS = {
    radius: { label: "编织半径", default: 2.15, min: 0.6, max: 3.6, step: 0.1 },
    tilt: { label: "交错倾角", default: 0.38, min: 0.0, max: 1.0, step: 0.05 },
    angularSpeed: { label: "回旋速度", default: 58, min: -180, max: 180, step: 5 },
} as const satisfies VfxParameterSchema;

const TIME_WARP_PARAMS = {
    radius: { label: "裂隙半径", default: 2.55, min: 1.2, max: 4.0, step: 0.1 },
    speed: { label: "倒流速度", default: 1.35, min: 0.3, max: 3.0, step: 0.1 },
    warp: { label: "时空畸变", default: 0.6, min: 0.0, max: 1.0, step: 0.05 },
    streakLength: { label: "光丝长度", default: 1.65, min: 0.6, max: 3.4, step: 0.1 },
} as const satisfies VfxParameterSchema;

const CURVE_EFFECTS: readonly VfxEffectDefinition[] = [
    {
        id: "wing_ribbons",
        label: "双翼流光丝带",
        category: "curve",
        trigger: "continuous",
        interval: 22,
        priority: 4,
        defaultBrush: "mote",
        defaultStroke: "silk",
        parameters: WING_RIBBONS_PARAMS,
        tags: ["ribbon"],
        nextInterval: (params) => (params.intensity > 0.70 ? 20 : 22),
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(WING_RIBBONS_PARAMS, params.custom);
            const m = motionFactors(motion);
            const spread = (c.spread + 0.58 * Math.max(music.surge, intensity * 0.85)) * m.spread;
            const radius = (0.88 + 0.30 * (2.25 + 0.90 * intensity) * (0.85 + 0.15 * music.sustain))
                * Math.max(0.85, Math.min(1.15, scale))
                * (c.radius / 1.56);
            const height = (0.42 + 1.18 * intensity + 0.28 * music.pitch) * c.height;
            const yShift = ZONE_Y_OFFSET[zone] * 0.65;
            const strokeBrush = resolveStrokeBrush(brush, "silk");
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
                    width: c.width + 0.04 * intensity,
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
    } satisfies VfxEffectDefinition,

    {
        id: "double_helix",
        label: "双螺旋星轨",
        category: "curve",
        trigger: "continuous",
        interval: 18,
        priority: 3,
        defaultBrush: "star",
        parameters: DOUBLE_HELIX_PARAMS,
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(DOUBLE_HELIX_PARAMS, params.custom);
            const m = motionFactors(motion);
            const baseY = zoneBaseY(zone, m.dir > 0 ? 0.30 : 2.35, 0.20);
            const resolvedBrush = resolvePointBrush(brush, "star");
            const radius = (c.radius + 0.35 * music.sustain) * m.spread;
            const rise = (c.height + 0.65 * music.activity) * m.dir;
            const omega = (c.angularSpeed + Math.sign(c.angularSpeed) * 65 * music.activity) * m.dir * m.speed;
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
                    size: c.particleSize + 0.025 * intensity,
                    sizeEnd: (c.particleSize / 0.068) * 0.042,
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
    } satisfies VfxEffectDefinition,

    {
        id: "orbit_halo",
        label: "倾斜星芒环",
        category: "curve",
        trigger: "continuous",
        interval: 24,
        priority: 2,
        defaultBrush: "star",
        parameters: ORBIT_HALO_PARAMS,
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(ORBIT_HALO_PARAMS, params.custom);
            const m = motionFactors(motion);
            const y = zoneBaseY(zone, 1.32, 0.35);
            const radius = (c.radius + 0.38 * music.sustain) * m.spread;
            return {
                priority: 2,
                emitters: [drawPoints({
                    count: 14,
                    life: 2.25,
                    lifeJitter: 0.10,
                    brush: resolvePointBrush(brush, "star"),
                    color,
                    color2,
                    opacity: 0.34 + 0.56 * intensity,
                    scale,
                    offset: [0, y, 0],
                    size: c.particleSize + 0.026 * intensity,
                    sizeEnd: (c.particleSize / 0.068) * 0.052,
                    sizeJitter: 0.30,
                    spinRate: 45 * m.dir,
                    phase: phase * 3,
                    phaseSpread: 360,
                    omega: (c.angularSpeed + Math.sign(c.angularSpeed) * 42 * music.activity) * m.dir * m.speed,
                    radius,
                    radiusEnd: radius * 1.04,
                    radialJitter: 0.16,
                    depthRatio: 0.89,
                    tilt: c.tilt * m.spread,
                    twinkle: 0.48,
                    fadeIn: 0.35,
                    fadeOut: 0.60,
                })],
            };
        },
    } satisfies VfxEffectDefinition,

    {
        id: "silk_streams",
        label: "穿场丝带",
        category: "curve",
        trigger: "continuous",
        interval: 24,
        priority: 3,
        defaultBrush: "mote",
        defaultStroke: "silk",
        variants: ["sweep", "right", "left"],
        parameters: SILK_STREAMS_PARAMS,
        createState: () => ({ previousHeight: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, variant, zone, motion } = params;
            const c = resolveSchemaParams(SILK_STREAMS_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yZone = ZONE_Y_OFFSET[zone];
            const widthScale = c.width / 0.24;
            const lengthScale = c.length / 1.3;
            const bendScale = c.bend / 0.66;
            const speedScale = c.speed / 0.84;
            if (variant === "right") {
                const height = mix(-0.4, 0.62, music.pitch) + yZone;
                const previousHeight = state.previousHeight ?? height;
                state.previousHeight = height;
                return {
                    priority: 3,
                    emitters: drawBeam({
                        color,
                        opacity: 0.73 * intensity,
                        heading: 82,
                        bend: 0.64 * bendScale * m.spread,
                        range: 1.18 * m.spread,
                        width: 0.23 * widthScale,
                        lanes: 1,
                        segments: 3,
                        speed: 0.7 * speedScale * m.speed,
                        length: mix(1.72, 2.39, music.sustain) * lengthScale,
                        height,
                        previousHeight,
                        silk: true,
                        transform: { x: 2.67, z: 0.21, scale },
                    }),
                };
            }
            if (variant === "left") {
                const height = 0.66 + yZone;
                state.previousHeight = height;
                return {
                    priority: 3,
                    emitters: drawBeam({
                        color,
                        opacity: 0.73 * intensity,
                        heading: -102,
                        bend: 0.86 * bendScale * m.spread,
                        range: 1.28 * m.spread,
                        width: 0.26 * widthScale,
                        lanes: 1,
                        segments: 2,
                        speed: 0.56 * speedScale * m.speed,
                        length: mix(1.52, 2.4, music.sustain) * lengthScale,
                        height,
                        previousHeight: height,
                        silk: true,
                        transform: { x: -2.86, z: 0.48, scale },
                    }),
                };
            }
            const height = 0.42 + 0.42 * music.pitch + yZone;
            const previousHeight = state.previousHeight ?? height;
            state.previousHeight = height;
            return {
                priority: 3,
                emitters: drawBeam({
                    color,
                    opacity: 0.73 * intensity,
                    heading: m.dir > 0 ? -99 : 81,
                    bend: c.bend * m.spread,
                    range: 1.18 * m.spread,
                    speed: c.speed * m.speed,
                    lanes: 1,
                    segments: 2,
                    width: c.width,
                    length: Math.min(2.8, (c.length + 1.05 * music.sustain) * m.energy),
                    height,
                    previousHeight,
                    silk: true,
                    transform: { x: -2.42 * m.dir, z: 0.12, scale },
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousHeight?: number }>,

    {
        id: "wave_ribbon",
        label: "律动音浪环",
        category: "curve",
        trigger: "continuous",
        interval: 32,
        priority: 3,
        defaultBrush: "mote",
        variants: ["ribbon", "points"],
        parameters: WAVE_RIBBON_PARAMS,
        createState: () => ({ previousAmplitude: undefined as number | undefined }),
        emit({ params, music, phase, state }) {
            const { color, color2, intensity, scale, brush, variant, zone, motion } = params;
            const c = resolveSchemaParams(WAVE_RIBBON_PARAMS, params.custom);
            const m = motionFactors(motion);
            const useRibbon = variant === "ribbon" || (variant !== "points" && (!brush || brush === "default" || brush === "mote"));
            if (useRibbon) {
                const maxAmp = Math.max(1.1, c.amplitude * 1.4);
                const amplitude = Math.min(maxAmp, (c.amplitude + 0.42 * music.activity) * m.energy);
                const previousAmplitude = state.previousAmplitude ?? amplitude;
                state.previousAmplitude = amplitude;
                return {
                    priority: 3,
                    emitters: drawWave({
                        color,
                        opacity: intensity * (0.65 + 0.35 * music.activity),
                        amplitude,
                        previousAmplitude,
                        height: ZONE_Y_OFFSET[zone] * 0.7,
                        range: c.radius * m.spread,
                        density: 0.78,
                        size: 1.0,
                        speed: c.speed * m.speed,
                        phase: phase * m.dir,
                        scale,
                    }),
                };
            }
            const y = zoneBaseY(zone, 1.18, 0.30);
            const amp = (0.34 + 0.45 * music.activity) * (c.amplitude / 0.22) * m.energy;
            state.previousAmplitude = amp;
            const resolvedBrush = resolvePointBrush(brush, "star");
            const radiusScale = c.radius / 1.08;
            return {
                priority: 3,
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
                    omega: (110 + 50 * music.activity) * m.dir * c.speed * m.speed,
                    radius: 2.30 * radiusScale * m.spread,
                    radiusEnd: (2.30 + 0.14 * idx) * radiusScale * m.spread,
                    depthRatio: 0.88,
                    tilt: amp,
                    fadeIn: 0.25,
                    fadeOut: 0.48,
                })),
            };
        },
    } satisfies VfxEffectDefinition<{ previousAmplitude?: number }>,

    {
        id: "ink_trace",
        label: "流光笔迹",
        category: "curve",
        trigger: "continuous",
        interval: 24,
        priority: 3,
        defaultBrush: "mote",
        defaultStroke: "calligraphy",
        parameters: INK_TRACE_PARAMS,
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(INK_TRACE_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 1.0, 0.35);
            const raw: Point3[] = [
                [-1.85 * m.spread, yBase, -0.55],
                [-0.85 * m.spread, yBase + 0.48, 0.22],
                [0.15 * m.spread, yBase + 0.96, 0.88],
                [1.05 * m.spread, yBase + 1.12, 1.55],
                [0.45 * m.spread, yBase + 0.88, 2.12],
                [-0.35 * m.spread, yBase + 0.64, 2.52],
            ];
            const path = catmullRom(m.dir < 0 ? [...raw].reverse() : raw, 8);
            const count = Math.max(3, Math.ceil(c.reach * 14));
            return {
                priority: 3,
                emitters: drawStrokeSegments(path.slice(0, Math.max(2, Math.ceil(path.length * c.reach))), {
                    count,
                    life: 1.85,
                    brush: resolveStrokeBrush(brush, "calligraphy"),
                    color,
                    color2,
                    opacity: (0.48 + 0.36 * music.sustain) * intensity,
                    width: c.width + music.sustain * 0.045,
                    scale,
                    travel: 0.08 * m.speed * m.dir,
                    fadeIn: 0.28,
                    fadeOut: 0.46,
                }),
            };
        },
    } satisfies VfxEffectDefinition,

    {
        id: "musubi_braid",
        label: "绯红组纽",
        category: "curve",
        trigger: "continuous",
        interval: 10,
        priority: 3,
        defaultBrush: "mote",
        parameters: MUSUBI_BRAID_PARAMS,
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(MUSUBI_BRAID_PARAMS, params.custom);
            const m = motionFactors(motion);
            const ascending = motion === "reverse";
            const yBase = zoneBaseY(zone, ascending ? 0.85 : 1.18, 0.35);
            const resolvedBrush = resolvePointBrush(brush, "mote");
            const baseAngle = (phase * 28) % 360;
            const r = (c.radius + 0.32 * music.sustain) * m.spread;
            return {
                priority: 3,
                emitters: ([0, 1] as const).map((strand) => drawPoints({
                    count: 7,
                    life: ascending ? 2.6 : 1.75,
                    lifeJitter: 0.14,
                    brush: resolvedBrush,
                    color: strand === 0 ? color : color2,
                    color2: strand === 0 ? color2 : color,
                    opacity: 0.38 + 0.52 * intensity,
                    scale,
                    offset: [0, yBase + (strand === 0 ? 0.08 : -0.08), 0],
                    size: 0.058 + 0.022 * intensity,
                    sizeEnd: ascending ? 0.024 : 0.036,
                    sizeJitter: 0.18,
                    phase: baseAngle + strand * 180,
                    phaseSpread: 42,
                    omega: (ascending ? (c.angularSpeed / 58) * 36 : c.angularSpeed) * m.speed,
                    radius: r,
                    radiusEnd: ascending ? r * 0.68 : r * (1.04 + 0.06 * music.activity),
                    curve: 0.85,
                    radialJitter: 0.05,
                    depthRatio: 0.88,
                    tilt: (strand === 0 ? c.tilt : -c.tilt) * (0.8 + 0.35 * music.pitch),
                    rise: ascending ? 1.85 : 0.08 * (strand === 0 ? 1 : -1),
                    flutter: 0.07 * m.energy,
                    twinkle: 0.42,
                    fadeIn: 0.18,
                    fadeOut: 0.45,
                })),
            };
        },
    } satisfies VfxEffectDefinition,

    {
        id: "time_warp",
        label: "时空穿越裂隙",
        category: "curve",
        trigger: "continuous",
        interval: 14,
        priority: 4,
        defaultBrush: "shard",
        defaultStroke: "comet",
        parameters: TIME_WARP_PARAMS,
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(TIME_WARP_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yCenter = zoneBaseY(zone, 1.35, 0.35);
            const r = (c.radius + 0.20 * music.sustain) * m.spread;
            const strokeBrush = resolveStrokeBrush(brush, "comet");
            const pointBrush = resolvePointBrush(brush, "shard");
            const emitters = [];

            for (const [idx, angleOffset] of ([0, 180] as const).entries()) {
                const baseDeg = phase * 3.0 * m.dir + angleOffset;
                const arcR = r * (idx === 0 ? 1.0 : 1.12);
                const tiltAmp = (idx === 0 ? 1 : -1) * (0.30 + 0.38 * c.warp);
                const points: Point3[] = Array.from({ length: 8 }, (_, step) => {
                    const rad = ((baseDeg + (step / 7) * 95) * Math.PI) / 180;
                    return [
                        arcR * Math.cos(rad),
                        yCenter + tiltAmp * Math.sin(rad),
                        arcR * 0.88 * Math.sin(rad),
                    ];
                });
                emitters.push(...drawStrokeSegments(points, {
                    count: 5,
                    life: 0.92,
                    brush: strokeBrush,
                    color: idx === 0 ? color : color2,
                    color2: idx === 0 ? color2 : color,
                    opacity: 0.38 + 0.54 * intensity,
                    width: 0.085 + 0.045 * c.warp,
                    scale,
                    travel: -0.35 * c.speed * m.speed * m.dir,
                    fadeIn: 0.12,
                    fadeOut: 0.32,
                }));
            }

            const streakCount = c.warp >= 0.45 ? 4 : 2;
            for (let i = 0; i < streakCount; i++) {
                const side = i % 2 === 0 ? -1 : 1;
                const tier = Math.floor(i / 2);
                const seed = Math.abs(Math.sin((phase + 7) * 19.31 + i * 53.7) * 29413.1) % 1;
                const xPos = side * (r * (0.86 + 0.20 * tier) + (seed - 0.5) * 0.35);
                const yPos = yCenter + (tier === 0 ? -0.35 : 0.72) + (seed - 0.5) * 0.35;
                const zStart = m.dir > 0 ? 2.45 + 0.35 * seed : -1.05 - 0.35 * seed;
                const velSpeed = (2.15 + 1.35 * c.speed + 0.45 * music.activity) * m.speed;
                const len = c.streakLength * (0.72 + 0.48 * c.warp + 0.20 * intensity) * scale;
                const dirY = 0.06 * c.warp;
                const dirZ = -m.dir;
                const dirMag = Math.hypot(dirY, dirZ) || 1;
                emitters.push(drawComet({
                    offset: [xPos, yPos, zStart],
                    life: 0.76,
                    length: len * 0.68,
                    lengthEnd: len,
                    width: (0.14 + 0.05 * c.warp) * scale,
                    direction: [0, dirY / dirMag, dirZ / dirMag],
                    velocity: [0, (dirY / dirMag) * velSpeed, (dirZ / dirMag) * velSpeed],
                    color: i % 2 === 0 ? color : color2,
                    color2: "#FFF4DC",
                    opacity: 0.44 + 0.52 * intensity,
                    scale,
                    fadeIn: 0.08,
                    fadeOut: 0.34,
                }));
            }

            emitters.push(drawPoints({
                count: 8,
                life: 1.15,
                lifeJitter: 0.14,
                brush: pointBrush,
                color: color2,
                color2: color,
                opacity: 0.42 + 0.52 * intensity,
                scale,
                offset: [0, Math.max(0.25, yCenter - 0.15), 0],
                size: 0.072 + 0.024 * intensity,
                sizeEnd: 0.032,
                aspect: 1.65,
                spinJitter: 45,
                spinRate: -110 * c.speed * m.dir,
                phase: phase * 4,
                phaseSpread: 360,
                omega: -145 * c.speed * m.speed * m.dir,
                radius: r * 0.96,
                radiusEnd: r * Math.max(0.55, 0.96 - 0.28 * c.warp),
                radialJitter: 0.14,
                depthRatio: 0.88,
                tilt: 0.35 + 0.42 * c.warp,
                rise: (0.42 + 1.05 * c.warp) * m.dir,
                twinkle: 0.72,
                fadeIn: 0.14,
                fadeOut: 0.38,
            }));

            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition,
];

export const curvesPlugin: VfxPluginModule = {
    manifest: rawManifest as VfxPluginManifest,
    register(api) {
        for (const effect of CURVE_EFFECTS) {
            api.registerEffect(effect);
        }
    },
};

export default curvesPlugin;
