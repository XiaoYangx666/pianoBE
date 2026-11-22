import {
    catmullRom,
    colorVars,
    drawComet,
    drawGroundRing,
    drawPoints,
    drawPolygonFrame,
    drawShaft,
    drawStrokeSegments,
    hexToUnitRgb,
    motionFactors,
    resolvePointBrush,
    resolveSchemaParams,
    resolveStrokeBrush,
    sampleArch,
    sampleStarPolygon,
    zoneBaseY,
    ZONE_Y_OFFSET,
    type LightAnchor,
    type Point3,
    type StageVeilAnchor,
    type VfxEffectDefinition,
    type VfxEmitter,
    type VfxParameterSchema,
    type VfxPluginManifest,
    type VfxPluginModule,
} from "@piano/vfx";
import rawManifest from "../plugin.json";

const STAGE_LIGHT_LAYOUTS: Readonly<Record<string, readonly LightAnchor[]>> = {
    "neon-sides": [-1, 1].flatMap(side => [
        { origin: { x: side * 2.03, y: 0.12, z: 1.10 }, direction: { x: 0, y: 1, z: 0 }, length: 1.53, width: 1.25, gain: 1 },
        { origin: { x: side * 2.77, y: 0.12, z: 0.72 }, direction: { x: 0, y: 1, z: 0 }, length: 1.10, width: 1, gain: 0.76 },
    ]),
    "neon-rear": [-1, 1].map(side => ({
        origin: { x: side * 2.52, y: 0.12, z: 1.90 }, direction: { x: 0, y: 1, z: 0 }, length: 1.75, width: 0.83, gain: 1,
    })),
    rails: [-1, 1].flatMap(side => [
        { origin: { x: side * 2.10, y: 0.10, z: 1.26 }, direction: { x: side * 0.04, y: 1, z: 0.05 }, length: 1.54, width: 1.12, gain: 0.9 },
        { origin: { x: side * 2.86, y: 0.10, z: 0.69 }, direction: { x: side * 0.23, y: 1, z: 0.30 }, length: 1.18, width: 1.16, gain: 0.66 },
        { origin: { x: side * 2.33, y: 0.09, z: -0.86 }, direction: { x: side * 0.11, y: 0.17, z: 1.0 }, length: 1.48, width: 0.72, gain: 0.44 },
    ]),
    backline: [-1, 1].flatMap(side => [
        { origin: { x: side * 1.73, y: 0.12, z: 1.64 }, direction: { x: side * 0.06, y: 1, z: 0.08 }, length: 1.76, width: 1.30, gain: 1.0 },
        { origin: { x: side * 2.57, y: 0.12, z: 1.46 }, direction: { x: side * 0.14, y: 1, z: 0.17 }, length: 1.41, width: 1.01, gain: 0.78 },
    ]),
    fan: [-1, 1].flatMap(side => [
        { origin: { x: side * 1.95, y: 0.14, z: 1.12 }, direction: { x: side * 0.35, y: 1, z: 0.25 }, length: 2.21, width: 1.30, gain: 1.0 },
        { origin: { x: side * 2.12, y: 0.14, z: 0.92 }, direction: { x: side * 0.69, y: 1, z: 0.10 }, length: 2.26, width: 1.38, gain: 0.86 },
        { origin: { x: side * 2.43, y: 0.13, z: 0.55 }, direction: { x: side * 1.2, y: 1, z: -0.18 }, length: 1.88, width: 1.24, gain: 0.72 },
    ]),
    truss: [-1, 1].flatMap(side => [
        { origin: { x: side * 3.19, y: 0.12, z: 1.24 }, direction: { x: 0, y: 1, z: 0 }, length: 1.81, width: 0.70, gain: 0.89 },
        { origin: { x: side * 3.19, y: 3.51, z: 1.24 }, direction: { x: -side, y: 0, z: 0 }, length: 0.93, width: 0.64, gain: 0.76 },
        { origin: { x: side * 3.19, y: 0.12, z: 1.24 }, direction: { x: 0, y: 0, z: -1 }, length: 1.80, width: 0.54, gain: 0.55 },
        { origin: { x: side * 3.19, y: 0.53, z: 1.24 }, direction: { x: 0, y: 0, z: -1 }, length: 0.42, width: 0.74, gain: 0.66 },
    ]),
};

