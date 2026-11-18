/**
 * 延音踏板（MIDI CC64）烘焙工具。
 *
 * PBE3 只有“音符持续时长”一个字段，没有控制器事件。这里在转换阶段把
 * 踏板保持的时间合并进 duration：Note Off 时若踏板仍按下，就把音符延长
 * 到踏板抬起，最多延长 MAX_SUSTAIN_EXTENSION_SECONDS 秒。
 */

/** @tonejs/midi 的 control change 最小结构。 */
export interface ControlChangeLike {
    /** 发生时间（秒） */
    time: number;
    /** 归一化值 0~1；CC64 >= 0.5 视为踩下 */
    value: number;
}

/** 参与踏板收集的轨道最小结构。 */
export interface SustainTrackLike {
    controlChanges: Record<number, readonly ControlChangeLike[]>;
}

/** 踏板按下的时间段（秒）。 */
export interface SustainSegment {
    start: number;
    /** Infinity 表示直到曲尾都没有抬起 */
    end: number;
}

/**
 * 单个音符因踏板最多再延长的秒数。
 *
 * 采样只有 4 秒，延长超过采样长度不会再发声；旧版本用 8 秒，会让 PBE3 里
 * 留下大量“僵尸时长”。运行时现在按 `4s / pitch` 提前释放实例，这里把烘焙
 * 上限也收到 4 秒，避免新导入的曲目继续产生无意义的尾巴。
 */
export const MAX_SUSTAIN_EXTENSION_SECONDS = 4;

/**
 * 收集所有轨道的 CC64 并合并为踏板按下时间段。
 *
 * 曲目在 PBE3 中会被合并成单条事件流，因此这里也按全局时间线处理，
 * 不区分 MIDI 通道；对本项目的纯钢琴曲目足够，也能兼容“踏板单独一条轨”的文件。
 */
export function collectSustainSegments(tracks: Iterable<SustainTrackLike>): SustainSegment[] {
    const points: { time: number; down: boolean }[] = [];
    for (const track of tracks) {
        const cc = track.controlChanges?.[64];
        if (!cc) continue;
        for (const event of cc) {
            points.push({ time: event.time, down: event.value >= 0.5 });
        }
    }
    if (points.length === 0) return [];
    points.sort((a, b) => a.time - b.time);

    const segments: SustainSegment[] = [];
    let start: number | undefined;
    for (const point of points) {
        if (point.down) {
            if (start === undefined) start = point.time;
        } else if (start !== undefined) {
            if (point.time > start) segments.push({ start, end: point.time });
            start = undefined;
        }
    }
    if (start !== undefined) segments.push({ start, end: Infinity });
    return segments;
}

/**
 * 音符在 noteEnd 时刻松开时，因踏板还应额外持续多少秒。
 * 不在踏板区间内返回 0；区间未闭合时按上限返回。
 */
export function sustainExtensionSeconds(
    noteEnd: number,
    segments: readonly SustainSegment[],
    cap = MAX_SUSTAIN_EXTENSION_SECONDS
): number {
    if (segments.length === 0) return 0;
    let low = 0;
    let high = segments.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (segments[mid].start <= noteEnd) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    if (found < 0) return 0;
    const segment = segments[found];
    if (noteEnd >= segment.end) return 0;
    return Math.min(segment.end - noteEnd, cap);
}
