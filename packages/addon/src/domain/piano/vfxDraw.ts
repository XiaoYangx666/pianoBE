import {
    parsePerformanceRgb, type PerformanceBrush, type PerformanceMotion, type PerformanceZone,
} from "@piano/core";
import { GRAND_KEY_HITBOXES } from "../../data/grand.generated";
import { KEY_HITBOXES } from "../../data/hitboxes.generated";
import { grandDefinition, type InstrumentDefinition } from "../instrument/definition";
import type { VfxEmitter, VfxParticle } from "./vfxLab";
import { clampUnit, mix } from "./vfxMusic";
import { vfxStageFrame } from "./vfxStage";

export type Point3 = readonly [number, number, number];
export type Segment3 = { point: Point3; tangent: Point3; spacing: number; u: number };
export type BrushIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type StrokeBrushIndex = 0 | 1 | 2 | 3;

export const BRUSH_INDEX: Readonly<Record<Exclude<PerformanceBrush, "default">, BrushIndex>> = {
    mote: 0,
    star: 1,
    petal: 2,
    snow: 3,
    note: 4,
    shard: 5,
    spark: 6,
    ring: 7,
};

export const ZONE_Y_OFFSET: Readonly<Record<PerformanceZone, number>> = {
    stage: 0,
    low: -0.45,
    mid: 0.25,
    high: 1.15,
};

export function resolveBrush(brush: PerformanceBrush | undefined, fallback: BrushIndex): BrushIndex {
    if (!brush || brush === "default") return fallback;
    return BRUSH_INDEX[brush];
}

export function resolveStrokeBrush(brush: PerformanceBrush | undefined, fallback: StrokeBrushIndex): StrokeBrushIndex {
    switch (brush) {
        case "petal":
        case "note":
            return 3; // stroke_calligraphy
        case "shard":
        case "spark":
            return 2; // stroke_comet
        case "ring":
            return 1; // stroke_laser
        case "mote":
        case "star":
        case "snow":
            return 0; // stroke_silk
        default:
            return fallback;
    }
}

export function motionFactors(motion: PerformanceMotion | undefined): {
    dir: 1 | -1;
    speed: number;
    spread: number;
    energy: number;
} {
    switch (motion) {
        case "reverse":
            return { dir: -1, speed: 1, spread: 1, energy: 1 };
        case "intense":
            return { dir: 1, speed: 1.38, spread: 1.18, energy: 1.28 };
        case "gentle":
            return { dir: 1, speed: 0.68, spread: 0.88, energy: 0.78 };
        default:
            return { dir: 1, speed: 1, spread: 1, energy: 1 };
    }
}

