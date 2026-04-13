import { Dimension, Vector3 } from "@minecraft/server";
import { getSoundIdByDuration, processNote } from "@utils/note";
import { summonParticle } from "@utils/particle";
import { Signal } from "@utils/signal";
import {
    Cardinal_Direction,
    MidiInfo,
    MidiJson,
    MidiNote,
    NoteInfo,
} from "../types";
import { PlayQueue } from "./queue";

type PlayerState = "idle" | "playing" | "paused" | "stopped";

export class MidiPlayer {
    pos: Vector3;
    dir: Cardinal_Direction;
    dimension: Dimension;

    private notes: MidiNote[] = [];
    private noteIdx = 0;
    private currentTime = 0;
    private lastTime = Date.now();

    private state: PlayerState = "idle";

    private isLoading = false;

    readonly queue = new PlayQueue();
    /** 订阅信号 */
    readonly signal: Signal<void>;

    /** 最近活跃时间（用于LRU） */
    lastActiveTime = Date.now();

    private readonly MAX_DELTA = 0.1;

    constructor(dimension: Dimension, pos: Vector3, dir: Cardinal_Direction) {
        this.dimension = dimension;
        this.pos = pos;
        this.dir = dir;
        this.signal = new Signal();
    }

    /* ================== 工具 ================== */

    private hasContent() {
        return this.notes.length > 0;
    }

    /* ================== 控制接口 ================== */

    /** 加载队列当前指针的曲子并播放 */
    async play() {
        const info = this.queue.current();
        if (!info) {
            this.state = "idle";
            return;
        }

        await this.loadMidi(info);

        if (!this.hasContent()) {
            // 当前没内容，尝试自动找下一首
            this.prepareNext();
            return;
        }

        this.state = "playing";
        this.lastTime = Date.now();
    }

    pause() {
        if (this.state !== "playing") return;
        this.state = "paused";
    }

    resume() {
        if (this.state !== "paused") return;

        if (!this.hasContent()) {
            this.prepareNext();
            return;
        }

        this.state = "playing";
        this.lastTime = Date.now();
    }

    /** 重新加载当前队列指针的曲子并从头播放 */
    async restart() {
        const info = this.queue.current();
        if (!info) return;

        await this.loadMidi(info);
        this.state = "playing";
        this.lastTime = Date.now();
    }

    /** 停止播放（仅停止状态，不干预队列内容） */
    stop() {
        this.state = "stopped";
        this.notes = [];
        this.noteIdx = 0;
        this.currentTime = 0;
        this.isLoading = false;
    }

    /* ================== 调度 ================== */

    tick(now: number) {
        if (this.state === "stopped" || this.state === "idle") {
            this.lastTime = now;
            return;
        }

        const block = this.dimension.getBlock(this.pos);

        // 区块未加载
        if (!block) {
            this.lastTime = now;
            return;
        }

        // 方块没了 → 彻底失效
        if (block.typeId !== "xypiano:piano_left") {
            this.stop();
            return;
        }

        if (this.state === "paused") {
            this.lastTime = now;
            return;
        }

        // 正在异步加载中，跳过本次 tick
        if (this.isLoading) {
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

            this.playNote(info, note[2]);
            this.noteIdx++;
        }

        // 发布事件
        this.signal.publish();

        // 当前曲子播完 → 自动请求下一首
        if (this.noteIdx >= this.notes.length) {
            this.prepareNext();
        }
    }

    /* ================== 内部逻辑 ================== */

    /**
     * 内部自动连播核心：
     * 循环请求 queue.next()，直到有可播放的内容或队列结束
     */
    private async prepareNext() {
        if (this.isLoading) return;

        // 上锁并清空当前音符，防止 tick 再次触发
        this.isLoading = true;
        this.notes = [];

        while (true) {
            const nextInfo = this.queue.next();

            if (!nextInfo) {
                // 队列真的到底了
                this.state = "idle";
                this.isLoading = false;
                return;
            }

            await this.loadMidi(nextInfo);

            if (this.hasContent()) {
                // 找到能播的了，继续播放
                this.state = "playing";
                this.lastTime = Date.now();
                this.isLoading = false;
                return;
            }
            // 如果加载出来没音符（空曲子），while 循环继续请求下一个
        }
    }

    private async loadMidi(info: MidiInfo) {
        try {
            const midi = await info.value(); // 调用 MidiInfo 自身的加载方法获取 Json
            this.notes = this.extractNotes(midi);
        } catch (e) {
            console.error(`加载 MIDI 失败: ${info.name}`, e);
            this.notes = [];
        }

        this.noteIdx = 0;
        this.currentTime = 0;
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

    private playNote(info: NoteInfo, duration: number) {
        if (info.sample === "none") return;

        const id = getSoundIdByDuration(duration);

        this.dimension.playSound(`${id}.${info.sample}`, this.pos, {
            pitch: info.pitch,
            volume: 2,
        });
        // 生成粒子
        summonParticle(this.dimension, this.pos, this.dir, info.midi);
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

    getInfo() {
        return {
            pos: this.pos,
            dimension: this.dimension,
            state: this.state,
            midiName: this.queue.current()?.name ?? "unknown",
            totalNotes: this.notes.length,
            currentNoteIndex: this.noteIdx,
            progress:
                this.notes.length === 0 ? 0 : this.noteIdx / this.notes.length,
            currentTime: this.currentTime,
            queueIndex: this.queue.getIndex(),
            queueLength: this.queue.getLength(),
            lastActiveTime: this.lastActiveTime,
        };
    }
}