const STAGE_VEIL_LAYOUTS: Readonly<Record<string, readonly StageVeilAnchor[]>> = {
    aurora: [
        { origin: { x: -1.31, y: 2.96, z: 1.92 }, span: 25.5, rise: 1.85, gain: 1, phase: 28, roll: 6 },
        { origin: { x: 2.01, y: 1.32, z: 0.68 }, span: 14.4, rise: 0.97, gain: 0.70, phase: 188, roll: -11 },
        { origin: { x: 0.90, y: 4.15, z: 2.35 }, span: 21.0, rise: 1.08, gain: 0.46, phase: 136, roll: 12 },
    ],
    wings: [-1, 1].map(side => ({
        origin: { x: side * 2.79, y: 0.12, z: 1.72 },
        span: 12.7, rise: 2.28, gain: side === -1 ? 0.91 : 1, phase: side * 40, roll: side * 4,
    })),
};

const LIGHT_PILLARS_PARAMS = {
    length: { label: "光束长度", default: 1.28, min: 0.5, max: 2.4, step: 0.1 },
    width: { label: "光束宽度", default: 0.21, min: 0.08, max: 0.5, step: 0.01 },
    spread: { label: "横向展开", default: 1.0, min: 0.5, max: 1.6, step: 0.05 },
} as const satisfies VfxParameterSchema;

const CROWN_FAN_PARAMS = {
    length: { label: "光束长度", default: 1.10, min: 0.5, max: 2.4, step: 0.1 },
    width: { label: "光束宽度", default: 0.22, min: 0.08, max: 0.5, step: 0.01 },
    spread: { label: "横向展开", default: 1.0, min: 0.5, max: 1.6, step: 0.05 },
} as const satisfies VfxParameterSchema;

const STAGE_TRUSS_PARAMS = {
    length: { label: "光束长度", default: 1.20, min: 0.5, max: 2.4, step: 0.1 },
    width: { label: "光束宽度", default: 0.20, min: 0.08, max: 0.5, step: 0.01 },
} as const satisfies VfxParameterSchema;

const MAGIC_CIRCLE_PARAMS = {
    radius: { label: "法阵半径", default: 2.42, min: 1.0, max: 4.2, step: 0.1 },
    spinSpeed: { label: "旋转速度", default: 28, min: -120, max: 120, step: 2 },
    lineWidth: { label: "阵纹宽度", default: 0.095, min: 0.04, max: 0.24, step: 0.005 },
} as const satisfies VfxParameterSchema;

const PORTAL_ARCH_PARAMS = {
    width: { label: "拱门跨度", default: 2.35, min: 1.0, max: 4.2, step: 0.1 },
    height: { label: "拱门高度", default: 2.35, min: 1.0, max: 4.5, step: 0.1 },
    lineWidth: { label: "光弧宽度", default: 0.155, min: 0.06, max: 0.35, step: 0.01 },
} as const satisfies VfxParameterSchema;

const WINDOW_BEAMS_PARAMS = {
    angle: { label: "照射倾角", default: 34, min: 0, max: 65, step: 2 },
    spread: { label: "灯位跨度", default: 2.35, min: 1.0, max: 3.8, step: 0.1 },
    length: { label: "光束长度", default: 2.4, min: 0.8, max: 4.2, step: 0.1 },
    width: { label: "光束宽度", default: 0.62, min: 0.18, max: 1.4, step: 0.02 },
    beams: { type: "enum", label: "光束编组", options: ["single", "pair", "quad"] as const, default: "pair" },
} as const satisfies VfxParameterSchema;

const TIME_DIAL_PARAMS = {
    radius: { label: "表盘半径", default: 2.35, min: 1.0, max: 3.8, step: 0.1 },
    pointerSpeed: { label: "指针转速", default: 24, min: -300, max: 300, step: 6 },
    tilt: { label: "表盘倾角", default: 0, min: 0, max: 75, step: 5 },
    lineWidth: { label: "指针线宽", default: 0.085, min: 0.04, max: 0.2, step: 0.005 },
} as const satisfies VfxParameterSchema;