export function rgbToHex(r: number, g: number, b: number): string {
    const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function hexToUnitRgb(hex: string): { red: number; green: number; blue: number } {
    const [r, g, b] = parsePerformanceRgb(hex);
    return { red: r / 255, green: g / 255, blue: b / 255 };
}

export function blendHex(fromHex: string, toHex: string, t: number): string {
    const [r1, g1, b1] = parsePerformanceRgb(fromHex);
    const [r2, g2, b2] = parsePerformanceRgb(toHex);
    const u = clampUnit(t);
    return rgbToHex(mix(r1, r2, u), mix(g1, g2, u), mix(b1, b2, u));
}

export function deriveAccentHex(hex: string, amount = 0.34): string {
    const [r, g, b] = parsePerformanceRgb(hex);
    const warm = r > b + 20;
    return rgbToHex(
        mix(r, warm ? 255 : 220, amount),
        mix(g, warm ? 242 : 244, amount),
        mix(b, warm ? 205 : 255, amount),
    );
}

export function pitchGradientHex(color: string, color2: string, midi: number): string {
    return blendHex(color, color2, (midi - 21) / 87);
}

export function colorVars(color: string, color2: string, opacity: number) {
    const c1 = hexToUnitRgb(color);
    const c2 = hexToUnitRgb(color2);
    return {
        red: c1.red,
        green: c1.green,
        blue: c1.blue,
        red2: c2.red,
        green2: c2.green,
        blue2: c2.blue,
        opacity: clampUnit(opacity),
    };
}

type KeyBox = readonly (readonly [number, number, number, number, number, number, number, number, number])[];

function buildKeyOrigins(keys: KeyBox) {
    const origins = new Map<number, [number, number, number]>();
    // Authored key boxes use the opposite horizontal axis to the stage frame.
    for (const [midi, x, , z, X, y, Z] of keys) {
        if (!origins.has(midi)) origins.set(midi, [-(x + X) / 32, y / 16 + 0.012, (z + Z) / 32]);
    }
    return origins;
}

const grandKeys = buildKeyOrigins(GRAND_KEY_HITBOXES);
const uprightKeys = buildKeyOrigins(KEY_HITBOXES);

export function keyOriginFor(midi: number, definition?: InstrumentDefinition): Point3 | undefined {
    const table = definition === grandDefinition ? grandKeys : uprightKeys;
    const raw = table.get(midi);
    if (!raw) return undefined;
    const stage = vfxStageFrame(definition);
    return [raw[0], raw[1], raw[2] - stage.centerZ];
}

function directionBetween(from: Point3, to: Point3): Point3 {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    return [dx / length, dy / length, dz / length];
}

/** Centripetal Catmull-Rom; uneven control spacing avoids cusps. */
export function catmullRom(points: readonly Point3[], samples = 20): Point3[] {
    const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];
    const lerpPoint = (a: Point3, b: Point3, t: number, from: number, to: number): Point3 => {
        const span = to - from || 1e-4;
        const u = (t - from) / span;
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    };
    const result: Point3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = at(i - 1);
        const p1 = at(i);
        const p2 = at(i + 1);
        const p3 = at(i + 2);
        const t0 = 0;
        const t1 = t0 + Math.max(1e-3, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) ** 0.5);
        const t2 = t1 + Math.max(1e-3, Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) ** 0.5);
        const t3 = t2 + Math.max(1e-3, Math.hypot(p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2]) ** 0.5);
        for (let sample = 0; sample < samples; sample++) {
            const t = t1 + ((t2 - t1) * sample) / samples;
            const a1 = lerpPoint(p0, p1, t, t0, t1);
            const a2 = lerpPoint(p1, p2, t, t1, t2);
            const a3 = lerpPoint(p2, p3, t, t2, t3);
            const b1 = lerpPoint(a1, a2, t, t0, t2);
            const b2 = lerpPoint(a2, a3, t, t1, t3);
            result.push(lerpPoint(b1, b2, t, t1, t2));
        }
    }
    result.push(points[points.length - 1]);
    return result;
}

/** Sample a polyline into evenly spaced segments with tangents. */
export function segmentsAlong(points: readonly Point3[], count: number): Segment3[] {
    if (points.length < 2 || count <= 0) return [];
    const lengths = points.slice(1).map((point, index) =>
        Math.hypot(point[0] - points[index][0], point[1] - points[index][1], point[2] - points[index][2]),
    );
    const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
    const spacing = total / count;
    const segments: { point: Point3; tangent: Point3; spacing: number; u: number }[] = [];
    let index = 0;
    let start = 0;
    for (let sample = 0; sample < count; sample++) {
        const target = spacing * (sample + 0.5);
        while (index < lengths.length - 1 && start + lengths[index] < target) {
            start += lengths[index++];
        }
        const t = Math.min(1, Math.max(0, (target - start) / (lengths[index] || 1)));
        const a = points[index];
        const b = points[index + 1];
        segments.push({
            point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
            tangent: [1, 0, 0],
            spacing,
            u: count > 1 ? sample / (count - 1) : 0.5,
        });
    }
    for (let sample = 0; sample < count; sample++) {
        segments[sample].tangent = sample === count - 1 && count > 1
            ? segments[sample - 1].tangent
            : count === 1
                ? directionBetween(points[0], points[points.length - 1])
                : directionBetween(segments[sample].point, segments[sample + 1].point);
    }
    return segments;
}

