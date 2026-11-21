import { decodeUtf8, encodeUtf8 } from "../binary/utf8.js";
import { readVarUint, varUintSize, writeVarUint } from "../binary/varint.js";

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

export const PERFORMANCE_SYMBOL_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const PERFORMANCE_PARAM_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,31}$/;

export type PerformanceParamValue = number | boolean | string;
export type PerformanceParams = Readonly<Record<string, PerformanceParamValue>>;

export type PerformanceCue = {
    tick: number;
    /** 稳定字符串标识（例如 "starfield"、"shockwave"） */
    effect: string;
    /** 0..7，默认为 0（编码时可省略）；允许同特效多轨道并行 */
    slot?: number;
    /** 规范化大写 "#RRGGBB" */
    color: string;
    /** 可选副色 "#RRGGBB" */
    color2?: string;
    /** 可选画笔名称 */
    brush?: string;
    /** 可选变体名称（如 key_style 样式名或特效内部变体） */
    variant?: string;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    /** 可选特效专属参数（数值、布尔或枚举符号） */
    params?: PerformanceParams;
    /** 强度百分比（0–100） */
    level: number;
    /** 缩放百分比（50–170） */
    scale: number;
} & ({ op: "set"; fade: number } | { op: "flash" });

const ZONE_BY_ID = Object.fromEntries(
    Object.entries(PERFORMANCE_ZONES).map(([name, id]) => [id, name as PerformanceZone]),
) as Record<number, PerformanceZone | undefined>;

const MOTION_BY_ID = Object.fromEntries(
    Object.entries(PERFORMANCE_MOTIONS).map(([name, id]) => [id, name as PerformanceMotion]),
) as Record<number, PerformanceMotion | undefined>;

export function isValidPerformanceSymbol(value: unknown): value is string {
    return typeof value === "string" && PERFORMANCE_SYMBOL_PATTERN.test(value);
}

export function isValidPerformanceParamKey(value: unknown): value is string {
    return typeof value === "string" && PERFORMANCE_PARAM_KEY_PATTERN.test(value);
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

function tableAt<T>(table: readonly T[], index: number, label: string): T {
    const item = table[index];
    if (item === undefined) throw new Error(`[pbe3] ${label}索引无效`);
    return item;
}

const MAX_CUES = 256;
const MAX_SYMBOLS = 255;
const MAX_SYMBOL_LENGTH = 32;
const MAX_COLORS = 255;
const MAX_CUE_PARAMS = 16;
/** 符号表 + 颜色表 + 最多 256 条提示的安全上限。 */
export const MAX_PERFORMANCE_BYTES = 16 * 1024;

const FLAG_FLASH = 0x80;
const FLAG_COLOR2 = 0x40;
const FLAG_BRUSH = 0x20;
const FLAG_VARIANT = 0x10;
const FLAG_SPACE = 0x08;
const MASK_SLOT = 0x07;
const SPACE_FLAG_PARAMS = 0x80;
const SPACE_RESERVED_MASK = 0x70;

const PARAM_FALSE = 0x00;
const PARAM_TRUE = 0x01;
const PARAM_ENUM = 0x02;
const PARAM_INT = 0x03;
const PARAM_SCALED = 0x04;
const PARAM_F32 = 0x05;

const MAX_ZIGZAG_INT = 1_000_000;
const MAX_SCALED_VALUE = 10_000;
const PARAM_SCALE_FACTOR = 1000;

function encodeZigZag(value: number): number {
    return ((value << 1) ^ (value >> 31)) >>> 0;
}

function decodeZigZag(encoded: number): number {
    return (encoded >>> 1) ^ -(encoded & 1);
}

function symbolAt(symbols: readonly string[], index: number, label: string): string {
    const sym = tableAt(symbols, index, label);
    if (!isValidPerformanceSymbol(sym)) throw new Error(`[pbe3] ${label}格式无效`);
    return sym;
}

function checkParams(params: PerformanceParams) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
        throw new Error("[pbe3] 演出参数格式无效");
    }
    const entries = Object.entries(params);
    if (entries.length > MAX_CUE_PARAMS) {
        throw new Error("[pbe3] 演出参数数量超出范围");
    }
    for (const [key, value] of entries) {
        if (!isValidPerformanceParamKey(key)) {
            throw new Error(`[pbe3] 演出参数名无效：${key}`);
        }
        if (typeof value === "boolean") continue;
        if (typeof value === "number") {
            if (!Number.isFinite(value)) throw new Error(`[pbe3] 演出参数数值无效：${key}`);
            continue;
        }
        if (typeof value === "string") {
            if (!isValidPerformanceSymbol(value)) throw new Error(`[pbe3] 演出枚举参数无效：${key}=${value}`);
            continue;
        }
        throw new Error(`[pbe3] 演出参数类型无效：${key}`);
    }
}

