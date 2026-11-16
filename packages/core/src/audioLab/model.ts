/**
 * Audio Lab 的纯逻辑层（实验用，不进入正式播放器的依赖链）。
 *
 * 这里只做与音频渲染无关的计算：调度量化、力度分层、释放时间与统计。
 * 浏览器实时引擎和 Node 离线分析脚本共用这些函数，保证两边使用同一套实验规则。
 */

export type ScheduleMode =
    | "exact"
    | "tick-ceil"
    | "tick-round"
    | "tick-round-lead"
    | "tick-ceil-lead";

export type VelocityMode = "single" | "layers2" | "layers3";

export type ReleaseMode = "tier" | "noteoff" | "natural" | "noteoff-long";

export interface LabNote {
    midi: number;
    /** 原始 MIDI 起始时间（秒） */
    time: number;
    /** 原始时值（秒） */
    duration: number;
    /** 0~1 */
    velocity: number;
}

export interface ScheduleOptions {
    mode: ScheduleMode;
    /** 游戏 tick 长度（秒），基岩版 20 TPS = 0.05 */
    tickSeconds?: number;
    /** 力度→响度曲线指数 */
    velocityExponent?: number;
}

export interface ScheduledNote extends LabNote {
    /** 实际排定的起始时间（秒） */
    start: number;
    /** start - time（毫秒），正数表示拖后 */
    onsetErrorMs: number;
    /** 力度层索引：0 弱 / 1 中 / 2 强 */
    layer: number;
    /** 相对参考力度的响度增益（dB） */
    velocityGainDb: number;
}

export const DEFAULT_TICK_SECONDS = 0.05;

/** 三层力度的分界（1~127）：≤42 弱、43~84 中、≥85 强（VCSL vl2/vl3/vl4）。 */
export const LAYER_BOUNDS_3 = [42, 84] as const;
/** 两层力度使用 vl2 + vl4，分界 64。 */
export const LAYER_BOUNDS_2 = [64] as const;

/** 参考力度：校准后的音色在这个力度下保持原有响度。 */
export const VELOCITY_REFERENCE = 90;
/** 力度→响度曲线指数：1.0 约等于线性振幅，1.6 接近真实钢琴的弱强差。 */
export const VELOCITY_EXPONENT = 1.6;

/** MIDI 力度（0~1）→ 相对参考力度的增益（dB）。 */
export function velocityGainDb(velocity: number, exponent = VELOCITY_EXPONENT): number {
    const value = clamp(velocity, 0, 1);
    if (value <= 0) return -60;
    // 以 90/127 为 0 dB，保留弱奏到强奏约 17~20 dB 的动态。
    return 20 * exponent * Math.log10((value * 127) / VELOCITY_REFERENCE);
}

/** 力度（0~1）→ 采样层索引。 */
export function layerForVelocity(velocity: number, mode: VelocityMode): number {
    const midiVelocity = clamp(Math.round(velocity * 127), 1, 127);
    if (mode === "single") return 1;
    if (mode === "layers2") return midiVelocity <= LAYER_BOUNDS_2[0] ? 0 : 2;
    if (midiVelocity <= LAYER_BOUNDS_3[0]) return 0;
    if (midiVelocity <= LAYER_BOUNDS_3[1]) return 1;
    return 2;
}

/** 量化到 tick 网格；返回秒。 */
export function quantizeTime(time: number, mode: ScheduleMode, tickSeconds = DEFAULT_TICK_SECONDS): number {
    const tick = Math.max(0.001, tickSeconds);
    const value = Math.max(0, time);
    switch (mode) {
        case "exact":
            return value;
        case "tick-ceil":
            return Math.ceil(value / tick - 1e-9) * tick;
        case "tick-round":
            return Math.round(value / tick) * tick;
        case "tick-round-lead":
            return Math.max(0, Math.round(value / tick) * tick - tick);
        case "tick-ceil-lead":
            return Math.max(0, Math.ceil(value / tick - 1e-9) * tick - tick);
        default:
            return value;
    }
}

/** 为一段音符生成实验用调度表。 */
export function scheduleNotes(
    notes: readonly LabNote[],
    options: ScheduleOptions & { velocityMode?: VelocityMode }
): ScheduledNote[] {
    const tick = options.tickSeconds ?? DEFAULT_TICK_SECONDS;
    const velocityMode = options.velocityMode ?? "single";
    const exponent = options.velocityExponent ?? VELOCITY_EXPONENT;
    return notes.map((note) => {
        const start = quantizeTime(note.time, options.mode, tick);
        return {
            ...note,
            start,
            onsetErrorMs: (start - note.time) * 1000,
            layer: layerForVelocity(note.velocity, velocityMode),
            velocityGainDb: velocityGainDb(note.velocity, exponent),
        };
    });
}