const SEA_REFLECTION_PARAMS = {
    width: { label: "海面宽幅", default: 3.1, min: 1.4, max: 4.8, step: 0.1 },
    depth: { label: "纵深跨度", default: 1.9, min: 0.8, max: 3.2, step: 0.1 },
    shimmer: { label: "波光活跃", default: 0.45, min: 0.1, max: 1.0, step: 0.05 },
    tideSpeed: { label: "海浪推进", default: 0.35, min: 0.05, max: 1.2, step: 0.05 },
} as const satisfies VfxParameterSchema;

function buildWindowShaft(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    color: string,
    opacity: number,
    length: number,
    previousLength: number,
    width: number,
    scale: number,
): VfxEmitter {
    const mag = Math.hypot(dx, dy, dz) || 1;
    const life = 1.6;
    return {
        particle: "shaft",
        group: "shaft",
        offset: { x, y, z },
        particles: 1,
        lifetime: life,
        transform: { z: 0, scale },
        variables: {
            ...hexToUnitRgb(color),
            opacity,
            life,
            length,
            previous_length: previousLength,
            width,
            shaft_style: 1,
            dir_x: dx / mag,
            dir_y: dy / mag,
            dir_z: dz / mag,
        },
    };
}

const STAGE_EFFECTS: readonly VfxEffectDefinition[] = [
    {
        id: "light_pillars",
        label: "霓虹灯柱阵",
        category: "stage",
        trigger: "continuous",
        interval: 16,
        priority: 4,
        defaultBrush: "mote",
        variants: ["neon", "neon_sides", "neon_rear", "backline", "rails"],
        parameters: LIGHT_PILLARS_PARAMS,
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, color2, intensity, scale, variant, zone, motion } = params;
            const c = resolveSchemaParams(LIGHT_PILLARS_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yOffset = ZONE_Y_OFFSET[zone] * 0.6;
            const lengthScale = c.length / 1.28;
            const widthScale = c.width / 0.21;
            if (variant === "backline" || variant === "rails" || variant === "neon_sides" || variant === "neon_rear") {
                const layout = variant === "neon_sides"
                    ? "neon-sides"
                    : variant === "neon_rear"
                        ? "neon-rear"
                        : variant;
                const length = variant === "backline"
                    ? Math.min(2.4, (1.38 + 0.97 * music.surge) * lengthScale * m.energy)
                    : variant === "neon_rear"
                        ? Math.min(2.4, (1.72 + 0.43 * music.density) * lengthScale * m.energy)
                        : Math.min(2.4, (1.42 + 0.54 * music.sustain) * lengthScale * m.energy);
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
                        width: (variant === "backline" ? 0.26 : variant === "neon_rear" ? 0.18 : 0.21) * widthScale,
                        range: 1.05 * c.spread * m.spread,
                        yOffset,
                        zOffset: variant === "backline" ? 0.1 : 0,
                        scale,
                    }),
                };
            }
            const length = Math.min(2.4, (c.length + 0.85 * music.sustain + 0.30 * music.activity) * m.energy);
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
                        width: c.width,
                        range: 1.05 * c.spread * m.spread,
                        yOffset,
                        scale,
                    }),
                    ...drawShaft({
                        layout: "neon-rear",
                        color: color2,
                        opacity: intensity * 0.82,
                        length: Math.min(2.4, length * 1.12),
                        previousLength: prev * 1.12,
                        width: 0.18 * widthScale,
                        range: 1.08 * c.spread * m.spread,
                        yOffset,
                        scale,
                    }),
                ],
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    {
        id: "crown_fan",
        label: "圣光扇束冠冕",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 5,
        defaultBrush: "mote",
        parameters: CROWN_FAN_PARAMS,
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, zone, motion } = params;
            const c = resolveSchemaParams(CROWN_FAN_PARAMS, params.custom);
            const m = motionFactors(motion);
            const length = Math.min(2.4, (c.length + 1.15 * music.sustain + 0.24 * music.surge) * m.energy);
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
                    width: c.width,
                    range: 1.05 * c.spread * m.spread,
                    yOffset: ZONE_Y_OFFSET[zone] * 0.7,
                    scale,
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    {
        id: "stage_truss",
        label: "舞台门架光框",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        parameters: STAGE_TRUSS_PARAMS,
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, intensity, scale, zone, motion } = params;
            const c = resolveSchemaParams(STAGE_TRUSS_PARAMS, params.custom);
            const m = motionFactors(motion);
            const length = Math.min(2.4, (c.length + 0.90 * music.density + 0.30 * music.activity) * m.energy);
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
                    width: c.width,
                    range: 1.02 * m.spread,
                    yOffset: ZONE_Y_OFFSET[zone] * 0.5,
                    scale,
                }),
            };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    {
        id: "magic_circle",
        label: "星辰法阵",
        category: "stage",
        trigger: "continuous",
        interval: 22,
        priority: 4,
        defaultBrush: "star",
        defaultStroke: "laser",
        parameters: MAGIC_CIRCLE_PARAMS,
        emit({ params, music, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(MAGIC_CIRCLE_PARAMS, params.custom);
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.45 : zone === "high" ? 1.25 : 0.08;
            const radius = (c.radius + 0.28 * music.sustain) * m.spread;
            const rot = phase * 3.5 * (c.spinSpeed / 28) * m.dir;
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
                        spinRate: c.spinSpeed * m.dir * m.speed,
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
                        width: c.lineWidth,
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
                        width: (c.lineWidth / 0.095) * 0.085,
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
                        omega: c.spinSpeed * m.dir * m.speed,
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

    {
        id: "portal_arch",
        label: "时空光拱门",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        defaultStroke: "laser",
        parameters: PORTAL_ARCH_PARAMS,
        emit({ params, music }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(PORTAL_ARCH_PARAMS, params.custom);
            const m = motionFactors(motion);
            const yBase = zoneBaseY(zone, 0.25, 0.12);
            const archWidth = (c.width + 0.40 * music.sustain) * m.spread;
            const archHeight = (c.height + 0.45 * intensity) * m.energy;
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
                        width: c.lineWidth + 0.04 * intensity,
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

    {
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

    {
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

    {
        id: "window_beams",
        label: "琴房斜射光束",
        category: "stage",
        trigger: "continuous",
        interval: 20,
        priority: 4,
        defaultBrush: "mote",
        parameters: WINDOW_BEAMS_PARAMS,
        createState: () => ({ previousLength: undefined as number | undefined }),
        emit({ params, music, state }) {
            const { color, color2, intensity, scale, zone, motion } = params;
            const c = resolveSchemaParams(WINDOW_BEAMS_PARAMS, params.custom);
            const m = motionFactors(motion);
            const rad = (c.angle * Math.PI) / 180;
            const yOffset = ZONE_Y_OFFSET[zone] * 0.6;
            const length = Math.min(4.5, (c.length + 0.45 * music.sustain + 0.20 * music.activity) * m.energy);
            const prevLength = state?.previousLength ?? length;
            if (state) state.previousLength = length;

            if (c.beams === "single") {
                return {
                    priority: 4,
                    emitters: [
                        buildWindowShaft(
                            -c.spread * 0.78 * m.spread,
                            3.65 + yOffset,
                            1.15,
                            Math.sin(rad),
                            -Math.cos(rad),
                            -0.18,
                            color,
                            intensity * 0.92,
                            length,
                            prevLength,
                            c.width,
                            scale,
                        ),
                    ],
                };
            }

            const emitters: VfxEmitter[] = ([-1, 1] as const).map((side) =>
                buildWindowShaft(
                    side * c.spread * m.spread,
                    3.65 + yOffset,
                    1.35,
                    -side * Math.sin(rad),
                    -Math.cos(rad),
                    -0.18,
                    side === -1 ? color : color2,
                    intensity,
                    length,
                    prevLength,
                    c.width,
                    scale,
                ),
            );

            if (c.beams === "quad") {
                const innerRad = Math.min(Math.PI * 0.44, rad * 1.12);
                for (const side of [-1, 1] as const) {
                    emitters.push(
                        buildWindowShaft(
                            side * (c.spread + 0.55) * m.spread,
                            3.45 + yOffset,
                            0.55,
                            -side * Math.sin(innerRad),
                            -Math.cos(innerRad),
                            -0.14,
                            side === -1 ? color2 : color,
                            intensity * 0.78,
                            Math.min(4.5, length * 0.92),
                            prevLength * 0.92,
                            c.width * 0.88,
                            scale,
                        ),
                    );
                }
            }

            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition<{ previousLength?: number }>,

    {
        id: "time_dial",
        label: "极简时空表盘",
        category: "stage",
        trigger: "continuous",
        interval: 16,
        priority: 4,
        defaultBrush: "star",
        defaultStroke: "laser",
        parameters: TIME_DIAL_PARAMS,
        createState: () => ({ angle: 0 }),
        emit({ params, music, state }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(TIME_DIAL_PARAMS, params.custom);
            const m = motionFactors(motion);
            const r = (c.radius + 0.15 * music.sustain) * m.spread;
            const tiltRad = (c.tilt * Math.PI) / 180;
            const cosTilt = Math.cos(tiltRad);
            const sinTilt = Math.sin(tiltRad);
            const yFloor = zone === "mid" ? 0.45 : zone === "high" ? 1.25 : 0.10;
            const centerY = yFloor + r * sinTilt;
            const centerZ = sinTilt * 1.15;
            const center: Point3 = [0, centerY, centerZ];
            const effectiveSpeed = c.pointerSpeed * m.dir * m.speed;
            const angle = state ? state.angle : 0;
            if (state) state.angle = (state.angle - effectiveSpeed * (16 / 20)) % 360;

            const dialPoint = (deg: number, len: number): Point3 => {
                const a = (deg * Math.PI) / 180;
                const sy = Math.sin(a);
                return [
                    Math.cos(a) * len,
                    centerY + sy * sinTilt * len,
                    centerZ + sy * cosTilt * 0.9 * len,
                ];
            };

            const strokeBrush = resolveStrokeBrush(brush, "laser");
            const pointBrush = resolvePointBrush(brush, "star");
            const ringVerts = Array.from({ length: 8 }, (_, i) => dialPoint(i * 45, r));
            const minuteDeg = 90 + angle;
            const hourDeg = 90 + angle / 6;

            const emitters: VfxEmitter[] = [
                ...drawPolygonFrame(ringVerts, {
                    life: 1.05,
                    brush: strokeBrush,
                    color,
                    color2,
                    opacity: (0.24 + 0.38 * intensity) * 0.72,
                    width: c.lineWidth * 0.58,
                    scale,
                    fadeIn: 0.18,
                    fadeOut: 0.36,
                }),
                drawPoints({
                    count: 12,
                    life: 1.15,
                    lifeJitter: 0.05,
                    brush: pointBrush,
                    color: color2,
                    color2: color,
                    opacity: 0.32 + 0.50 * intensity,
                    scale,
                    offset: center,
                    size: 0.068 + 0.02 * intensity,
                    sizeEnd: 0.05,
                    phase: 0,
                    phaseSpread: 360,
                    omega: 0,
                    radius: r,
                    radiusEnd: r,
                    depthRatio: cosTilt * 0.9,
                    tilt: sinTilt * r,
                    twinkle: 0.45,
                    fadeIn: 0.16,
                    fadeOut: 0.34,
                }),
                ...drawPolygonFrame([center, dialPoint(minuteDeg, r * 0.88)], {
                    closed: false,
                    life: 1.05,
                    brush: strokeBrush,
                    color,
                    color2,
                    opacity: 0.46 + 0.50 * intensity,
                    width: c.lineWidth,
                    scale,
                    fadeIn: 0.12,
                    fadeOut: 0.30,
                }),
                ...drawPolygonFrame([center, dialPoint(hourDeg, r * 0.54)], {
                    closed: false,
                    life: 1.05,
                    brush: strokeBrush,
                    color: color2,
                    color2: color,
                    opacity: 0.40 + 0.46 * intensity,
                    width: c.lineWidth * 1.15,
                    scale,
                    fadeIn: 0.12,
                    fadeOut: 0.30,
                }),
            ];

            if (c.tilt <= 20) {
                const ringFade = 1 - c.tilt / 20;
                emitters.push(drawGroundRing({
                    life: 1.15,
                    color,
                    color2,
                    opacity: (0.28 + 0.42 * intensity) * ringFade,
                    scale,
                    offset: [0, yFloor, 0],
                    radiusStart: r,
                    radiusEnd: r * 1.02,
                    curve: 1,
                    spin: angle,
                    spinRate: -effectiveSpeed * 0.22,
                    style: 1,
                    fadeIn: 0.18,
                    fadeOut: 0.38,
                }));
            }

            if (Math.abs(effectiveSpeed) >= 60) {
                const ghostDeg = minuteDeg + Math.sign(effectiveSpeed) * 20;
                emitters.push(...drawPolygonFrame([center, dialPoint(ghostDeg, r * 0.84)], {
                    closed: false,
                    life: 0.95,
                    brush: strokeBrush,
                    color: color2,
                    color2: color,
                    opacity: (0.46 + 0.50 * intensity) * 0.42,
                    width: c.lineWidth * 0.72,
                    scale,
                    fadeIn: 0.08,
                    fadeOut: 0.32,
                }));
            }

            return { priority: 4, emitters };
        },
    } satisfies VfxEffectDefinition<{ angle: number }>,

    {
        id: "sea_reflection",
        label: "夏夜海面波光",
        category: "stage",
        trigger: "continuous",
        interval: 18,
        priority: 2,
        defaultBrush: "mote",
        defaultStroke: "silk",
        parameters: SEA_REFLECTION_PARAMS,
        emit({ params, phase }) {
            const { color, color2, intensity, scale, brush, zone, motion } = params;
            const c = resolveSchemaParams(SEA_REFLECTION_PARAMS, params.custom);
            const m = motionFactors(motion);
            const y = zone === "mid" ? 0.36 : zone === "high" ? 1.1 : 0.07;
            const strokeBrush = resolveStrokeBrush(brush, "silk");
            const pointBrush = resolvePointBrush(brush, "mote");
            const emitters: VfxEmitter[] = [];

            for (let i = 0; i < 6; i++) {
                const seed = Math.abs(Math.sin((phase + 3) * 14.71 + i * 37.9) * 31943.2) % 1;
                const lane = (i % 3) - 1;
                const tier = Math.floor(i / 3);
                const xPos = (lane * 0.42 + (seed - 0.5) * 0.34) * c.width * m.spread;
                const zPos = 0.22 + (tier * 0.48 + seed * 0.35) * c.depth;
                const len = (0.55 + 0.60 * seed) * (0.85 + 0.25 * c.shimmer);
                const streakColor = i % 2 === 0 ? color : color2;
                const streakNext = i % 2 === 0 ? color2 : color;
                emitters.push({
                    particle: "draw_stroke",
                    group: "beam",
                    offset: { x: xPos, y, z: zPos },
                    particles: 1,
                    lifetime: 1.45,
                    transform: { scale },
                    variables: {
                        count: 1,
                        life: 1.45,
                        brush: strokeBrush,
                        length: len,
                        length_end: len * 1.18,
                        width: 0.065 + 0.045 * c.shimmer,
                        vx: 0,
                        vy: 0,
                        vz: -c.tideSpeed * 0.35 * m.speed * m.dir,
                        ax: 0,
                        ay: 0,
                        az: 0,
                        tx: 1,
                        ty: 0,
                        tz: 0,
                        ...colorVars(streakColor, streakNext, (0.24 + 0.48 * intensity) * (0.55 + 0.55 * c.shimmer)),
                        fade_in: 0.28,
                        fade_out: 0.55,
                    },
                });
            }

            emitters.push(drawPoints({
                count: 10,
                life: 1.55,
                lifeJitter: 0.22,
                brush: pointBrush,
                color: color2,
                color2: color,
                opacity: (0.26 + 0.50 * intensity) * (0.50 + 0.55 * c.shimmer),
                scale,
                offset: [0, y + 0.03, c.depth * 0.45],
                size: 0.055 + 0.03 * c.shimmer,
                sizeEnd: 0.028,
                sizeJitter: 0.36,
                spread: [c.width * 0.9 * m.spread, 0.04, c.depth * 0.65],
                velocity: [0, 0, -c.tideSpeed * 0.25 * m.speed * m.dir],
                twinkle: Math.min(1, 0.45 + 0.50 * c.shimmer),
                fadeIn: 0.25,
                fadeOut: 0.52,
            }));

            return { priority: 2, emitters };
        },
    } satisfies VfxEffectDefinition,
];

export const stagePlugin: VfxPluginModule = {
    manifest: rawManifest as VfxPluginManifest,
    register(api) {
        for (const [id, anchors] of Object.entries(STAGE_LIGHT_LAYOUTS)) {
            api.registerLightLayout(id, anchors);
        }
        for (const [id, veils] of Object.entries(STAGE_VEIL_LAYOUTS)) {
            api.registerVeilLayout(id, veils);
        }
        for (const effect of STAGE_EFFECTS) {
            api.registerEffect(effect);
        }
    },
};

export default stagePlugin;
