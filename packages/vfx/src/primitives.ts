import {
    POINT_BRUSH_INDEX, STROKE_BRUSH_INDEX, resolvePointBrush, resolveStrokeBrush,
    type PointBrushId, type StrokeBrushId,
} from "./brushes";
import { blendHex, colorVars, hexToUnitRgb } from "./color";
import { segmentsAlong, type Point3 } from "./geometry";
import { getStageLightLayout, getStageVeilLayout, type VfxLightLayout, type VfxVeilLayout } from "./stage";
import type { VfxEmitter, VfxTransform } from "./types";

export interface DrawPointsSpec {
    group?: string;
    count: number;
    life: number;
    lifeJitter?: number;
    brush: PointBrushId | number;
    color: string;
    color2?: string;
    opacity: number;
    scale?: number;
    offset?: Point3;
    transform?: VfxTransform;
    size?: number;
    sizeEnd?: number;
    sizeJitter?: number;
    /** Height multiplier for non-square point billboards. */
    aspect?: number;
    /** >0.5 mixes each particle between color and color2 instead of ageing the tint. */
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

export function drawPoints(spec: DrawPointsSpec): VfxEmitter {
    const [ox, oy, oz] = spec.offset ?? [0, 0, 0];
    const [sx, sy, sz] = spec.spread ?? [0, 0, 0];
    const [vx, vy, vz] = spec.velocity ?? [0, 0, 0];
    const [ax, ay, az] = spec.accel ?? [0, 0, 0];
    const size = spec.size ?? 0.08;
    const brushIndex = typeof spec.brush === "number" ? spec.brush : POINT_BRUSH_INDEX[spec.brush];
    return {
        particle: "draw_point",
        group: spec.group ?? "field",
        offset: { x: ox, y: oy, z: oz },
        particles: spec.count,
        lifetime: spec.life * (1 + (spec.lifeJitter ?? 0.2)),
        transform: spec.transform ?? { scale: spec.scale ?? 1 },
        variables: {
            count: spec.count,
            life: spec.life,
            life_jitter: spec.lifeJitter ?? 0.2,
            brush: brushIndex,
            ...colorVars(spec.color, spec.color2 ?? spec.color, spec.opacity),
            size,
            size_end: spec.sizeEnd ?? size,
            size_jitter: spec.sizeJitter ?? 0.22,
            aspect: spec.aspect ?? 1,
            color_random: spec.colorRandom ?? 0,
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
    group?: string;
    count: number;
    life: number;
    brush: StrokeBrushId | number;
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
    const brushIndex = typeof opts.brush === "number" ? opts.brush : STROKE_BRUSH_INDEX[opts.brush];
    return segments.map(({ point, tangent, spacing, u }, index) => {
        const edge = opts.taperEnds === false
            ? 1
            : Math.min(1, (index + 0.5) / 2.6, (segments.length - 0.5 - index) / 2.6);
        const segColor = blendHex(opts.color, color2, u);
        const segNext = blendHex(opts.color, color2, Math.min(1, u + 0.12));
        const len = spacing * overlap;
        return {
            particle: "draw_stroke",
            group: opts.group ?? "beam",
            offset: { x: point[0], y: point[1], z: point[2] },
            particles: 1,
            lifetime: opts.life,
            transform: { scale },
            variables: {
                count: 1,
                life: opts.life,
                brush: brushIndex,
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
    const brushIndex = typeof opts.brush === "number" ? opts.brush : STROKE_BRUSH_INDEX[opts.brush];
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
            particle: "draw_stroke",
            group: opts.group ?? "beam",
            offset: { x: (a[0] + b[0]) * 0.5, y: (a[1] + b[1]) * 0.5, z: (a[2] + b[2]) * 0.5 },
            particles: 1,
            lifetime: opts.life,
            transform: { scale },
            variables: {
                count: 1,
                life: opts.life,
                brush: brushIndex,
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
    group?: string;
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
        particle: "draw_plane",
        group: spec.group ?? "ripple",
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

export interface DrawCloudSpec {
    count: number;
    life: number;
    lifeJitter?: number;
    color: string;
    color2?: string;
    opacity: number;
    scale?: number;
    offset: Point3;
    size: number;
    sizeEnd?: number;
    sizeJitter?: number;
    spin?: number;
    spinJitter?: number;
    spinRate?: number;
    spread?: Point3;
    velocity?: Point3;
    fadeIn?: number;
    fadeOut?: number;
}

export function drawCloud(spec: DrawCloudSpec): VfxEmitter {
    const [sx, sy, sz] = spec.spread ?? [0, 0, 0];
    const [vx, vy, vz] = spec.velocity ?? [0, 0, 0];
    return {
        particle: "draw_cloud",
        group: "curtain",
        offset: { x: spec.offset[0], y: spec.offset[1], z: spec.offset[2] },
        particles: spec.count,
        lifetime: spec.life,
        transform: { scale: spec.scale ?? 1 },
        variables: {
            count: spec.count,
            life: spec.life,
            life_jitter: spec.lifeJitter ?? 0.16,
            size: spec.size,
            size_end: spec.sizeEnd ?? spec.size * 1.24,
            size_jitter: spec.sizeJitter ?? 0.22,
            spin: spec.spin ?? 0,
            spin_jitter: spec.spinJitter ?? 10,
            spin_rate: spec.spinRate ?? 0,
            spread_x: sx,
            spread_y: sy,
            spread_z: sz,
            vx, vy, vz,
            ...colorVars(spec.color, spec.color2 ?? spec.color, spec.opacity),
            fade_in: spec.fadeIn ?? 0.95,
            fade_out: spec.fadeOut ?? 1.25,
        },
    };
}

export interface DrawCometSpec {
    offset: Point3;
    life: number;
    length: number;
    lengthEnd?: number;
    width: number;
    direction: Point3;
    velocity: Point3;
    accel?: Point3;
    color: string;
    color2?: string;
    opacity: number;
    scale?: number;
    fadeIn?: number;
    fadeOut?: number;
}

export function drawComet(spec: DrawCometSpec): VfxEmitter {
    const [ax, ay, az] = spec.accel ?? [0, 0, 0];
    return {
        particle: "draw_comet",
        group: "beam",
        offset: { x: spec.offset[0], y: spec.offset[1], z: spec.offset[2] },
        particles: 1,
        lifetime: spec.life,
        transform: { scale: spec.scale ?? 1 },
        variables: {
            count: 1,
            life: spec.life,
            length: spec.length,
            length_end: spec.lengthEnd ?? spec.length,
            width: spec.width,
            vx: spec.velocity[0],
            vy: spec.velocity[1],
            vz: spec.velocity[2],
            ax, ay, az,
            tx: spec.direction[0],
            ty: spec.direction[1],
            tz: spec.direction[2],
            ...colorVars(spec.color, spec.color2 ?? spec.color, spec.opacity),
            fade_in: spec.fadeIn ?? 0.1,
            fade_out: spec.fadeOut ?? 0.5,
        },
    };
}

export function drawField(opts: {
    color: string;
    opacity: number;
    rate?: number;
    seconds?: number;
    range?: number;
    size?: number;
    speed?: number;
    height?: number;
    density?: number;
    scale?: number;
}): VfxEmitter {
    const spawnRate = Math.round((opts.rate ?? 10) * (opts.density ?? 1));
    const maxParticles = Math.min(40, Math.ceil(spawnRate * 3.2));
    const seconds = opts.seconds ?? 1.7;
    return {
        particle: "field",
        group: "field",
        offset: { x: 0, y: 0, z: 0 },
        particles: maxParticles,
        lifetime: seconds + 3.2,
        transform: { scale: opts.scale ?? 1 },
        variables: {
            ...hexToUnitRgb(opts.color),
            opacity: opts.opacity,
            range: opts.range ?? 1,
            size: opts.size ?? 1,
            speed: opts.speed ?? 1,
            height: opts.height ?? 0,
            rate: spawnRate,
            max_particles: maxParticles,
            active: seconds,
        },
    };
}

export function drawWave(opts: {
    color: string;
    opacity: number;
    amplitude: number;
    previousAmplitude?: number;
    life?: number;
    range?: number;
    density?: number;
    wavelength?: number;
    period?: number;
    speed?: number;
    height?: number;
    size?: number;
    phase?: number;
    scale?: number;
}): VfxEmitter[] {
    const range = opts.range ?? 1;
    const columns = 2 * Math.round(18 * Math.max(0.76, opts.density ?? 1));
    const circumference = 12.8 * range;
    const cycles = Math.max(1, Math.round(circumference / (opts.wavelength ?? 5.2)));
    const step = circumference / columns;
    const angularSpeed = (360 / (opts.period ?? 2.9)) * (opts.speed ?? 1);
    const life = opts.life ?? 2.35;
    const rgb = hexToUnitRgb(opts.color);
    const emitters: VfxEmitter[] = [];
    for (let column = 0; column < columns; column++) {
        const azimuth = (column / columns) * 2 * Math.PI;
        const innerSample = column % 3 === 0;
        for (const layer of innerSample ? [-1, 0, 1] : [0]) {
            const angle = (360 * cycles * column) / columns + layer * 37 + (opts.phase ?? 0);
            const radius = (2.21 + 0.23 * layer) * range;
            emitters.push({
                particle: "wave",
                group: "wave",
                offset: {
                    x: radius * Math.cos(azimuth),
                    y: 1.19 + (opts.height ?? 0) + layer * 0.18,
                    z: 0.88 * radius * Math.sin(azimuth),
                },
                lifetime: life,
                particles: 1,
                transform: { scale: opts.scale ?? 1 },
                variables: {
                    ...rgb,
                    opacity: opts.opacity * (layer === 0 ? 0.51 : layer === -1 ? 0.19 : 0.15),
                    phase: angle,
                    angular_speed: angularSpeed,
                    amplitude: opts.amplitude,
                    previous_amplitude: opts.previousAmplitude ?? opts.amplitude,
                    radius: Math.min(0.16, step * (layer === 0 ? 0.53 : 0.43)) * (opts.size ?? 1),
                    life,
                },
            });
        }
    }
    return emitters;
}

export function drawBeam(opts: {
    color: string;
    opacity: number;
    lanes?: number;
    segments?: number;
    heading?: number;
    bend?: number;
    range?: number;
    speed?: number;
    length?: number;
    width?: number;
    size?: number;
    height?: number;
    previousHeight?: number;
    silk?: boolean;
    burst?: boolean;
    transform?: VfxTransform;
}): VfxEmitter[] {
    const range = opts.range ?? 1;
    const life = Math.min(6.4, 2.7 / Math.max(0.25, opts.speed ?? 1));
    const lanes = opts.lanes ?? 1;
    const segments = opts.segments ?? 2;
    const around = opts.heading === undefined && opts.bend !== 0;
    const silk = opts.silk ?? true;
    const burst = opts.burst ?? false;
    const rgb = hexToUnitRgb(opts.color);
    const height = opts.height ?? 0;
    const previousHeight = opts.previousHeight ?? height;
    const emitters: VfxEmitter[] = [];
    for (let lane = 0; lane < lanes; lane++) {
        const side = lane - (lanes - 1) / 2;
        const heading = ((opts.heading ?? (burst ? 90 : 0)) + side * (burst ? 24 : 7)) * Math.PI / 180;
        const reverse = !burst && lane % 2 === 1 ? -1 : 1;
        for (let segment = 0; segment < segments; segment++) {
            const delay = Math.round((lane * (burst ? 0.05 : 0.18) + segment * 0.105) * 20);
            emitters.push({
                particle: "beam",
                group: "beam",
                offset: { x: 0, y: 1.65 + height + side * 0.15, z: 0 },
                lifetime: life + delay / 20,
                particles: 1,
                transform: opts.transform,
                variables: {
                    ...rgb,
                    opacity: opts.opacity * [1, 0.52, 0.24][segment],
                    dir_x: reverse * Math.cos(heading),
                    dir_z: reverse * Math.sin(heading),
                    span: (burst ? 2.75 : 4.8) * range,
                    start: burst ? 0 : -2.4 * range,
                    bend: (opts.bend ?? 0.56) * reverse,
                    length: (opts.length ?? 1.36) * [1, 0.8, 0.55][segment],
                    width: (opts.width ?? 0.24) * (opts.size ?? 1) * (silk ? 2.2 : 1),
                    silk: Number(silk),
                    life,
                    delay: delay / 20,
                    height_delta: previousHeight - height,
                    around: around ? 1 : 0,
                    arc_phase: 35 + (360 / lanes) * lane,
                    arc_sweep: (burst ? 136 : 212) * reverse,
                    arc_radius: (2.48 + side * 0.09) * range,
                },
            });
        }
    }
    return emitters;
}

export function drawCurtain(opts: {
    layout: VfxVeilLayout;
    color: string;
    opacity: number;
    length: number;
    previousLength?: number;
    width?: number;
    speed?: number;
    range?: number;
    yOffset?: number;
    zOffset?: number;
    phase?: number;
    scale?: number;
}): VfxEmitter[] {
    const range = opts.range ?? 1;
    const previous = opts.previousLength ?? opts.length;
    const life = opts.layout === "aurora" ? 2.4 : 1.8;
    const rgb = hexToUnitRgb(opts.color);
    return getStageVeilLayout(opts.layout).map(anchor => ({
        particle: "curtain",
        group: "curtain",
        offset: {
            x: anchor.origin.x * range,
            y: anchor.origin.y + (opts.yOffset ?? 0),
            z: anchor.origin.z * range,
        },
        particles: 1,
        lifetime: life,
        transform: { z: opts.zOffset ?? 0, scale: opts.scale ?? 1 },
        variables: {
            ...rgb,
            opacity: opts.opacity * anchor.gain,
            life,
            phase: anchor.phase + (opts.phase ?? 0),
            speed: opts.speed ?? 1,
            length: opts.length * anchor.rise,
            previous_length: previous * anchor.rise,
            width: (opts.width ?? 0.25) * anchor.span,
            sheet: opts.layout === "aurora" ? 1 : 2,
            roll: anchor.roll,
        },
    }));
}

export function drawShaft(opts: {
    layout: VfxLightLayout;
    color: string;
    opacity: number;
    length: number;
    previousLength?: number;
    width?: number;
    range?: number;
    yOffset?: number;
    zOffset?: number;
    scale?: number;
}): VfxEmitter[] {
    const range = opts.range ?? 1;
    const previousLength = opts.previousLength ?? opts.length;
    const life = 1.6;
    const upright = opts.layout === "neon-sides" || opts.layout === "neon-rear";
    const haze = opts.layout === "fan";
    const rgb = hexToUnitRgb(opts.color);
    return getStageLightLayout(opts.layout).map(anchor => {
        const { x, y, z } = anchor.direction;
        const magnitude = Math.hypot(x, y, z) || 1;
        return {
            particle: upright ? "shaft_upright" : "shaft",
            group: "shaft",
            offset: {
                x: anchor.origin.x * range,
                y: anchor.origin.y + (opts.yOffset ?? 0),
                z: anchor.origin.z * range,
            },
            particles: 1,
            lifetime: life,
            transform: { z: opts.zOffset ?? 0, scale: opts.scale ?? 1 },
            variables: {
                ...rgb,
                opacity: opts.opacity * anchor.gain,
                life,
                length: opts.length * anchor.length,
                previous_length: previousLength * anchor.length,
                width: (opts.width ?? 0.21) * anchor.width * (haze ? 2.65 : opts.layout === "rails" ? 1.4 : 1),
                shaft_style: opts.layout === "truss" ? 2 : Number(haze),
                dir_x: x / magnitude,
                dir_y: y / magnitude,
                dir_z: z / magnitude,
            },
        };
    });
}

export function drawFountain(opts: {
    color: string;
    opacity: number;
    count?: number;
    speed?: number;
    size?: number;
    range?: number;
    yOffset?: number;
    zOffset?: number;
    scale?: number;
}): VfxEmitter[] {
    const life = 1.15;
    const count = opts.count ?? 8;
    const rgb = hexToUnitRgb(opts.color);
    return [-1, 1].map(side => ({
        particle: "fountain",
        group: "fountain",
        offset: {
            x: side * 1.88 * (opts.range ?? 1),
            y: 0.32 + (opts.yOffset ?? 0),
            z: -0.18,
        },
        lifetime: life + 0.25,
        particles: count,
        transform: { z: opts.zOffset ?? 0, scale: opts.scale ?? 1 },
        variables: {
            ...rgb,
            opacity: opts.opacity,
            count,
            life,
            side,
            speed: opts.speed ?? 1,
            size: opts.size ?? 1,
        },
    }));
}

export function drawShards(opts: {
    color: string;
    opacity: number;
    count?: number;
    speed?: number;
    flow?: number;
    range?: number;
    size?: number;
    yOffset?: number;
    scale?: number;
}): VfxEmitter[] {
    const count = opts.count ?? 4;
    const speed = opts.speed ?? 1;
    const rgb = hexToUnitRgb(opts.color);
    return [-1, 1].flatMap(side => [
        { x: 1.25, y: 1.35, z: -0.72 },
        { x: 1.68, y: 0.82, z: 0.30 },
        { x: 1.05, y: 1.91, z: 1.22 },
    ].map(({ x, y, z }, index) => ({
        particle: "shard",
        group: "shard",
        offset: { x: side * x, y: y + (opts.yOffset ?? 0), z: z + 0.20 * side },
        particles: count,
        lifetime: 0.10 + 1.83 / speed,
        transform: { scale: opts.scale ?? 1 },
        variables: {
            ...rgb,
            opacity: opts.opacity * [0.76, 1, 0.92][index],
            side,
            count,
            speed,
            flow: opts.flow ?? 1,
            range: opts.range ?? 1,
            size: opts.size ?? 1,
        },
    })));
}

export function drawDust(opts: {
    color: string;
    opacity: number;
    count: number;
    life: number;
    phase: number;
    release: number;
    radius: number;
    coherence: number;
    bright: number;
    scale?: number;
}): VfxEmitter {
    return {
        particle: "dust",
        group: "field",
        offset: { x: 0, y: 0, z: 0 },
        particles: opts.count,
        lifetime: opts.life,
        transform: { scale: opts.scale ?? 1 },
        variables: {
            ...hexToUnitRgb(opts.color),
            opacity: opts.opacity,
            count: opts.count,
            life: opts.life,
            phase: opts.phase,
            release: opts.release,
            radius: opts.radius,
            coherence: opts.coherence,
            bright: opts.bright,
        },
    };
}

export function drawShock(opts: {
    color: string;
    opacity: number;
    count: number;
    life: number;
    strength: number;
    phase: number;
    y?: number;
    scale?: number;
}): VfxEmitter {
    return {
        particle: "shock",
        group: "ripple",
        offset: { x: 0, y: 0, z: 0 },
        particles: opts.count,
        lifetime: opts.life,
        transform: { y: opts.y ?? 0.08, scale: opts.scale ?? 1 },
        variables: {
            ...hexToUnitRgb(opts.color),
            opacity: opts.opacity,
            count: opts.count,
            life: opts.life,
            strength: opts.strength,
            phase: opts.phase,
        },
    };
}

export { resolvePointBrush, resolveStrokeBrush };