export function sampleCircle(radius: number, y: number, count: number, depthRatio = 0.9, phaseDeg = 0): Point3[] {
    const start = (phaseDeg * Math.PI) / 180;
    return Array.from({ length: count + 1 }, (_, i) => {
        const a = start + (i / count) * Math.PI * 2;
        return [radius * Math.cos(a), y, radius * depthRatio * Math.sin(a)];
    });
}

export function sampleHelix(
    radius: number,
    yStart: number,
    yEnd: number,
    turns: number,
    count: number,
    phaseDeg = 0,
    depthRatio = 0.9,
): Point3[] {
    const start = (phaseDeg * Math.PI) / 180;
    return Array.from({ length: count }, (_, i) => {
        const u = count > 1 ? i / (count - 1) : 0;
        const a = start + u * turns * Math.PI * 2;
        return [radius * Math.cos(a), mix(yStart, yEnd, u), radius * depthRatio * Math.sin(a)];
    });
}

export function sampleLissajous(
    rx: number,
    ry: number,
    rz: number,
    yCenter: number,
    fx: number,
    fy: number,
    fz: number,
    phaseDeg: number,
    count: number,
): Point3[] {
    const shift = (phaseDeg * Math.PI) / 180;
    return Array.from({ length: count + 1 }, (_, i) => {
        const t = (i / count) * Math.PI * 2;
        return [
            rx * Math.sin(fx * t + shift),
            yCenter + ry * Math.sin(fy * t + shift * 0.5),
            rz * Math.cos(fz * t - shift * 0.7),
        ];
    });
}

export function sampleRose(
    radius: number,
    petals: number,
    y: number,
    count: number,
    phaseDeg = 0,
    depthRatio = 0.9,
): Point3[] {
    const shift = (phaseDeg * Math.PI) / 180;
    return Array.from({ length: count + 1 }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const r = radius * (0.45 + 0.55 * Math.abs(Math.cos(petals * (a - shift) * 0.5)));
        return [r * Math.cos(a), y, r * depthRatio * Math.sin(a)];
    });
}

export function sampleStarPolygon(
    radius: number,
    vertices: number,
    y: number,
    rotationDeg = 0,
    depthRatio = 0.9,
): Point3[] {
    const base = (rotationDeg * Math.PI) / 180;
    return Array.from({ length: vertices }, (_, i) => {
        const a = base + (i / vertices) * Math.PI * 2;
        return [radius * Math.cos(a), y, radius * depthRatio * Math.sin(a)];
    });
}

export function sampleWingPair(
    side: 1 | -1,
    radius: number,
    height: number,
    spread: number,
    yOffset = 0,
): Point3[] {
    const s = side;
    const points: Point3[] = [
        [s * (1.10 * radius), 0.38 + 0.36 * height + yOffset, -0.50 - 0.34 * spread],
        [s * (1.92 * radius), 1.05 + 0.62 * height + yOffset, 0.35 + 0.30 * spread],
        [s * (1.35 * radius), 1.70 + 0.52 * height + yOffset, 1.05 + 0.30 * spread],
        [s * (0.25 * radius), 1.90 + 0.38 * height + yOffset, 1.30 + 0.25 * spread],
        [-s * (0.85 * radius), 1.54 + 0.34 * height + yOffset, 1.00 + 0.25 * spread],
        [-s * (1.58 * radius), 0.86 + 0.28 * height + yOffset, 0.16 - 0.08 * spread],
    ];
    return catmullRom(points, 16);
}

export function sampleArch(width: number, height: number, z: number, yBase: number, count: number): Point3[] {
    return Array.from({ length: count }, (_, i) => {
        const u = count > 1 ? i / (count - 1) : 0.5;
        const angle = Math.PI * (1 - u);
        return [width * Math.cos(angle), yBase + height * Math.sin(angle), z];
    });
}

