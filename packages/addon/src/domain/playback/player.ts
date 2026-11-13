import { processNote } from "@domain/util/note";
import { Signal } from "@domain/util/signal";
import { EventCursor, OTHER_SCALE, TIME_SCALE, type MidiSongMeta, type SongHandle } from "@piano/core";
import { NoteInfo } from "@domain/types";
import { PlayQueue } from "./queue";
import type { PlaybackRecord } from "@domain/playback/playbackRecord";

type PlayerState = "idle" | "playing" | "paused" | "stopped";

interface MidiOutput {
    note(note: NoteInfo, duration: number): void;
    playing(value: boolean): void;
}

/** 播放器只需要“按 id 获取共享曲目引用”，缓存策略由 SongCache 统一负责。 */
export interface MidiLoader {
    acquire(id: string): Promise<SongHandle | undefined>;
}

export class MidiPlayer {
    /** 当前曲目引用（持有期间 SongCache 不会淘汰事件流） */
    private song?: SongHandle;
    private cursor?: EventCursor;
    private totalNotes = 0;
    private currentTime = 0;

    private lastTime = Date.now();

    private state: PlayerState = "idle";

    private isLoading = false;
    private generation = 0;

    readonly queue = new PlayQueue();
    readonly signal: Signal<void>;
    /** 播放器真正结束（runtime 销毁/换琴）时触发；UI view model 用它解绑。 */
    readonly disposedSignal: Signal<void>;

    lastActiveTime = Date.now();

    private readonly MAX_DELTA = 0.1;

    constructor(private readonly loader: MidiLoader, private readonly output: MidiOutput) {
        this.signal = new Signal();
        this.disposedSignal = new Signal();
    }

    /* ================== 工具 ================== */

    private hasContent() {
        return this.cursor !== undefined;
    }

    checkpoint(): PlaybackRecord | undefined {
        if (this.state === "stopped" || this.isLoading) return;
        return { version: 1, ...this.queue.snapshot(), state: this.state, seconds: this.currentTime };
    }

    async restore(record: PlaybackRecord) {
        this.queue.restore(record);
        const song = this.queue.current();
        if (!song || record.state === "idle") return;
        const generation = ++this.generation;
        this.isLoading = true;
        await this.loadMidi(song, generation);
        if (generation !== this.generation) return;
        this.isLoading = false;
        this.state = "paused";
        this.currentTime = record.seconds;
        if (!this.hasContent()) return;
        this.seek(record.seconds);
        if (record.state === "playing") this.resume();
    }

    /* ================== 控制接口 ================== */

    async play() {
        if (!this.isAlive()) return;
        const generation = ++this.generation;
        const info = this.queue.current();
        if (!info) {
            this.state = "idle";
            this.isLoading = false;
            this.output.playing(false);
            return;
        }

        this.isLoading = true;
        await this.loadMidi(info, generation);
        if (generation !== this.generation) return;
        this.isLoading = false;

        if (!this.hasContent()) {
            this.prepareNext();
            return;
        }

        this.state = "playing";
        this.output.playing(true);
        this.lastTime = Date.now();
    }

    pause() {
        if (this.state !== "playing") return;
        this.state = "paused";
        this.output.playing(false);
    }

    resume() {
        if (this.state !== "paused") return;

        if (!this.hasContent()) {
            this.prepareNext();
            return;
        }

        this.state = "playing";
        this.output.playing(true);
        this.lastTime = Date.now();
    }

    async restart() {
        if (this.queue.current()) await this.play();
    }

    /**
     * 快进/回退：跳转到指定秒数（0 ≤ t ≤ 曲目时长），从该位置继续。
     * 不改变播放/暂停状态；idle/stopped 时恢复为播放。
     * 使用共享稀疏索引定位，再在索引间隔内顺序解码。
     */
    seek(positionSec: number) {
        if (!this.cursor || !this.song) return;

        const durationSec = this.song.song.duration / TIME_SCALE;
        const target = Math.max(0, Math.min(positionSec, durationSec || positionSec));

        this.currentTime = target;
        this.cursor.seek(target * TIME_SCALE);

        if (this.state === "idle" || this.state === "stopped") {
            this.state = "playing";
            this.output.playing(true);
            this.lastTime = Date.now();
        }

        this.signal.publish();
    }

    end() {
        this.generation++;
        this.state = "stopped";
        this.output.playing(false);
        this.releaseSong();
        this.currentTime = 0;
        this.isLoading = false;
        this.queue.clear();
        this.signal.publish();
        this.signal.dispose();
        this.disposedSignal.publish();
        this.disposedSignal.dispose();
    }

