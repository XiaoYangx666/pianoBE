import { readVarUint, writeVarUint } from "../binary/varint.js";

/** Stable resource references. Keep existing IDs when adding a layer. */
export const PERFORMANCE_LAYERS = {
    moonDust: 1,
    rearLight: 2,
    silverThread: 3,
    amberWings: 4,
    timeFan: 5,
    goldSparks: 6,
    glassGather: 7,
    glassBreak: 8,
} as const;

export type PerformanceCue = {
    tick: number;
    layer: number;
    /** Intensity in percent (0–100). */
    level: number;
    /** Scale in percent (50–170). */
    scale: number;
} & ({ op: "set"; fade: number } | { op: "flash" });

const MAX_CUES = 192;
export const MAX_PERFORMANCE_BYTES = MAX_CUES * 13;

function checkCue(cue: PerformanceCue, previous: number, duration: number) {
    const inRange = (value: number, min: number, max: number) =>
        Number.isInteger(value) && value >= min && value <= max;
    if (!inRange(cue.tick, previous, duration) || !inRange(cue.layer, 1, 127) ||
        !inRange(cue.level, 0, 100) || !inRange(cue.scale, 50, 170) ||
        (cue.op !== "flash" && (cue.op !== "set" || !inRange(cue.fade, 0, duration - cue.tick)))) {
        throw new Error("[pbe3] 演出提示超出范围");
    }
}

export function encodePerformance(cues: readonly PerformanceCue[], duration: number): Uint8Array {
    if (cues.length < 1 || cues.length > MAX_CUES) throw new Error("[pbe3] 演出提示数量超出范围");
    const data = new Uint8Array(cues.length * 13);
    let offset = 0;
    let previous = 0;
    for (const cue of cues) {
        checkCue(cue, previous, duration);
        offset = writeVarUint(data, offset, cue.tick - previous);
        data[offset++] = cue.layer | (cue.op === "flash" ? 128 : 0);
        data[offset++] = cue.level;
        data[offset++] = cue.scale;
        if (cue.op === "set") offset = writeVarUint(data, offset, cue.fade);
        previous = cue.tick;
    }
    return data.subarray(0, offset);
}

export function decodePerformance(data: Uint8Array, duration: number): PerformanceCue[] {
    if (!data.length || data.length > MAX_PERFORMANCE_BYTES) throw new Error("[pbe3] 演出区块长度无效");
    const cues: PerformanceCue[] = [];
    const value = { value: 0, next: 0 };
    let offset = 0;
    let previous = 0;
    while (offset < data.length) {
        if (cues.length >= MAX_CUES) throw new Error("[pbe3] 演出提示数量超出范围");
        readVarUint(data, offset, value);
        const tick = previous + value.value;
        offset = value.next;
        if (offset + 3 > data.length) throw new Error("[pbe3] 演出提示被截断");
        const operation = data[offset++];
        const base = { tick, layer: operation & 127, level: data[offset++], scale: data[offset++] };
        let cue: PerformanceCue;
        if (operation & 128) cue = { ...base, op: "flash" };
        else {
            readVarUint(data, offset, value);
            offset = value.next;
            cue = { ...base, op: "set", fade: value.value };
        }
        checkCue(cue, previous, duration);
        cues.push(cue);
        previous = tick;
    }
    return cues;
}
