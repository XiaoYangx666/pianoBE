import { Dimension, Vector3 } from "@minecraft/server";
import { processNote } from "@utils/note";
import { Signal } from "@utils/signal";
import { MidiJson, MidiNote, NoteInfo } from "../types";
import { PlayQueue } from "./queue";

type PlayerState = "idle" | "playing" | "paused" | "stopped";

export class MidiPlayer {
    pos: Vector3;
    dimension: Dimension;

    private notes: MidiNote[] = [];
    private noteIdx = 0;
    private currentTime = 0;
    private lastTime = Date.now();

    private state: PlayerState = "idle";

    /** 当前 MIDI */
    private currentMidi?: MidiJson;

    /** 使用 PlayQueue */
    queue = new PlayQueue();

    /** 订阅信号 */
    readonly signal: Signal<void>;

    /** 最近活跃时间（用于LRU） */
    lastActiveTime = Date.now();

    private readonly MAX_DELTA = 0.1;

    constructor(dimension: Dimension, pos: Vector3) {
        this.dimension = dimension;
        this.pos = pos;
        this.signal = new Signal();
    }

    /* ================== 工具 ================== */

    private hasContent() {
        return this.notes.length > 0;
    }

    /* ================== 控制接口 ================== */

    /** 立即播放（替换当前） */
    play(midi: MidiJson) {
        const m = this.queue.play(midi);

        this.loadMidi(m);

        if (!this.hasContent()) {
            this.playNext();
            return;
        }

        this.state = "playing";
    }

    playAt(index: number) {
        if (this.state === "stopped") return;

        const midi = this.queue.jump(index);
        if (!midi) return;

        this.loadMidi(midi);

        if (!this.hasContent()) {
            this.playNext();
            return;
        }

        this.state = "playing";
    }

    /** 加入队列（连播） */
    enqueue(midi: MidiJson) {
        const m = this.queue.enqueue(midi);

        if (this.state === "idle" && m) {
            this.loadMidi(m);
            this.state = "playing";
        }
    }

    pause() {
        if (this.state !== "playing") return;

        if (!this.hasContent()) {
            this.state = "idle";
            return;
        }

        this.state = "paused";
    }

    resume() {
        if (this.state !== "paused") return;

        if (!this.hasContent()) {
            this.playNext();
            return;
        }

        this.state = "playing";
        this.lastTime = Date.now();
    }

    restart() {
        if (!this.currentMidi) return;

        this.loadMidi(this.currentMidi);
        this.state = "playing";
    }

    stop() {
        this.state = "stopped";
        this.queue.clear();
    }

    idle() {
        this.state = "idle";
    }

    /** 下一首 */
    next() {
        if (this.state === "stopped") return;
        this.playNext();
    }

    /** 上一首 */
    prev() {
        if (this.state === "stopped") return;

        const prev = this.queue.prev();
        if (!prev) return;

        this.loadMidi(prev);

        if (!this.hasContent()) {
            this.playNext();
            return;
        }

        this.state = "playing";
    }

    /* ================== 调度 ================== */

    update(now: number) {
        if (this.state === "stopped") return;

        const block = this.dimension.getBlock(this.pos);

        // 区块未加载
        if (!block) {
            this.lastTime = now;
            return;
        }

        // 方块没了 → 彻底失效
        if (block.typeId !== "xypiano:piano_left") {
            this.state = "stopped";
            return;
        }

        // 空内容兜底
        if (!this.hasContent()) {
            this.lastTime = now;

            if (this.state === "playing") {
                this.playNext();
            }

            return;
        }

        if (this.state === "paused" || this.state === "idle") {
            this.lastTime = now;
            return;
        }

        // ⭐ 标记活跃
        this.lastActiveTime = now;

        // 时间推进
        const realDelta = (now - this.lastTime) / 1000;
        const delta = Math.min(realDelta, this.MAX_DELTA);

        this.currentTime += delta;
        this.lastTime = now;

        // 播放 note
        while (
            this.noteIdx < this.notes.length &&
            this.notes[this.noteIdx][1] <= this.currentTime
        ) {
            const note = this.notes[this.noteIdx];
            const info = processNote(note[0], false);

            this.playNote(info, note[3], note[2]);

            this.noteIdx++;
        }

        // 发布事件
        this.signal.publish();

        // 当前曲子结束
        if (this.noteIdx >= this.notes.length) {
            this.playNext();
        }
    }

    /* ================== 内部 ================== */

    private playNext() {
        while (true) {
            const next = this.queue.next();

            if (!next) {
                this.state = "idle";
                return;
            }

            this.loadMidi(next);

            if (this.hasContent()) {
                this.state = "playing";
                return;
            }
        }
    }

    private loadMidi(midi: MidiJson) {
        this.currentMidi = midi;

        this.notes = this.extractNotes(midi);
        this.noteIdx = 0;
        this.currentTime = 0;
        this.lastTime = Date.now();

        if (this.notes.length === 0) {
            this.playNext();
        }
    }

    private extractNotes(midi: MidiJson): MidiNote[] {
        const all: MidiNote[] = [];

        if (midi.tracks.length === 1) {
            return midi.tracks[0].notes ?? [];
        }

        for (const track of midi.tracks) {
            if (track.notes) {
                all.push(...track.notes);
            }
        }

        return all.sort((a, b) => a[1] - b[1]);
    }

    private playNote(info: NoteInfo, velocity: number, duration: number) {
        if (info.sample === "none") return;

        const id = getIdByDuration(duration);

        this.dimension.playSound(`${id}.${info.sample}`, this.pos, {
            pitch: info.pitch,
            volume: Math.min(velocity, 1),
        });
    }

    /* ================== 状态判断 ================== */

    isAlive() {
        return this.state !== "stopped";
    }

    isPlaying() {
        return this.state === "playing";
    }

    /* ================== 对外查询接口 ================== */

    getState(): PlayerState {
        return this.state;
    }

    getCurrentMidi() {
        return {
            name: this.currentMidi?.name ?? "unknown",
            totalNotes: this.notes.length,
            currentNoteIndex: this.noteIdx,
            progress:
                this.notes.length === 0 ? 0 : this.noteIdx / this.notes.length,
        };
    }

    getQueue() {
        return this.queue.getQueue();
    }

    getTime() {
        return {
            currentTime: this.currentTime,
        };
    }

    getInfo() {
        return {
            pos: this.pos,
            dimension: this.dimension,

            state: this.state,

            midiName: this.currentMidi?.name ?? "unknown",

            totalNotes: this.notes.length,
            currentNoteIndex: this.noteIdx,
            progress:
                this.notes.length === 0 ? 0 : this.noteIdx / this.notes.length,

            currentTime: this.currentTime,

            queueIndex: this.queue.getIndex(),
            queueLength: this.queue.getLength(),
            queue: this.queue.getQueue(),

            lastActiveTime: this.lastActiveTime,
        };
    }
}

/** 根据note时长获取音效id */
function getIdByDuration(duration: number) {
    if (duration < 1) {
        return "piano_short";
    } else if (duration > 4) {
        return "piano_long";
    } else {
        return "piano";
    }
}