    /* ================== 调度 ================== */

    holdClock(now: number) { this.lastTime = now; }

    tick(now: number) {
        if (this.state === "stopped") {
            return;
        }

        if (this.state === "paused" || this.state === "idle") {
            this.lastTime = now;
            return;
        }

        if (this.isLoading) {
            this.lastTime = now;
            return;
        }

        this.lastActiveTime = now;

        const realDelta = (now - this.lastTime) / 1000;
        const delta = Math.min(realDelta, this.MAX_DELTA);

        this.currentTime += delta;
        this.lastTime = now;

        this.processPlayback();

        this.signal.publish();

        // ✅ 判断是否全部播放完
        if (this.isSongFinished()) {
            this.prepareNext();
        }
    }

    /* ================== 内部逻辑 ================== */

    /**
     * 事件流只记录音符起点，最后一个音的长音尾不在游标里；
     * 文件头时长按音符结束时间编码，所以两者都结束才算播完，
     * 否则尾音会在切歌瞬间被截断（显示时长也会比实际播放长）。
     */
    private isSongFinished(): boolean {
        if (!this.cursor) return true;
        if (!this.cursor.done) return false;
        const durationSec = (this.song?.song.duration ?? 0) / TIME_SCALE;
        return durationSec <= 0 || this.currentTime >= durationSec;
    }

    private async prepareNext() {
        if (this.isLoading) return;

        this.isLoading = true;
        const generation = ++this.generation;

        // 释放当前曲目引用，再从队列取下一首
        this.releaseSong();
        this.totalNotes = 0;

        const limit = this.queue.getLength();
        for (let attempt = 0; attempt < limit; attempt++) {
            const nextInfo = this.queue.next();
            if (!nextInfo) break;
            await this.loadMidi(nextInfo, generation);
            if (generation !== this.generation) return;

            if (this.hasContent()) {
                this.state = "playing";
                this.output.playing(true);
                this.lastTime = Date.now();
                this.isLoading = false;
                return;
            }
        }
        this.state = "idle";
        this.output.playing(false);
        this.isLoading = false;
    }

    private processPlayback() {
        const cursor = this.cursor;
        if (!cursor) return;
        const ticks = this.currentTime * TIME_SCALE;

        while (true) {
            const time = cursor.peekTime();
            if (time > ticks || time === Infinity) break;
            const note = cursor.next();
            if (!note) break;
            this.playNote(processNote(note.midi, false), note.duration / OTHER_SCALE);
        }
    }

    private async loadMidi(info: MidiSongMeta, generation: number) {
        try {
            const song = await this.loader.acquire(info.id);
            if (generation !== this.generation) {
                song?.release();
                return;
            }
            if (!song) throw new Error(`曲目内容不存在: ${info.id}`);

            this.releaseSong();
            this.song = song;
            this.cursor = new EventCursor(
                song.song.events,
                song.song.index,
                song.song.header.hasVelocity
            );
            this.totalNotes = song.song.noteCount;
        } catch (e) {
            if (generation !== this.generation) return;
            console.error(`加载 MIDI 失败: ${info.name}`, e);
            this.releaseSong();
            this.totalNotes = 0;
        }

        this.currentTime = 0;
    }

    private releaseSong() {
        this.cursor = undefined;
        const song = this.song;
        this.song = undefined;
        song?.release();
    }

    private playNote(info: NoteInfo, duration: number) {
        this.output.note(info, duration);
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
        const currentNoteIndex = this.cursor?.noteIndex ?? 0;

        const durationMs = (this.song?.song.duration ?? this.queue.current()?.duration ?? 0) * 25;
        const durationSec = durationMs / 1000;

        return {
            state: this.state,
            midiName: this.queue.current()?.name ?? this.song?.song.name ?? "unknown",

            totalNotes: this.totalNotes,

            currentNoteIndex,

            // 时间制进度（与拖动条/时间显示一致）：currentTime / 时长，0~1
            progress:
                durationSec > 0
                    ? Math.min(1, Math.max(0, this.currentTime / durationSec))
                    : 0,

            currentTime: this.currentTime,

            /** 曲目总时长（ms；内部 tick 1/40 秒，1 tick = 25ms） */
            durationMs,

            queueIndex: this.queue.getIndex(),
            queueLength: this.queue.getLength(),
            lastActiveTime: this.lastActiveTime,
            listenerCount: this.signal.listenerCount(),
        };
    }
}