export interface NoteEndOptions {
    releaseMode: ReleaseMode;
    /** noteoff 模式的释放时长（秒） */
    releaseSeconds?: number;
    /** 采样文件自身长度（秒），natural 模式使用 */
    sampleSeconds?: number;
}

/** 一个音符从开始到完全静音的时间（秒），用于估算尾音堆积。 */
export function noteEnd(note: ScheduledNote, options: NoteEndOptions): number {
    const release = Math.max(0.005, options.releaseSeconds ?? 0.12);
    switch (options.releaseMode) {
        case "tier": {
            const tier = note.duration < 1 ? 0.5 : note.duration > 4 ? 4 : 2;
            return note.start + tier;
        }
        case "noteoff":
            return note.start + Math.max(0.04, note.duration) + release;
        case "noteoff-long":
            return note.start + Math.max(0.04, note.duration) + Math.max(release, 0.35);
        case "natural":
            return note.start + (options.sampleSeconds ?? 4);
        default:
            return note.start + note.duration;
    }
}

export interface ScheduleMetrics {
    count: number;
    meanMs: number;
    medianMs: number;
    meanAbsMs: number;
    p90AbsMs: number;
    maxAbsMs: number;
    within10: number;
    within20: number;
    within30: number;
    /** 相邻音符间隔被改变超过 20ms 的比例 */
    intervalShiftRatio: number;
    meanIntervalShiftMs: number;
    p90IntervalShiftMs: number;
    /** 原本不同 tick 的音符被压到同一 tick 的次数 */
    collisions: number;
    /** 同时刻音符（和弦）的最大跨度，毫秒 */
    maxChordSpreadMs: number;
}

export function scheduleMetrics(notes: readonly ScheduledNote[]): ScheduleMetrics {
    if (!notes.length) {
        return {
            count: 0,
            meanMs: 0,
            medianMs: 0,
            meanAbsMs: 0,
            p90AbsMs: 0,
            maxAbsMs: 0,
            within10: 0,
            within20: 0,
            within30: 0,
            intervalShiftRatio: 0,
            meanIntervalShiftMs: 0,
            p90IntervalShiftMs: 0,
            collisions: 0,
            maxChordSpreadMs: 0,
        };
    }

    const errors = notes.map((note) => note.onsetErrorMs);
    const abs = errors.map(Math.abs).sort((a, b) => a - b);
    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const median = abs[Math.floor(abs.length / 2)];

    const shifts: number[] = [];
    let collisions = 0;
    const sorted = [...notes].sort((a, b) => a.time - b.time);
    for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        const original = (current.time - previous.time) * 1000;
        const actual = (current.start - previous.start) * 1000;
        if (original > 0.5) shifts.push(Math.abs(actual - original));
        if (original > 0.5 && Math.abs(actual) < 0.5) collisions++;
    }
    shifts.sort((a, b) => a - b);

    // 和弦跨度：把起始时间相差 <40ms 的音归为一组，看组内量化后的最大时间差
    let maxChordSpreadMs = 0;
    for (let i = 0; i < sorted.length; ) {
        let j = i + 1;
        while (j < sorted.length && (sorted[j].time - sorted[i].time) * 1000 < 40) j++;
        if (j - i > 1) {
            let min = Infinity;
            let max = -Infinity;
            for (let k = i; k < j; k++) {
                min = Math.min(min, sorted[k].start);
                max = Math.max(max, sorted[k].start);
            }
            maxChordSpreadMs = Math.max(maxChordSpreadMs, (max - min) * 1000);
        }
        i = j;
    }

    return {
        count: notes.length,
        meanMs: mean,
        medianMs: median,
        meanAbsMs: abs.reduce((sum, value) => sum + value, 0) / abs.length,
        p90AbsMs: abs[Math.floor(abs.length * 0.9)],
        maxAbsMs: abs[abs.length - 1],
        within10: abs.filter((value) => value <= 10).length / abs.length,
        within20: abs.filter((value) => value <= 20).length / abs.length,
        within30: abs.filter((value) => value <= 30).length / abs.length,
        intervalShiftRatio: shifts.length ? shifts.filter((value) => value > 20).length / shifts.length : 0,
        meanIntervalShiftMs: shifts.length ? shifts.reduce((sum, value) => sum + value, 0) / shifts.length : 0,
        p90IntervalShiftMs: shifts.length ? shifts[Math.floor(shifts.length * 0.9)] : 0,
        collisions,
        maxChordSpreadMs,
    };
}