export interface DrawPointsSpec {
    count: number;
    life: number;
    lifeJitter?: number;
    brush: BrushIndex;
    color: string;
    color2?: string;
    opacity: number;
    scale?: number;
    offset?: Point3;
    size?: number;
    sizeEnd?: number;
    sizeJitter?: number;
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

export function drawPoints(spec: DrawPointsSpec): VfxEmitter {
    const [ox, oy, oz] = spec.offset ?? [0, 0, 0];
    const [sx, sy, sz] = spec.spread ?? [0, 0, 0];
    const [vx, vy, vz] = spec.velocity ?? [0, 0, 0];
    const [ax, ay, az] = spec.accel ?? [0, 0, 0];
    const size = spec.size ?? 0.08;
    return {
        effect: "field",
        particle: "draw_point",
        offset: { x: ox, y: oy, z: oz },
        particles: spec.count,
        lifetime: spec.life * (1 + (spec.lifeJitter ?? 0.2)),
        transform: { scale: spec.scale ?? 1 },
        variables: {
            count: spec.count,
            life: spec.life,
            life_jitter: spec.lifeJitter ?? 0.2,
            brush: spec.brush,
            ...colorVars(spec.color, spec.color2 ?? spec.color, spec.opacity),
            size,
            size_end: spec.sizeEnd ?? size,
            size_jitter: spec.sizeJitter ?? 0.22,
            spin: spec.spin ?? 0,
            spin_jitter: spec.spinJitter ?? 0,
            spin_rate: spec.spinRate ?? 0,
            phase: spec.phase ?? 0,
            phase_spread: spec.phaseSpread ?? 360,
            omega: spec.omega ?? 0,
            radius: spec.radius ?? 0,
            radius_end: spec.radiusEnd ?? spec.radius ?? 0,
            curve: spec.curve ?? 1,
            radial_jitter: spec.radialJitter ?? 0,
            depth_ratio: spec.depthRatio ?? 0.9,
            tilt: spec.tilt ?? 0,
            rise: spec.rise ?? 0,
            flutter: spec.flutter ?? 0,
            spread_x: sx,
            spread_y: sy,
            spread_z: sz,
            vx, vy, vz,
            ax, ay, az,
            fade_in: spec.fadeIn ?? 0.16,
            fade_out: spec.fadeOut ?? 0.35,
            twinkle: spec.twinkle ?? 0,
        },
    };
}

export interface DrawStrokeOptions {
    count: number;
    life: number;
    brush: StrokeBrushIndex;
    color: string;
    color2?: string;
    opacity: number;
    width: number;
    scale?: number;
    overlap?: number;
    travel?: number;
    velocity?: Point3;
    accel?: Point3;
    fadeIn?: number;
    fadeOut?: number;
    taperEnds?: boolean;
}

export function drawStrokeSegments(points: readonly Point3[], opts: DrawStrokeOptions): VfxEmitter[] {
    const segments = segmentsAlong(points, opts.count);
    const scale = opts.scale ?? 1;
    const overlap = opts.overlap ?? 1.45;
    const travel = opts.travel ?? 0;
    const [bvx, bvy, bvz] = opts.velocity ?? [0, 0, 0];
    const [ax, ay, az] = opts.accel ?? [0, 0, 0];
    const color2 = opts.color2 ?? opts.color;
    return segments.map(({ point, tangent, spacing, u }, index) => {
        const edge = opts.taperEnds === false
            ? 1
            : Math.min(1, (index + 0.5) / 2.6, (segments.length - 0.5 - index) / 2.6);
        const segColor = blendHex(opts.color, color2, u);
        const segNext = blendHex(opts.color, color2, Math.min(1, u + 0.12));
        const len = spacing * overlap;
        return {
            effect: "beam",
            particle: "draw_stroke",
            offset: { x: point[0], y: point[1], z: point[2] },
            particles: 1,
            lifetime: opts.life,
            transform: { scale },
            variables: {
                count: 1,
                life: opts.life,
                brush: opts.brush,
                length: len,
                length_end: len,
                width: opts.width,
                vx: bvx + tangent[0] * travel,
                vy: bvy + tangent[1] * travel,
                vz: bvz + tangent[2] * travel,
                ax, ay, az,
                tx: tangent[0],
                ty: tangent[1],
                tz: tangent[2],
                ...colorVars(segColor, segNext, opts.opacity * edge),
                fade_in: opts.fadeIn ?? 0.14,
                fade_out: opts.fadeOut ?? 0.32,
            },
        };
    });
}

export function drawPolygonFrame(
    vertices: readonly Point3[],
    opts: Omit<DrawStrokeOptions, "count"> & { closed?: boolean },
): VfxEmitter[] {
    const edges = opts.closed === false ? vertices.length - 1 : vertices.length;
    if (edges <= 0) return [];
    const scale = opts.scale ?? 1;
    const overlap = opts.overlap ?? 1.06;
    const [vx, vy, vz] = opts.velocity ?? [0, 0, 0];
    const [ax, ay, az] = opts.accel ?? [0, 0, 0];
    const color2 = opts.color2 ?? opts.color;
    const emitters: VfxEmitter[] = [];
    for (let i = 0; i < edges; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const dist = Math.hypot(dx, dy, dz) || 0.01;
        const u = edges > 1 ? i / edges : 0;
        const c = blendHex(opts.color, color2, u);
        emitters.push({
            effect: "beam",
            particle: "draw_stroke",
            offset: { x: (a[0] + b[0]) * 0.5, y: (a[1] + b[1]) * 0.5, z: (a[2] + b[2]) * 0.5 },
            particles: 1,
            lifetime: opts.life,
            transform: { scale },
            variables: {
                count: 1,
                life: opts.life,
                brush: opts.brush,
                length: dist * overlap,
                length_end: dist * overlap,
                width: opts.width,
                vx, vy, vz,
                ax, ay, az,
                tx: dx / dist,
                ty: dy / dist,
                tz: dz / dist,
                ...colorVars(c, color2, opts.opacity),
                fade_in: opts.fadeIn ?? 0.14,
                fade_out: opts.fadeOut ?? 0.32,
            },
        });
    }
    return emitters;
}

export interface DrawPlaneSpec {
    life: number;
    color: string;
    color2?: string;
    opacity: number;
    scale?: number;
    offset?: Point3;
    radiusStart: number;
    radiusEnd: number;
    curve?: number;
    vy?: number;
    spin?: number;
    spinRate?: number;
    style?: 0 | 1;
    fadeIn?: number;
    fadeOut?: number;
}

export function drawGroundRing(spec: DrawPlaneSpec): VfxEmitter {
    const [x, y, z] = spec.offset ?? [0, 0.08, 0];
    return {
        effect: "ripple",
        particle: "draw_plane",
        offset: { x, y, z },
        particles: 1,
        lifetime: spec.life,
        transform: { scale: spec.scale ?? 1 },
        variables: {
            life: spec.life,
            radius_start: spec.radiusStart,
            radius_end: spec.radiusEnd,
            curve: spec.curve ?? 0.7,
            vy: spec.vy ?? 0,
            spin: spec.spin ?? 0,
            spin_rate: spec.spinRate ?? 0,
            style: spec.style ?? 0,
            ...colorVars(spec.color, spec.color2 ?? spec.color, spec.opacity),
            fade_in: spec.fadeIn ?? 0.12,
            fade_out: spec.fadeOut ?? 0.55,
        },
    };
}

type CinemaParticle = Extract<VfxParticle, `cinema_${string}`>;
const CINEMA_GROUPS: Readonly<Record<CinemaParticle, VfxEmitter["effect"]>> = {
    cinema_dust: "field",
    cinema_filament: "orbit",
    cinema_sweep: "ripple",
    cinema_note: "fountain",
    cinema_shock: "ripple",
};

export function cinemaEmitter(
    particle: CinemaParticle,
    particles: number,
    lifetime: number,
    variables: Record<string, number>,
    transform?: VfxEmitter["transform"],
    offset: VfxEmitter["offset"] = { x: 0, y: 0, z: 0 },
): VfxEmitter {
    return {
        particle,
        effect: CINEMA_GROUPS[particle],
        particles,
        lifetime,
        variables: { ...variables, count: particles, life: lifetime },
        offset,
        transform,
    };
}
