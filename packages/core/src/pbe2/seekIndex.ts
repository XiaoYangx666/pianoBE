import { SEEK_INDEX_STEP_TICKS, type SeekIndexEntry } from "./format.js";
import { readVarUint, type VarintResult } from "./varint.js";

/**
 * 扫描事件流建立共享稀疏索引。
 * 索引只在曲目加载时构建一次，多个钢琴的游标共享同一份。
 */
export function buildSeekIndex(
    events: Uint8Array,
    hasVelocity = false,
    stepTicks = SEEK_INDEX_STEP_TICKS
): SeekIndexEntry[] {
    const index: SeekIndexEntry[] = [];
    const out: VarintResult = { value: 0, next: 0 };
    const step = Math.max(1, stepTicks);
    let nextMark = 0;
    let pos = 0;
    let time = 0;
    let noteIndex = 0;

    while (pos < events.length) {
        const headerOffset = pos;
        readVarUint(events, pos, out);
        time += out.value;
        pos = out.next;
        readVarUint(events, pos, out);
        const count = out.value;
        pos = out.next;
        if (count === 0) throw new Error("[pbe2] 事件组音符数为 0");

        if (time >= nextMark) {
            index.push({ ticks: time, offset: headerOffset, noteIndex });
            while (nextMark <= time) nextMark += step;
        }

        for (let i = 0; i < count; i++) {
            if (pos >= events.length) throw new Error("[pbe2] 音符数据被截断");
            pos++; // midi
            readVarUint(events, pos, out);
            pos = out.next; // duration
            if (hasVelocity) {
                readVarUint(events, pos, out);
                pos = out.next;
            }
        }
        noteIndex += count;
    }
    return index;
}

/**
 * 单钢琴独立播放游标。
 * 同一份事件流可创建任意多个游标；游标只持有读取位置，不复制曲目数据。
 */
export class EventCursor {
    private readonly out: VarintResult = { value: 0, next: 0 };
    private pos = 0;
    private groupTime = 0;
    private groupCount = 0;
    private ended = false;
    private notesRead = 0;

    constructor(
        private readonly events: Uint8Array,
        private readonly index: readonly SeekIndexEntry[],
        private readonly hasVelocity = false
    ) {}

    /** 全部事件是否已经取完 */
    get done(): boolean {
        if (this.ended) return true;
        if (this.groupCount > 0) return false;
        if (this.pos >= this.events.length) {
            this.ended = true;
            return true;
        }
        try {
            this.loadGroup();
        } catch {
            this.ended = true;
        }
        return this.ended;
    }

    /** 已读取（含快进跳过）的音符数，用于进度显示 */
    get noteIndex(): number {
        return this.notesRead;
    }

    /** 下一个事件组的绝对时间（tick）；已结束返回 Infinity */
    peekTime(): number {
        if (!this.loadGroup()) return Infinity;
        return this.groupTime;
    }

    /** 取下一条音符；已结束返回 undefined */
    next(): { time: number; midi: number; duration: number; velocity: number } | undefined {
        if (!this.loadGroup()) return undefined;
        if (this.pos >= this.events.length) {
            this.ended = true;
            return undefined;
        }
        const midi = this.events[this.pos++];
        readVarUint(this.events, this.pos, this.out);
        const duration = this.out.value;
        this.pos = this.out.next;
        let velocity = 100;
        if (this.hasVelocity) {
            readVarUint(this.events, this.pos, this.out);
            velocity = this.out.value;
            this.pos = this.out.next;
        }
        this.groupCount--;
        this.notesRead++;
        return { time: this.groupTime, midi, duration, velocity };
    }

    /** 回到开头 */
    reset() {
        this.pos = 0;
        this.groupTime = 0;
        this.groupCount = 0;
        this.ended = false;
        this.notesRead = 0;
    }

    /**
     * 跳转到目标 tick（40/秒）。
     * 使用共享稀疏索引定位最近的组头，再顺序跳过索引间隔内的事件。
     */
    seek(targetTicks: number) {
        const target = Math.max(0, targetTicks);
        this.reset();
        if (target <= 0) return;

        const entry = lastEntryAtOrBefore(this.index, target);
        if (entry) {
            readVarUint(this.events, entry.offset, this.out);
            // 组头里的时间差是相对上一组的；先减掉，loadGroup 时会重新加上。
            this.groupTime = entry.ticks - this.out.value;
            this.pos = entry.offset;
            this.groupCount = 0;
            this.notesRead = entry.noteIndex;
        }

        // 索引间隔内的音符直接跳过（不发声），保留目标时刻及之后的音符。
        while (!this.ended) {
            const time = this.peekTime();
            if (time >= target || time === Infinity) break;
            this.next();
        }
    }

    private loadGroup(): boolean {
        if (this.ended) return false;
        if (this.groupCount > 0) return true;
        if (this.pos >= this.events.length) {
            this.ended = true;
            return false;
        }
        readVarUint(this.events, this.pos, this.out);
        this.groupTime += this.out.value;
        this.pos = this.out.next;
        readVarUint(this.events, this.pos, this.out);
        this.groupCount = this.out.value;
        this.pos = this.out.next;
        if (this.groupCount <= 0) throw new Error("[pbe2] 事件组音符数非法");
        return true;
    }
}

/** 二分查找最后一个 ticks <= target 的索引项 */
export function lastEntryAtOrBefore(
    index: readonly SeekIndexEntry[],
    target: number
): SeekIndexEntry | undefined {
    let lo = 0;
    let hi = index.length - 1;
    let found: SeekIndexEntry | undefined;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const entry = index[mid];
        if (entry.ticks <= target) {
            found = entry;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}