interface PreparedParam {
    keyIndex: number;
    tag: number;
    extraBytes: number;
    encodedInt?: number;
    floatValue?: number;
    symIndex?: number;
}

function prepareParam(
    key: string,
    value: PerformanceParamValue,
    symbolOf: (name: string) => number,
): PreparedParam {
    const keyIndex = symbolOf(key);
    if (typeof value === "boolean") {
        return { keyIndex, tag: value ? PARAM_TRUE : PARAM_FALSE, extraBytes: 0 };
    }
    if (typeof value === "string") {
        return { keyIndex, tag: PARAM_ENUM, extraBytes: 1, symIndex: symbolOf(value) };
    }
    const normalized = value === 0 ? 0 : value;
    if (Number.isInteger(normalized) && normalized >= -MAX_ZIGZAG_INT && normalized <= MAX_ZIGZAG_INT) {
        const zz = encodeZigZag(normalized);
        return { keyIndex, tag: PARAM_INT, extraBytes: varUintSize(zz), encodedInt: zz };
    }
    const scaled = Math.round(normalized * PARAM_SCALE_FACTOR);
    if (
        Math.abs(normalized) <= MAX_SCALED_VALUE &&
        Math.abs(normalized * PARAM_SCALE_FACTOR - scaled) < 1e-6
    ) {
        const zz = encodeZigZag(scaled);
        return { keyIndex, tag: PARAM_SCALED, extraBytes: varUintSize(zz), encodedInt: zz };
    }
    return { keyIndex, tag: PARAM_F32, extraBytes: 4, floatValue: normalized };
}

function checkCue(cue: PerformanceCue, previous: number, duration: number) {
    const inRange = (value: number, min: number, max: number) =>
        Number.isInteger(value) && value >= min && value <= max;
    const slot = cue.slot ?? 0;
    if (!isValidPerformanceSymbol(cue.effect) ||
        !inRange(slot, 0, 7) ||
        (cue.brush !== undefined && !isValidPerformanceSymbol(cue.brush)) ||
        (cue.variant !== undefined && !isValidPerformanceSymbol(cue.variant)) ||
        (cue.zone !== undefined && !Object.hasOwn(PERFORMANCE_ZONES, cue.zone)) ||
        (cue.motion !== undefined && !Object.hasOwn(PERFORMANCE_MOTIONS, cue.motion)) ||
        !inRange(cue.tick, previous, duration) ||
        !inRange(cue.level, 0, 100) ||
        !inRange(cue.scale, 50, 170) ||
        (cue.op !== "flash" && (cue.op !== "set" || !inRange(cue.fade, 0, duration - cue.tick)))) {
        throw new Error("[pbe3] 演出提示超出范围");
    }
    if (cue.params !== undefined) checkParams(cue.params);
}

