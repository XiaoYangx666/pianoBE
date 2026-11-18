import { PBE3_SEEK_INDEX_STEP_TICKS, type Pbe3SeekIndexEntry } from "./format.js";
import { readVarUint, type VarintResult } from "../binary/varint.js";

/** 扫描事件流，建立稀疏跳转索引。 */
export function buildPbe3SeekIndex(
    events: Uint8Array,
    velocityBits: number,
    stepTicks = PBE3_SEEK_INDEX_STEP_TICKS
): Pbe3SeekIndexEntry[] {
    const index: Pbe3SeekIndexEntry[] = [];
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
        if (count === 0) throw new Error("[pbe3] 事件组音符数为 0");
        if (count > Math.floor((events.length - pos) / 2)) {
            throw new Error("[pbe3] 事件组音符数异常");
        }

        if (time >= nextMark) {
            index.push({ ticks: time, offset: headerOffset, noteIndex });
            while (nextMark <= time) nextMark += step;
        }

        pos += Math.ceil((count * velocityBits) / 8);
        if (pos > events.length) throw new Error("[pbe3] 力度索引数据被截断");

        for (let i = 0; i < count; i++) {
            if (pos >= events.length) throw new Error("[pbe3] 音符数据被截断");
            const midiAndFlag = events[pos++];
            readVarUint(events, pos, out);
            pos = out.next; // soundDuration
            if ((midiAndFlag & 0x80) !== 0) {
                readVarUint(events, pos, out);
                pos = out.next; // keyDuration
            }
        }
        noteIndex += count;
    }
    return index;
}

/** 顺序读取 PBE3 事件流的光标。 */
export class Pbe3EventCursor {
    private readonly out: VarintResult = { value: 0, next: 0 };
    private pos = 0;
    private groupTime = 0;
    private groupCount = 0;
    private groupVelocities: number[] = [];
    private groupVelocityIndex = 0;
    private ended = false;
    private notesRead = 0;

    constructor(
        private readonly events: Uint8Array,
        private readonly index: readonly Pbe3SeekIndexEntry[],
        private readonly palette: readonly number[],
        private readonly velocityBits: number
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
    next():
        | {
              time: number;
              midi: number;
              soundDuration: number;
              keyDuration: number;
              velocity: number;
          }
        | undefined {
        if (!this.loadGroup()) return undefined;
        if (this.pos >= this.events.length) {
            this.ended = true;
            return undefined;
        }
        const midiAndFlag = this.events[this.pos++];
        const midi = midiAndFlag & 0x7f;
        const hasKey = (midiAndFlag & 0x80) !== 0;
        readVarUint(this.events, this.pos, this.out);
        const soundDuration = this.out.value;
        this.pos = this.out.next;
        let keyDuration = soundDuration;
        if (hasKey) {
            readVarUint(this.events, this.pos, this.out);
            keyDuration = this.out.value;
            this.pos = this.out.next;
        }
        const velocity = this.palette[this.groupVelocities[this.groupVelocityIndex++]];
        if (velocity === undefined) throw new Error("[pbe3] 力度索引越界");
        this.groupCount--;
        this.notesRead++;
        return { time: this.groupTime, midi, soundDuration, keyDuration, velocity };
    }

    /** 回到开头 */
    reset() {
        this.pos = 0;
        this.groupTime = 0;
        this.groupCount = 0;
        this.groupVelocities = [];
        this.groupVelocityIndex = 0;
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
            this.groupVelocities = [];
            this.groupVelocityIndex = 0;
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
        if (this.groupCount <= 0) throw new Error("[pbe3] 事件组音符数非法");
        if (this.groupCount > Math.floor((this.events.length - this.pos) / 2)) {
            throw new Error("[pbe3] 事件组音符数异常");
        }

        const bytes = Math.ceil((this.groupCount * this.velocityBits) / 8);
        if (this.pos + bytes > this.events.length) throw new Error("[pbe3] 力度索引数据被截断");
        const indices = new Array<number>(this.groupCount);
        let bit = 0;
        for (let i = 0; i < this.groupCount; i++) {
            let value = 0;
            for (let b = 0; b < this.velocityBits; b++) {
                value |= ((this.events[this.pos + (bit >> 3)] >> (bit & 7)) & 1) << b;
                bit++;
            }
            indices[i] = value;
        }
        this.pos += bytes;
        this.groupVelocities = indices;
        this.groupVelocityIndex = 0;
        return true;
    }
}

/** 二分查找最后一个 ticks <= target 的索引项 */
function lastEntryAtOrBefore(
    index: readonly Pbe3SeekIndexEntry[],
    target: number
): Pbe3SeekIndexEntry | undefined {
    let lo = 0;
    let hi = index.length - 1;
    let found: Pbe3SeekIndexEntry | undefined;
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
