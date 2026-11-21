import { readVarUint, writeVarUint } from "../binary/varint.js";

/** Stable built-in painter IDs (1..255). Keep existing IDs stable across versions. */
export const PERFORMANCE_METHODS = {
    starfield: 1,
    petal_fall: 2,
    firefly_rise: 3,
    aurora_veil: 4,
    wing_curtain: 5,
    wing_ribbons: 6,
    double_helix: 7,
    orbit_halo: 8,
    silk_streams: 9,
    wave_ribbon: 10,
    vortex_column: 11,
    lissajous_weave: 12,
    light_pillars: 13,
    crown_fan: 14,
    stage_truss: 15,
    magic_circle: 16,
    portal_arch: 17,
    key_notes: 18,
    key_fountain: 19,
    key_constellation: 20,
    floor_sweep: 21,
    shockwave: 22,
    prism_rewind: 23,
    firework_bloom: 24,
    key_style: 25,
    hanabi_launch: 26,
    dandelion_drift: 27,
    horizon_glow: 28,
    meteor_shower: 29,
    comet_split: 30,
    musubi_braid: 31,
    twilight_mist: 32,
    starfall_impact: 33,
} as const;
export type PerformanceMethod = keyof typeof PERFORMANCE_METHODS;

export const PERFORMANCE_BRUSHES = {
    default: 0,
    mote: 1,
    star: 2,
    petal: 3,
    snow: 4,
    note: 5,
    shard: 6,
    spark: 7,
    ring: 8,
    blossom: 9,
} as const;
export type PerformanceBrush = keyof typeof PERFORMANCE_BRUSHES;

export const PERFORMANCE_ZONES = {
    stage: 0,
    low: 1,
    mid: 2,
    high: 3,
} as const;
export type PerformanceZone = keyof typeof PERFORMANCE_ZONES;

export const PERFORMANCE_MOTIONS = {
    normal: 0,
    reverse: 1,
    intense: 2,
    gentle: 3,
} as const;
export type PerformanceMotion = keyof typeof PERFORMANCE_MOTIONS;

export const PERFORMANCE_PALETTES = {
    moon: "#8EB8FF",
    silver: "#D6EAFF",
    ice: "#68E4FF",
    aurora: "#7C92FF",
    violet: "#C58CFF",
    emerald: "#5EE6B8",
    amber: "#FFB870",
    gold: "#FFE29A",
    rose: "#FF8DA8",
    crimson: "#FF6B5B",
    sakura: "#FFB7D5",
    cyan: "#4EEBFF",
    jade: "#6FF2C7",
    ivory: "#FFF4DC",
} as const;
export type PerformancePalette = keyof typeof PERFORMANCE_PALETTES;

export type PerformanceCue = {
    tick: number;
    method: PerformanceMethod;
    /** 0..7, defaults to 0 (omitted). Allows parallel channels of the same method. */
    slot?: number;
    /** 规范化大写 "#RRGGBB" */
    color: string;
    /** Optional secondary/gradient target color "#RRGGBB". */
    color2?: string;
    brush?: PerformanceBrush;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    /** Intensity in percent (0–100). */
    level: number;
    /** Scale in percent (50–170). */
    scale: number;
} & ({ op: "set"; fade: number } | { op: "flash" });

const METHOD_BY_ID = Object.fromEntries(
    Object.entries(PERFORMANCE_METHODS).map(([name, id]) => [id, name as PerformanceMethod]),
) as Record<number, PerformanceMethod | undefined>;

const BRUSH_BY_ID = Object.fromEntries(
    Object.entries(PERFORMANCE_BRUSHES).map(([name, id]) => [id, name as PerformanceBrush]),
) as Record<number, PerformanceBrush | undefined>;

const ZONE_BY_ID = Object.fromEntries(
    Object.entries(PERFORMANCE_ZONES).map(([name, id]) => [id, name as PerformanceZone]),
) as Record<number, PerformanceZone | undefined>;

const MOTION_BY_ID = Object.fromEntries(
    Object.entries(PERFORMANCE_MOTIONS).map(([name, id]) => [id, name as PerformanceMotion]),
) as Record<number, PerformanceMotion | undefined>;

const INSTANT_METHODS: ReadonlySet<PerformanceMethod> = new Set([
    "floor_sweep",
    "shockwave",
    "prism_rewind",
    "firework_bloom",
    "hanabi_launch",
    "comet_split",
]);

export function isInstantPerformanceMethod(method: PerformanceMethod): boolean {
    return INSTANT_METHODS.has(method);
}