export function encodePerformance(cues: readonly PerformanceCue[], duration: number): Uint8Array {
    if (cues.length < 1 || cues.length > MAX_CUES) throw new Error("[pbe3] 演出提示数量超出范围");

    const symbols: Uint8Array[] = [];
    const symbolIndex = new Map<string, number>();
    const symbolOf = (name: string) => {
        const existing = symbolIndex.get(name);
        if (existing !== undefined) return existing;
        if (symbols.length >= MAX_SYMBOLS) throw new Error("[pbe3] 演出符号数量超出范围");
        const encoded = encodeUtf8(name);
        if (encoded.length === 0 || encoded.length > MAX_SYMBOL_LENGTH) {
            throw new Error("[pbe3] 演出符号长度无效");
        }
        const index = symbols.length;
        symbols.push(encoded);
        symbolIndex.set(name, index);
        return index;
    };

    const palette: [number, number, number][] = [];
    const paletteIndex = new Map<number, number>();
    const colorOf = (color: string) => {
        const [r, g, b] = parsePerformanceRgb(color);
        const key = (r << 16) | (g << 8) | b;
        const existing = paletteIndex.get(key);
        if (existing !== undefined) return existing;
        if (palette.length >= MAX_COLORS) throw new Error("[pbe3] 演出颜色数量超出范围");
        const index = palette.length;
        palette.push([r, g, b]);
        paletteIndex.set(key, index);
        return index;
    };

    let previous = 0;
    let bodyBytes = 0;
    const prepared = cues.map((cue) => {
        checkCue(cue, previous, duration);
        const delta = cue.tick - previous;
        previous = cue.tick;
        const effect = symbolOf(cue.effect);
        const brush = cue.brush !== undefined ? symbolOf(cue.brush) : undefined;
        const variant = cue.variant !== undefined ? symbolOf(cue.variant) : undefined;
        const color = colorOf(cue.color);
        const color2 = cue.color2 !== undefined ? colorOf(cue.color2) : undefined;
        const zoneId = PERFORMANCE_ZONES[cue.zone ?? "stage"];
        const motionId = PERFORMANCE_MOTIONS[cue.motion ?? "normal"];
        const paramEntries = cue.params ? Object.entries(cue.params) : [];
        const encodedParams = paramEntries.map(([key, value]) => prepareParam(key, value, symbolOf));
        const hasParams = encodedParams.length > 0;
        const hasSpace = zoneId !== 0 || motionId !== 0 || hasParams;
        const paramsBytes = hasParams
            ? 1 + encodedParams.reduce((sum, item) => sum + 2 + item.extraBytes, 0)
            : 0;

        bodyBytes +=
            varUintSize(delta) +
            5 + // flags + effect + level + scale + color
            (color2 !== undefined ? 1 : 0) +
            (brush !== undefined ? 1 : 0) +
            (variant !== undefined ? 1 : 0) +
            (hasSpace ? 1 : 0) +
            paramsBytes +
            (cue.op === "set" ? varUintSize(cue.fade) : 0);

        return { cue, delta, effect, brush, variant, color, color2, zoneId, motionId, hasSpace, encodedParams };
    });

    const symbolTableBytes = 1 + symbols.reduce((sum, item) => sum + 1 + item.length, 0);
    const colorTableBytes = 1 + palette.length * 3;
    const totalBytes = symbolTableBytes + colorTableBytes + bodyBytes;
    if (totalBytes > MAX_PERFORMANCE_BYTES) throw new Error("[pbe3] 演出区块超过长度上限");

    const data = new Uint8Array(totalBytes);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    data[offset++] = symbols.length;
    for (const sym of symbols) {
        data[offset++] = sym.length;
        data.set(sym, offset);
        offset += sym.length;
    }

    data[offset++] = palette.length;
    for (const [r, g, b] of palette) {
        data[offset++] = r;
        data[offset++] = g;
        data[offset++] = b;
    }

    for (const { cue, delta, effect, brush, variant, color, color2, zoneId, motionId, hasSpace, encodedParams } of prepared) {
        const slot = cue.slot ?? 0;
        const hasParams = encodedParams.length > 0;
        const flags =
            (cue.op === "flash" ? FLAG_FLASH : 0) |
            (color2 !== undefined ? FLAG_COLOR2 : 0) |
            (brush !== undefined ? FLAG_BRUSH : 0) |
            (variant !== undefined ? FLAG_VARIANT : 0) |
            (hasSpace ? FLAG_SPACE : 0) |
            (slot & MASK_SLOT);

        offset = writeVarUint(data, offset, delta);
        data[offset++] = flags;
        data[offset++] = effect;
        data[offset++] = cue.level;
        data[offset++] = cue.scale;
        data[offset++] = color;
        if (color2 !== undefined) data[offset++] = color2;
        if (brush !== undefined) data[offset++] = brush;
        if (variant !== undefined) data[offset++] = variant;
        if (hasSpace) {
            data[offset++] =
                (hasParams ? SPACE_FLAG_PARAMS : 0) |
                ((motionId & 0x03) << 2) |
                (zoneId & 0x03);
        }
        if (hasParams) {
            data[offset++] = encodedParams.length;
            for (const param of encodedParams) {
                data[offset++] = param.keyIndex;
                data[offset++] = param.tag;
                if (param.tag === PARAM_ENUM) {
                    data[offset++] = param.symIndex!;
                } else if (param.tag === PARAM_INT || param.tag === PARAM_SCALED) {
                    offset = writeVarUint(data, offset, param.encodedInt!);
                } else if (param.tag === PARAM_F32) {
                    view.setFloat32(offset, param.floatValue!, true);
                    offset += 4;
                }
            }
        }
        if (cue.op === "set") offset = writeVarUint(data, offset, cue.fade);
    }

    return data;
}

