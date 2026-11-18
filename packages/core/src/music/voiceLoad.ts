import { processNote } from "../midi/note.js";
import { OTHER_SCALE, TIME_SCALE } from "../constants.js";
import type { MidiSong } from "../types.js";
import { pbe3EventsToNoteEvents, readPbe3Events } from "../pbe3/codec.js";

/**
 * 声部负载模型：估算一首曲目在运行时会同时占用多少个音效实例。
 *
 * 运行时（`SoundReleaseQueue`）的实际行为：
 * - Note Off 后先淡出 `releaseSeconds` 再 stop，淡出期间仍占一个 SoundInstance；
 * - 采样自然播完（4s / pitch）后直接 stop：踏板把音符延长到 8 秒也不会白占名额；
 * - 同键重触发会把旧实例快速收起；
 * - 超长音符最多持有 `maxHeldSeconds`。
 *
 * 这里用同一套模型离线计算，导入时即可判断是否超过引擎上限。
 */

/**
 * Bedrock 客户端同时混音的音效数量上限。
 * 它是**整个客户端共享**的：钢琴、环境音、生物、其他玩家都在这 32 个名额里。
 */
export const BEDROCK_SIMULTANEOUS_SOUND = 32;

/**
 * 钢琴自己使用的声部预算。
 *
 * 不直接用满 32：淡出中的实例仍占名额，而且环境音/生物/另一架钢琴也在抢同一份预算。
 * 留 4 个名额给其他声源，超限时由我们主动挑“最不重要的音”收掉，
 * 好过让引擎随机截断某个正在响的音。
 */
export const PIANO_VOICE_BUDGET = 28;

/** Note Off 后的默认淡出时长（与运行时一致）。 */
export const DEFAULT_NOTE_RELEASE_SECONDS = 0.6;
/** 单个采样的基准长度；实际可闻时长 = 4s / pitch（高音更短、低音略长）。 */
export const DEFAULT_SAMPLE_SECONDS = 4;
/**
 * 实例持有的安全上限。
 *
 * 正常路径由采样长度决定（约 3.78~4.24s）；这里只防异常 pitch 或未来更长的
 * 采样，不应该被当成常规持有时间。旧版本用 8 秒，导致踏板长音在采样结束后的
 * 4 秒里仍然占着声部名额。
 */
export const DEFAULT_MAX_HELD_SECONDS = 5;
/** 同键重触发：旧实例淡出时长。 */
export const SAME_NOTE_FADE_SECONDS = 0.04;
/** 同键重触发：旧实例停止时间（相对新音符起点）。 */
export const SAME_NOTE_STOP_SECONDS = 0.1;

/** 秒制音符事件（与 PBE3 → NoteEvent 的字段一致）。 */
export interface VoiceLoadNote {
    midi: number;
    /** 起点（秒） */
    time: number;
    /** 时值（秒） */
    duration: number;
}

export interface VoiceLoadOptions {
    releaseSeconds?: number;
    sampleSeconds?: number;
    maxHeldSeconds?: number;
    /** 判定“超限”的阈值，默认引擎上限 32。 */
    limit?: number;
}

export interface VoiceLoadEstimate {
    noteCount: number;
    /** 同时发声（audible）的峰值 */
    peakVoices: number;
    /** 峰值出现的时间（秒） */
    peakTime: number;
    /** JS 仍持有 SoundInstance 的峰值（≥ peakVoices，淡出期间两者相同） */
    peakHandles: number;
    /** 95% 的时间发声数不超过该值 */
    p95Voices: number;
    /** 超过 limit 的累计时长（秒） */
    overLimitSeconds: number;
    /** 判定阈值 */
    limit: number;
    /** 峰值超出 limit 的数量（0 = 未超限） */
    excess: number;
}

interface Voice {
    start: number;
    audibleEnd: number;
    handleEnd: number;
}

interface SweepResult {
    peak: number;
    peakTime: number;
    /** 计数 → 累计持续秒数 */
    durationByCount: Map<number, number>;
    totalSeconds: number;
}

function sweep(intervals: readonly { start: number; end: number }[]): SweepResult {
    const events: { time: number; delta: number }[] = [];
    for (const interval of intervals) {
        const end = Math.max(interval.start, interval.end);
        events.push({ time: interval.start, delta: 1 }, { time: end, delta: -1 });
    }
    // 同一时刻先处理结束、再处理开始：首尾相接的两个音不算同时发声。
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);

    const durationByCount = new Map<number, number>();
    let count = 0;
    let peak = 0;
    let peakTime = 0;
    let previousTime = events[0]?.time ?? 0;
    let totalSeconds = 0;

    for (const event of events) {
        if (event.time > previousTime) {
            const span = event.time - previousTime;
            durationByCount.set(count, (durationByCount.get(count) ?? 0) + span);
            totalSeconds += span;
            previousTime = event.time;
        }
        count += event.delta;
        if (count > peak) {
            peak = count;
            peakTime = event.time;
        }
    }

    return { peak, peakTime, durationByCount, totalSeconds };
}

