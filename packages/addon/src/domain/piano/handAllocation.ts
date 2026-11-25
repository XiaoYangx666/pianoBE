export type HandSide = "left" | "right";
export type HandZoneIndex = 0 | 1 | 2 | 3 | 4;

export interface HandStrike {
    readonly pos: number;
    readonly zone: HandZoneIndex;
    readonly black: boolean;
}

export interface AllocatedHands {
    readonly left?: HandStrike;
    readonly right?: HandStrike;
}

export const DEFAULT_LEFT_POS = -0.35;
export const DEFAULT_RIGHT_POS = 0.35;

const DEFAULT_REACH_UNITS = 11.5;
const CENTER_OVERLAP = 0.18;
const SPLIT_SPAN_THRESHOLD = 0.26;
const MIN_GAP_SPLIT = 0.14;
const MIN_HAND_SEPARATION = 0.14;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return value < min ? min : value > max ? max : value;
}

export function isBlackMidiKey(midi: number): boolean {
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    return BLACK_PITCH_CLASSES.has(pc);
}

/**
 * 将 MIDI 音高映射到相对演奏者正前方的横向归一化位置：
 * 负值在玩家左手侧（低音区），正值在玩家右手侧（高音区）。
 */
export function mapMidiToPlayerPos(
    midi: number,
    playerLocalX: number,
    keyCenters: ReadonlyMap<number, readonly [number, number, number]>
): number {
    const clamped = clamp(midi, 21, 108);
    const center = keyCenters.get(Math.round(clamped));
    // PianoBE 模型 X 轴：低音 (MIDI 21) 在 +14.84，高音 (MIDI 108) 在 -14.84。
    const keyModelX = center ? center[0] : 14.84 - ((clamped - 21) / 87) * 29.68;
    return clamp((playerLocalX - keyModelX) / DEFAULT_REACH_UNITS, -1, 1);
}

export function quantizeHandZone(side: HandSide, pos: number): HandZoneIndex {
    const outer = side === "left"
        ? clamp((-pos - 0.04) / 0.68, 0, 1)
        : clamp((pos - 0.04) / 0.68, 0, 1);
    return Math.round(outer * 4) as HandZoneIndex;
}

function summarizeCluster(
    cluster: readonly { pos: number; black: boolean }[],
    minPos: number,
    maxPos: number
): { pos: number; black: boolean } {
    let sum = 0;
    let blackCount = 0;
    for (const item of cluster) {
        sum += item.pos;
        if (item.black) blackCount++;
    }
    return {
        pos: clamp(sum / cluster.length, minPos, maxPos),
        black: blackCount * 2 >= cluster.length,
    };
}

/**
 * 基于玩家相对站位、上一拍手位惯性、和弦最大间隙与防交叉约束分配左右手目标。
 */
export function allocateHands(
    midis: readonly number[],
    playerLocalX: number,
    keyCenters: ReadonlyMap<number, readonly [number, number, number]>,
    prevLeftPos = DEFAULT_LEFT_POS,
    prevRightPos = DEFAULT_RIGHT_POS
): AllocatedHands {
    if (midis.length === 0) return {};

    const mapped = midis
        .map(midi => ({
            pos: mapMidiToPlayerPos(midi, playerLocalX, keyCenters),
            black: isBlackMidiKey(midi),
        }))
        .sort((a, b) => a.pos - b.pos);

    const leftNotes: typeof mapped = [];
    const rightNotes: typeof mapped = [];

    if (mapped.length === 1) {
        const single = mapped[0];
        if (single.pos < -CENTER_OVERLAP) {
            leftNotes.push(single);
        } else if (single.pos > CENTER_OVERLAP) {
            rightNotes.push(single);
        } else {
            const distLeft = Math.abs(single.pos - prevLeftPos);
            const distRight = Math.abs(single.pos - prevRightPos);
            const chooseLeft = distLeft === distRight ? single.pos < 0 : distLeft < distRight;
            if (chooseLeft) leftNotes.push(single);
            else rightNotes.push(single);
        }
    } else {
        const minPos = mapped[0].pos;
        const maxPos = mapped[mapped.length - 1].pos;
        const span = maxPos - minPos;
        const crossesCenter = minPos < -0.05 && maxPos > 0.05;

        if (span > SPLIT_SPAN_THRESHOLD || crossesCenter) {
            let bestGap = -1;
            let bestSplit = 1;
            for (let i = 1; i < mapped.length; i++) {
                const gap = mapped[i].pos - mapped[i - 1].pos;
                if (gap > bestGap) {
                    bestGap = gap;
                    bestSplit = i;
                }
            }

            let splitIndex: number;
            if (bestGap > MIN_GAP_SPLIT) {
                splitIndex = bestSplit;
            } else if (crossesCenter) {
                const zeroIdx = mapped.findIndex(item => item.pos >= 0);
                splitIndex = clamp(zeroIdx === -1 ? Math.ceil(mapped.length / 2) : zeroIdx, 1, mapped.length - 1);
            } else {
                splitIndex = Math.ceil(mapped.length / 2);
            }

            for (let i = 0; i < mapped.length; i++) {
                if (i < splitIndex) leftNotes.push(mapped[i]);
                else rightNotes.push(mapped[i]);
            }
        } else {
            let sum = 0;
            for (const item of mapped) sum += item.pos;
            const centroid = sum / mapped.length;
            let chooseLeft: boolean;
            if (Math.abs(centroid) <= CENTER_OVERLAP) {
                const distLeft = Math.abs(centroid - prevLeftPos);
                const distRight = Math.abs(centroid - prevRightPos);
                chooseLeft = distLeft === distRight ? centroid < 0 : distLeft < distRight;
            } else {
                chooseLeft = centroid < 0;
            }
            if (chooseLeft) leftNotes.push(...mapped);
            else rightNotes.push(...mapped);
        }
    }

    let leftCluster = leftNotes.length > 0 ? summarizeCluster(leftNotes, -1, 0.25) : undefined;
    let rightCluster = rightNotes.length > 0 ? summarizeCluster(rightNotes, -0.25, 1) : undefined;

    if (leftCluster && rightCluster && leftCluster.pos > rightCluster.pos - MIN_HAND_SEPARATION) {
        const mid = (leftCluster.pos + rightCluster.pos) / 2;
        const adjLeft = clamp(mid - MIN_HAND_SEPARATION / 2, -1, 0.25);
        const adjRight = clamp(adjLeft + MIN_HAND_SEPARATION, -0.25, 1);
        leftCluster = { ...leftCluster, pos: adjLeft };
        rightCluster = { ...rightCluster, pos: adjRight };
    }

    return {
        left: leftCluster
            ? { pos: leftCluster.pos, zone: quantizeHandZone("left", leftCluster.pos), black: leftCluster.black }
            : undefined,
        right: rightCluster
            ? { pos: rightCluster.pos, zone: quantizeHandZone("right", rightCluster.pos), black: rightCluster.black }
            : undefined,
    };
}

export function handTimelineClip(side: HandSide, strike: HandStrike): string {
    return `animation.pbe.performer.${side === "left" ? "l" : "r"}.${strike.zone}${strike.black ? "b" : "w"}`;
}