export function resolvePerformanceColor(input: string): string {
    if (typeof input !== "string") throw new Error("[pbe3] 无效的演出颜色");
    const trimmed = input.trim();
    if (Object.hasOwn(PERFORMANCE_PALETTES, trimmed)) {
        return PERFORMANCE_PALETTES[trimmed as PerformancePalette];
    }
    const match = trimmed.match(/^#?([0-9a-f]{6})$/i);
    if (match) return `#${match[1].toUpperCase()}`;
    throw new Error(`[pbe3] 无效的演出颜色：${input}`);
}

export function parsePerformanceRgb(color: string): [number, number, number] {
    const resolved = resolvePerformanceColor(color);
    const value = Number.parseInt(resolved.slice(1), 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function formatRgbHex(r: number, g: number, b: number): string {
    const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function paletteAt(palette: readonly string[], index: number): string {
    const color = palette[index];
    if (color === undefined) throw new Error("[pbe3] 演出颜色索引无效");
    return color;
}

const MAX_CUES = 256;
/** 最坏情况：256 条提示各自使用独立主/副色，外加最多 255 项颜色表。 */
export const MAX_PERFORMANCE_BYTES = MAX_CUES * 18 + 1 + 255 * 3;

const FLAG_FLASH = 0x80;
const FLAG_COLOR2 = 0x40;
const FLAG_STYLE = 0x20;
const FLAG_RESERVED = 0x18;
const MASK_SLOT = 0x07;

function checkCue(cue: PerformanceCue, previous: number, duration: number) {
    const inRange = (value: number, min: number, max: number) =>
        Number.isInteger(value) && value >= min && value <= max;
    const slot = cue.slot ?? 0;
    if (!Object.hasOwn(PERFORMANCE_METHODS, cue.method) ||
        !inRange(slot, 0, 7) ||
        (cue.brush !== undefined && !Object.hasOwn(PERFORMANCE_BRUSHES, cue.brush)) ||
        (cue.zone !== undefined && !Object.hasOwn(PERFORMANCE_ZONES, cue.zone)) ||
        (cue.motion !== undefined && !Object.hasOwn(PERFORMANCE_MOTIONS, cue.motion)) ||
        !inRange(cue.tick, previous, duration) ||
        !inRange(cue.level, 0, 100) ||
        !inRange(cue.scale, 50, 170) ||
        (cue.op !== "flash" && (cue.op !== "set" || !inRange(cue.fade, 0, duration - cue.tick)))) {
        throw new Error("[pbe3] 演出提示超出范围");
    }
}

export function encodePerformance(cues: readonly PerformanceCue[], duration: number): Uint8Array {
    if (cues.length < 1 || cues.length > MAX_CUES) throw new Error("[pbe3] 演出提示数量超出范围");
    const palette: [number, number, number][] = [];
    const paletteIndex = new Map<number, number>();
    const indexOf = (color: string) => {
        const [r, g, b] = parsePerformanceRgb(color);
        const key = (r << 16) | (g << 8) | b;
        const existing = paletteIndex.get(key);
        if (existing !== undefined) return existing;
        if (palette.length >= 255) throw new Error("[pbe3] 演出颜色数量超出范围");
        palette.push([r, g, b]);
        paletteIndex.set(key, palette.length - 1);
        return palette.length - 1;
    };

    // 第一遍校验并收集颜色表；第二遍才写出（表长度决定偏移）。
    let previous = 0;
    const prepared = cues.map(cue => {
        checkCue(cue, previous, duration);
        previous = cue.tick;
        return {
            cue,
            color: indexOf(cue.color),
            color2: cue.color2 !== undefined ? indexOf(cue.color2) : undefined,
            brushId: PERFORMANCE_BRUSHES[cue.brush ?? "default"],
            zoneId: PERFORMANCE_ZONES[cue.zone ?? "stage"],
            motionId: PERFORMANCE_MOTIONS[cue.motion ?? "normal"],
        };
    });

    const data = new Uint8Array(1 + palette.length * 3 + cues.length * 18);
    let offset = 0;
    data[offset++] = palette.length;
    for (const [r, g, b] of palette) {
        data[offset++] = r;
        data[offset++] = g;
        data[offset++] = b;
    }

    previous = 0;
    for (const { cue, color, color2, brushId, zoneId, motionId } of prepared) {
        const hasStyle = brushId !== 0 || zoneId !== 0 || motionId !== 0;
        const slot = cue.slot ?? 0;
        const flags =
            (cue.op === "flash" ? FLAG_FLASH : 0) |
            (color2 !== undefined ? FLAG_COLOR2 : 0) |
            (hasStyle ? FLAG_STYLE : 0) |
            (slot & MASK_SLOT);

        offset = writeVarUint(data, offset, cue.tick - previous);
        data[offset++] = flags;
        data[offset++] = PERFORMANCE_METHODS[cue.method];
        data[offset++] = cue.level;
        data[offset++] = cue.scale;
        data[offset++] = color;
        if (hasStyle) {
            data[offset++] = ((motionId & 0x03) << 6) | ((zoneId & 0x03) << 4) | (brushId & 0x0f);
        }
        if (color2 !== undefined) {
            data[offset++] = color2;
        }
        if (cue.op === "set") {
            offset = writeVarUint(data, offset, cue.fade);
        }
        previous = cue.tick;
    }
    return data.subarray(0, offset);
}

/**
 * @param colorTable v3 起为 true：区块开头是颜色表，提示内只存索引；
 *   v2 旧文件为 false，提示内内联 RGB。
 */
export function decodePerformance(data: Uint8Array, duration: number, colorTable = true): PerformanceCue[] {
    if (!data.length || data.length > MAX_PERFORMANCE_BYTES) throw new Error("[pbe3] 演出区块长度无效");
    const cues: PerformanceCue[] = [];
    const value = { value: 0, next: 0 };
    let offset = 0;
    let previous = 0;

    let palette: string[] = [];
    if (colorTable) {
        if (offset + 1 > data.length) throw new Error("[pbe3] 演出颜色表被截断");
        const count = data[offset++];
        if (count === 0) throw new Error("[pbe3] 演出颜色表为空");
        if (offset + count * 3 > data.length) throw new Error("[pbe3] 演出颜色表被截断");
        palette = Array.from({ length: count }, () => {
            const color = formatRgbHex(data[offset++], data[offset++], data[offset++]);
            return color;
        });
    }

    const minimumCueBytes = colorTable ? 5 : 7;
    while (offset < data.length) {
        if (cues.length >= MAX_CUES) throw new Error("[pbe3] 演出提示数量超出范围");
        readVarUint(data, offset, value);
        const tick = previous + value.value;
        offset = value.next;
        if (offset + minimumCueBytes > data.length) throw new Error("[pbe3] 演出提示被截断");
        const flags = data[offset++];
        if ((flags & FLAG_RESERVED) !== 0) throw new Error("[pbe3] 演出提示保留位非 0");
        const methodId = data[offset++];
        if (methodId === 0) throw new Error("[pbe3] 演出绘制方法无效");
        const level = data[offset++];
        const scale = data[offset++];
        const color = colorTable
            ? paletteAt(palette, data[offset++])
            : formatRgbHex(data[offset++], data[offset++], data[offset++]);

        let brush: PerformanceBrush = "default";
        let zone: PerformanceZone = "stage";
        let motion: PerformanceMotion = "normal";
        if (flags & FLAG_STYLE) {
            if (offset + 1 > data.length) throw new Error("[pbe3] 演出提示样式被截断");
            const style = data[offset++];
            brush = BRUSH_BY_ID[style & 0x0f] ?? "default";
            zone = ZONE_BY_ID[(style >>> 4) & 0x03] ?? "stage";
            motion = MOTION_BY_ID[(style >>> 6) & 0x03] ?? "normal";
        }

        let color2: string | undefined;
        if (flags & FLAG_COLOR2) {
            if (colorTable) {
                if (offset + 1 > data.length) throw new Error("[pbe3] 演出提示副色被截断");
                color2 = paletteAt(palette, data[offset++]);
            } else {
                if (offset + 3 > data.length) throw new Error("[pbe3] 演出提示副色被截断");
                color2 = formatRgbHex(data[offset++], data[offset++], data[offset++]);
            }
        }

        let fade = 0;
        const isFlash = (flags & FLAG_FLASH) !== 0;
        if (!isFlash) {
            readVarUint(data, offset, value);
            offset = value.next;
            fade = value.value;
        }

        if (!Number.isInteger(tick) || tick < previous || tick > duration ||
            level > 100 || scale < 50 || scale > 170 ||
            (!isFlash && fade > duration - tick)) {
            throw new Error("[pbe3] 演出提示超出范围");
        }
        previous = tick;

        const method = METHOD_BY_ID[methodId];
        if (!method) continue;

        const slot = flags & MASK_SLOT;
        const cue: PerformanceCue = isFlash
            ? { tick, method, color, level, scale, op: "flash" }
            : { tick, method, color, level, scale, op: "set", fade };
        if (slot !== 0) cue.slot = slot;
        if (color2 !== undefined) cue.color2 = color2;
        if (brush !== "default") cue.brush = brush;
        if (zone !== "stage") cue.zone = zone;
        if (motion !== "normal") cue.motion = motion;
        cues.push(cue);
    }
    return cues;
}