export function decodePerformance(data: Uint8Array, duration: number): PerformanceCue[] {
    if (!data.length || data.length > MAX_PERFORMANCE_BYTES) {
        throw new Error("[pbe3] 演出区块长度无效");
    }
    const cues: PerformanceCue[] = [];
    const value = { value: 0, next: 0 };
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    if (offset + 1 > data.length) throw new Error("[pbe3] 演出符号表被截断");
    const symbolCount = data[offset++];
    if (symbolCount === 0) throw new Error("[pbe3] 演出符号表为空");
    const symbols: string[] = [];
    for (let i = 0; i < symbolCount; i++) {
        if (offset + 1 > data.length) throw new Error("[pbe3] 演出符号表被截断");
        const len = data[offset++];
        if (len === 0 || len > MAX_SYMBOL_LENGTH) throw new Error("[pbe3] 演出符号长度无效");
        if (offset + len > data.length) throw new Error("[pbe3] 演出符号表被截断");
        const sym = decodeUtf8(data.subarray(offset, offset + len));
        offset += len;
        if (!isValidPerformanceSymbol(sym) && !isValidPerformanceParamKey(sym)) {
            throw new Error("[pbe3] 演出符号格式无效");
        }
        symbols.push(sym);
    }

    if (offset + 1 > data.length) throw new Error("[pbe3] 演出颜色表被截断");
    const colorCount = data[offset++];
    if (colorCount === 0) throw new Error("[pbe3] 演出颜色表为空");
    if (offset + colorCount * 3 > data.length) throw new Error("[pbe3] 演出颜色表被截断");
    const palette = Array.from({ length: colorCount }, () =>
        formatRgbHex(data[offset++], data[offset++], data[offset++]),
    );

    if (offset >= data.length) throw new Error("[pbe3] 演出提示不能为空");

    let previous = 0;
    while (offset < data.length) {
        if (cues.length >= MAX_CUES) throw new Error("[pbe3] 演出提示数量超出范围");
        readVarUint(data, offset, value);
        const tick = previous + value.value;
        offset = value.next;
        if (offset + 5 > data.length) throw new Error("[pbe3] 演出提示被截断");

        const flags = data[offset++];
        const effect = symbolAt(symbols, data[offset++], "演出特效符号");
        const level = data[offset++];
        const scale = data[offset++];
        const color = tableAt(palette, data[offset++], "演出颜色");

        let color2: string | undefined;
        if (flags & FLAG_COLOR2) {
            if (offset + 1 > data.length) throw new Error("[pbe3] 演出提示副色被截断");
            color2 = tableAt(palette, data[offset++], "演出副色");
        }

        let brush: string | undefined;
        if (flags & FLAG_BRUSH) {
            if (offset + 1 > data.length) throw new Error("[pbe3] 演出提示画笔被截断");
            brush = symbolAt(symbols, data[offset++], "演出画笔符号");
        }

        let variant: string | undefined;
        if (flags & FLAG_VARIANT) {
            if (offset + 1 > data.length) throw new Error("[pbe3] 演出提示变体被截断");
            variant = symbolAt(symbols, data[offset++], "演出变体符号");
        }

        let zone: PerformanceZone = "stage";
        let motion: PerformanceMotion = "normal";
        let params: Record<string, PerformanceParamValue> | undefined;
        if (flags & FLAG_SPACE) {
            if (offset + 1 > data.length) throw new Error("[pbe3] 演出提示空间参数被截断");
            const space = data[offset++];
            if ((space & SPACE_RESERVED_MASK) !== 0) throw new Error("[pbe3] 演出空间参数保留位非 0");
            zone = ZONE_BY_ID[space & 0x03] ?? "stage";
            motion = MOTION_BY_ID[(space >>> 2) & 0x03] ?? "normal";
            if (space & SPACE_FLAG_PARAMS) {
                if (offset + 1 > data.length) throw new Error("[pbe3] 演出参数表被截断");
                const paramCount = data[offset++];
                if (paramCount === 0 || paramCount > MAX_CUE_PARAMS) {
                    throw new Error("[pbe3] 演出参数数量超出范围");
                }
                params = {};
                for (let i = 0; i < paramCount; i++) {
                    if (offset + 2 > data.length) throw new Error("[pbe3] 演出参数被截断");
                    const key = tableAt(symbols, data[offset++], "演出参数名符号");
                    if (!isValidPerformanceParamKey(key)) throw new Error("[pbe3] 演出参数名格式无效");
                    if (Object.hasOwn(params, key)) throw new Error("[pbe3] 演出参数名重复");
                    const tag = data[offset++];
                    if (tag === PARAM_FALSE) {
                        params[key] = false;
                    } else if (tag === PARAM_TRUE) {
                        params[key] = true;
                    } else if (tag === PARAM_ENUM) {
                        if (offset + 1 > data.length) throw new Error("[pbe3] 演出枚举参数被截断");
                        params[key] = symbolAt(symbols, data[offset++], "演出枚举参数符号");
                    } else if (tag === PARAM_INT) {
                        readVarUint(data, offset, value);
                        offset = value.next;
                        const decoded = decodeZigZag(value.value);
                        if (decoded < -MAX_ZIGZAG_INT || decoded > MAX_ZIGZAG_INT) {
                            throw new Error("[pbe3] 演出整数参数超出范围");
                        }
                        params[key] = decoded;
                    } else if (tag === PARAM_SCALED) {
                        readVarUint(data, offset, value);
                        offset = value.next;
                        const decoded = decodeZigZag(value.value) / PARAM_SCALE_FACTOR;
                        if (Math.abs(decoded) > MAX_SCALED_VALUE) {
                            throw new Error("[pbe3] 演出小数参数超出范围");
                        }
                        params[key] = decoded;
                    } else if (tag === PARAM_F32) {
                        if (offset + 4 > data.length) throw new Error("[pbe3] 演出浮点参数被截断");
                        const num = view.getFloat32(offset, true);
                        offset += 4;
                        if (!Number.isFinite(num)) throw new Error("[pbe3] 演出参数数值无效");
                        params[key] = num;
                    } else {
                        throw new Error("[pbe3] 演出参数类型无效");
                    }
                }
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

        const slot = flags & MASK_SLOT;
        const cue: PerformanceCue = isFlash
            ? { tick, effect, color, level, scale, op: "flash" }
            : { tick, effect, color, level, scale, op: "set", fade };
        if (slot !== 0) cue.slot = slot;
        if (color2 !== undefined) cue.color2 = color2;
        if (brush !== undefined) cue.brush = brush;
        if (variant !== undefined) cue.variant = variant;
        if (zone !== "stage") cue.zone = zone;
        if (motion !== "normal") cue.motion = motion;
        if (params !== undefined) cue.params = params;
        cues.push(cue);
    }

    return cues;
}
