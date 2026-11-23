import {
    catmullRom, clampUnit, colorVars, drawPolygonFrame, drawStrokeSegments, mix,
    type DrawStrokeOptions, type Point3, type VfxEmitter,
} from "@piano/vfx";

const TAU = Math.PI * 2;
const BASE_Y = 1.6;
const HEIGHT = 3.55;
const CENTER_X = 1.32;
const CENTER_Z = 2.45;
export const PORCELAIN_PROP_OFFSET = { x: CENTER_X, y: BASE_Y, z: CENTER_Z } as const;

// Radius at each normalized height, from the foot through the neck and flared lip.
const PROFILE = catmullRom([
    [0.52, 0, 0], [0.54, 0.035, 0], [0.58, 0.1, 0], [0.73, 0.29, 0],
    [0.96, 0.51, 0], [1.13, 0.67, 0], [1.17, 0.74, 0], [1.03, 0.82, 0],
    [0.64, 0.88, 0], [0.36, 0.91, 0], [0.33, 0.965, 0], [0.41, 1, 0],
], 6);

export function porcelainPoint(height: number, angle: number, lift = 0): Point3 {
    const y = clampUnit(height);
    const next = PROFILE.findIndex(p => p[1] >= y);
    const high = PROFILE[next];
    const low = PROFILE[Math.max(0, next - 1)];
    const radius = mix(low[0], high[0], (y - low[1]) / (high[1] - low[1] || 1)) + lift;
    return [CENTER_X + radius * Math.cos(angle), BASE_Y + y * HEIGHT, CENTER_Z + radius * Math.sin(angle)];
}

export function samplePath(count: number, point: (t: number) => Point3): Point3[] {
    return Array.from({ length: count + 1 }, (_, i) => point(i / count));
}

/** Preserve the host's spacing and tangents, then apply the pack's matte brush and wet-edge spread. */
export function inkStroke(
    path: readonly Point3[],
    options: Omit<DrawStrokeOptions, "brush" | "count"> & { count?: number; drawTime?: number; glow?: boolean },
): VfxEmitter[] {
    const stroke = { ...options, brush: "silk" as const };
    const glazed = options.count === undefined;
    const segments = options.count === undefined
        ? drawPolygonFrame(path, { ...stroke, closed: false })
        : drawStrokeSegments(path, { ...stroke, count: options.count });
    return segments.map((emitter, i, all) => {
        const u = (i + 0.5) / all.length;
        const width = options.width * (glazed ? 1 : mix(1.24, 0.53, u) * (0.86 + 0.14 * Math.sin(Math.PI * u)));
        return {
            ...emitter,
            particle: options.glow ? "chinese_glow" : "chinese_ink",
            variables: {
                ...emitter.variables,
                brush: glazed ? 1 : 0,
                width,
                width_end: width * (glazed ? 0.95 : 1.23),
                delay: u * (options.drawTime ?? 0),
            },
        };
    });
}

export function porcelainRing(height: number, arc: number, turn: number): Point3[] {
    return samplePath(8, t => porcelainPoint(height, turn + Math.PI / 2 + (t - 0.5) * TAU * arc));
}

export function porcelainProfile(angle: number, end = 1): Point3[] {
    // Spend more of the stroke vertices near the lip, neck and sharpest part of the shoulder.
    const heights = [0, 0.035, 0.08, 0.115, 0.16, 0.215, 0.29, 0.41, 0.58, 0.77, 0.94, 1];
    return [...heights.filter(h => h < end), end].map(h => porcelainPoint(1 - h, angle));
}

export function porcelainWash(color: string, opacity: number, scale: number, life: number): VfxEmitter {
    return {
        particle: "chinese_porcelain_wash",
        group: "beam",
        offset: { x: CENTER_X, y: BASE_Y + HEIGHT / 2, z: CENTER_Z },
        particles: 1,
        lifetime: life,
        transform: { scale },
        variables: { life, ...colorVars(color, color, opacity) },
    };
}

const SCROLL_SECTORS = [0.65 - Math.PI, 0.65] as const;
const LOTUSES = [0.32, 0.78] as const;

function vineHeight(t: number, side: number) {
    return 0.53 + side * 0.12 * Math.sin(TAU * t);
}

export function lotusScroll(progress: number, turn: number, ink: Omit<DrawStrokeOptions, "brush" | "count">) {
    const emitters = [];
    for (const [i, start] of SCROLL_SECTORS.entries()) {
        const reach = clampUnit(progress * 1.25 - i * 0.25);
        if (reach < 0.03) continue;
        const side = i === 0 ? 1 : -1;
        const angleAt = (t: number) => turn + start + Math.PI * t;
        const stem = samplePath(30, t => porcelainPoint(vineHeight(t * reach, side), angleAt(t * reach), 0.022));
        emitters.push(...inkStroke(stem, { ...ink, count: Math.ceil(12 * reach), taperEnds: false }));
        for (const [flowerIndex, t] of LOTUSES.entries()) {
            const growth = clampUnit((reach - t) / 0.16);
            if (growth < 0.08) continue;
            const direction = flowerIndex === 0 ? side : -side;
            const angle = angleAt(t);
            const height = vineHeight(t, side);

            const leaf = samplePath(12, s => porcelainPoint(
                height - direction * growth * 0.115 * Math.sin(Math.PI * s),
                angle + growth * (0.32 * s + 0.09 * Math.sin(TAU * s)), 0.035,
            ));
            emitters.push(...inkStroke(leaf, { ...ink, count: 3, width: ink.width * 1.2 }));

            const flowerBase = height + direction * 0.035 * growth;
            const lotus = samplePath(25, s => porcelainPoint(
                flowerBase + direction * growth * Math.sin(Math.PI * s) * (0.052 + 0.054 * Math.abs(Math.sin(3 * Math.PI * s))),
                angle + growth * 0.52 * (s - 0.5), 0.04,
            ));
            emitters.push(...inkStroke(lotus, { ...ink, count: 6, taperEnds: false, width: ink.width * 0.86 }));
        }
    }
    return emitters;
}