/**
 * 估算同时发声的峰值。输入可以是 PBE3 解码后的秒制事件，
 * 也可以由 `estimateSongVoiceLoad` / `estimatePbe3VoiceLoad` 转换。
 */
export function estimateVoiceLoad(
    notes: readonly VoiceLoadNote[],
    options: VoiceLoadOptions = {}
): VoiceLoadEstimate {
    const releaseSeconds = Math.max(0, options.releaseSeconds ?? DEFAULT_NOTE_RELEASE_SECONDS);
    const sampleSeconds = Math.max(0.05, options.sampleSeconds ?? DEFAULT_SAMPLE_SECONDS);
    const maxHeldSeconds = Math.max(0, options.maxHeldSeconds ?? DEFAULT_MAX_HELD_SECONDS);
    const limit = Math.max(1, Math.round(options.limit ?? BEDROCK_SIMULTANEOUS_SOUND));

    // PBE3 本身按时间有序；这里仍排序一次，兼容手写/测试输入。
    const sorted = [...notes].sort((a, b) => a.time - b.time);
    const voices: Voice[] = [];
    /** 每个音高只有最新一次触发可能仍在响（更早的都被同键重触发收掉了）。 */
    const latestByMidi = new Map<number, Voice>();

    for (const note of sorted) {
        const start = Math.max(0, note.time);
        const pitch = processNote(note.midi, false).pitch;
        const noteOff = start + Math.max(0.05, note.duration);
        const sampleEnd = start + sampleSeconds / pitch;
        const sampleFirst = noteOff > sampleEnd;
        const heldEnd = Math.min(noteOff, sampleEnd, start + maxHeldSeconds);
        const audibleEnd = Math.min(sampleEnd, noteOff + releaseSeconds);
        // 采样先放完时到点直接 stop；否则 Note Off 后还要占 releaseSeconds 的淡出时间。
        const handleEnd = heldEnd + (sampleFirst ? 0 : releaseSeconds + 0.1);

        const previous = latestByMidi.get(note.midi);
        if (previous && previous.handleEnd > start) {
            previous.audibleEnd = Math.min(previous.audibleEnd, start + SAME_NOTE_FADE_SECONDS);
            previous.handleEnd = Math.min(previous.handleEnd, start + SAME_NOTE_STOP_SECONDS);
        }

        const voice: Voice = { start, audibleEnd, handleEnd };
        voices.push(voice);
        latestByMidi.set(note.midi, voice);
    }

    const audible = sweep(voices.map(voice => ({ start: voice.start, end: voice.audibleEnd })));
    const handles = sweep(voices.map(voice => ({ start: voice.start, end: voice.handleEnd })));

    let overLimitSeconds = 0;
    let cumulative = 0;
    let p95Voices = 0;
    const counts = [...audible.durationByCount.keys()].sort((a, b) => a - b);
    for (const count of counts) {
        const seconds = audible.durationByCount.get(count) ?? 0;
        cumulative += seconds;
        if (count > limit) overLimitSeconds += seconds;
        if (cumulative >= audible.totalSeconds * 0.95) {
            p95Voices = count;
            break;
        }
    }

    return {
        noteCount: notes.length,
        peakVoices: audible.peak,
        peakTime: audible.peakTime,
        peakHandles: handles.peak,
        p95Voices,
        overLimitSeconds,
        limit,
        excess: Math.max(0, audible.peak - limit),
    };
}

/** 估算 MidiSong（转换中间结构，time/duration 为内部 tick）。 */
export function estimateSongVoiceLoad(
    song: MidiSong,
    options: VoiceLoadOptions = {}
): VoiceLoadEstimate {
    const notes: VoiceLoadNote[] = [];
    for (const track of song.tracks) {
        for (let i = 0; i + 3 < track.notes.length; i += 4) {
            notes.push({
                midi: track.notes[i],
                time: track.notes[i + 1] / TIME_SCALE,
                duration: track.notes[i + 2] / OTHER_SCALE,
            });
        }
    }
    return estimateVoiceLoad(notes, options);
}

/** 估算一份完整 PBE3 的声部负载（导入校验用）。 */
export function estimatePbe3VoiceLoad(
    data: Uint8Array,
    options: VoiceLoadOptions = {}
): VoiceLoadEstimate {
    const { header, events } = readPbe3Events(data);
    return estimateVoiceLoad(
        pbe3EventsToNoteEvents(events, header.palette, header.velocityBits),
        options
    );
}

/** 面向 UI 的警告文案；未超限返回 undefined。 */
export function formatVoiceLoadWarning(
    estimate: VoiceLoadEstimate,
    name = "此曲",
    limit = estimate.limit
): string | undefined {
    if (estimate.peakVoices <= limit) return undefined;
    return (
        `${name}最密集处同时发声 ${estimate.peakVoices} 个（第 ${estimate.peakTime.toFixed(1)} 秒），` +
        `超过游戏上限 ${limit} 个；超限部分会自动省略较弱的音。`
    );
}
