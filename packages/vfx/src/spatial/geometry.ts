import type { PerformanceMotion, PerformanceZone } from "@piano/core";
import { mix, type VfxKeyNote } from "../runtime/music";

export type Point3 = readonly [number, number, number];
export type Segment3 = { point: Point3; tangent: Point3; spacing: number; u: number };

export const ZONE_Y_OFFSET: Readonly<Record<PerformanceZone, number>> = {
    stage: 0,
    low: -0.45,
    mid: 0.25,
    high: 1.15,
};

export function zoneBaseY(zone: PerformanceZone | undefined, base: number, floorMin = 0.06): number {
    return Math.max(floorMin, base + ZONE_Y_OFFSET[zone ?? "stage"]);
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

export function pickRecentKeys(
    recentNotes: readonly VfxKeyNote[] | undefined,
    lastNoteTick: number,
    phase: number,
    solo: boolean,
    maxCount: number,
): VfxKeyNote[] {
    const fresh = (recentNotes ?? []).filter(note => note.tick > lastNoteTick).sort((a, b) => a.midi - b.midi);
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

function directionBetween(from: Point3, to: Point3): Point3 {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    return [dx / length, dy / length, dz / length];
}

/** 向心 Catmull-Rom 样条采样，避免非均匀控制点产生尖点。 */
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

/** 等距切分折线并计算切线方向。 */
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