export interface VoiceStats {
    /** 同时发声的最大声部数（按释放结束计算） */
    maxVoices: number;
    meanVoices: number;
    /** 尾音总时长 / 音符总时值，越大越容易浑浊 */
    tailRatio: number;
}

export function voiceStats(notes: readonly ScheduledNote[], options: NoteEndOptions, step = 0.02): VoiceStats {
    if (!notes.length) return { maxVoices: 0, meanVoices: 0, tailRatio: 0 };
    const events: { time: number; delta: number }[] = [];
    let voicedSeconds = 0;
    let totalDuration = 0;
    for (const note of notes) {
        const end = noteEnd(note, options);
        events.push({ time: note.start, delta: 1 });
        events.push({ time: end, delta: -1 });
        voicedSeconds += Math.max(0, end - note.start);
        totalDuration += Math.max(0.001, note.duration);
    }
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);
    let current = 0;
    let maxVoices = 0;
    let index = 0;
    let sampled = 0;
    let voiceSum = 0;
    const endTime = Math.max(...notes.map((note) => noteEnd(note, options)));
    for (let time = 0; time <= endTime; time += step) {
        while (index < events.length && events[index].time <= time) {
            current += events[index].delta;
            index++;
        }
        maxVoices = Math.max(maxVoices, current);
        voiceSum += current;
        sampled++;
    }
    return {
        maxVoices,
        meanVoices: sampled ? voiceSum / sampled : 0,
        tailRatio: voicedSeconds / Math.max(0.001, totalDuration),
    };
}

export interface VelocityBucket {
    layer: number;
    label: string;
    count: number;
    ratio: number;
}

export function velocityBuckets(notes: readonly LabNote[], mode: VelocityMode): VelocityBucket[] {
    const labels = mode === "layers2" ? ["弱 (vl2)", "—", "强 (vl4)"] : ["弱 (vl2)", "中 (vl3)", "强 (vl4)"];
    const counts = [0, 0, 0];
    for (const note of notes) counts[layerForVelocity(note.velocity, mode)]++;
    return counts
        .map((count, layer) => ({
            layer,
            label: mode === "single" ? (layer === 1 ? "单一层 (vl3)" : "—") : labels[layer],
            count,
            ratio: notes.length ? count / notes.length : 0,
        }))
        .filter((bucket) => bucket.count > 0 || mode !== "single");
}

export interface HistogramBin {
    from: number;
    to: number;
    count: number;
}

export function velocityHistogram(notes: readonly LabNote[], binSize = 8): HistogramBin[] {
    const bins = new Map<number, number>();
    for (const note of notes) {
        const value = clamp(Math.round(note.velocity * 127), 1, 127);
        const key = Math.floor(value / binSize) * binSize;
        bins.set(key, (bins.get(key) ?? 0) + 1);
    }
    return [...bins.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([from, count]) => ({ from, to: from + binSize - 1, count }));
}

export function durationBuckets(notes: readonly LabNote[]): { label: string; count: number }[] {
    const buckets = [
        { label: "<150ms", min: 0, max: 0.15, count: 0 },
        { label: "0.15–0.5s", min: 0.15, max: 0.5, count: 0 },
        { label: "0.5–1s", min: 0.5, max: 1, count: 0 },
        { label: "1–2s", min: 1, max: 2, count: 0 },
        { label: "2–4s", min: 2, max: 4, count: 0 },
        { label: ">4s", min: 4, max: Infinity, count: 0 },
    ];
    for (const note of notes) {
        const bucket = buckets.find((entry) => note.duration >= entry.min && note.duration < entry.max);
        if (bucket) bucket.count++;
    }
    return buckets.map(({ label, count }) => ({ label, count }));
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** 供 UI 显示的方案标签。 */
export const SCHEDULE_LABELS: Record<ScheduleMode, string> = {
    exact: "原始精确时间",
    "tick-ceil": "50ms 向上取整（游戏现状）",
    "tick-round": "最近 tick",
    "tick-round-lead": "最近 tick + 提前 1 tick",
    "tick-ceil-lead": "向上取整 + 提前 1 tick",
};

export const VELOCITY_LABELS: Record<VelocityMode, string> = {
    single: "单层采样 + 音量",
    layers2: "2 层真实采样",
    layers3: "3 层真实采样",
};

export const RELEASE_LABELS: Record<ReleaseMode, string> = {
    tier: "按音长切 0.5/2/4s 采样（游戏现状）",
    noteoff: "Note Off 后 120ms 释放",
    "noteoff-long": "Note Off 后 350ms 释放",
    natural: "忽略 Note Off，自然衰减",
};
