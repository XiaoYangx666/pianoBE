import { midiManager } from "@midiPlayer";
import { Dimension, Vector3 } from "@minecraft/server";
import { getSoundIdByDuration, processNote } from "@utils/note";
import { summonParticle } from "@utils/particle";
import { Signal } from "@utils/signal";
import { packNotes } from "@piano/core";
import type { MidiSong, MidiSongMeta } from "@piano/core";
import { Cardinal_Direction, NoteInfo } from "../types";
import { PlayQueue } from "./queue";

type PlayerState = "idle" | "playing" | "paused" | "stopped";

export class MidiPlayer {
    pos: Vector3;
    dir: Cardinal_Direction;
    dimension: Dimension;

    private tracks: Uint16Array[] = [];
    private indices: number[] = [];
    private totalNotes = 0;
    private currentTime = 0;

    private lastTime = Date.now();

    private state: PlayerState = "idle";

    private isLoading = false;

    readonly queue = new PlayQueue();
    readonly signal: Signal<void>;

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
        return this.tracks.length > 0;
    }

    /* ================== 控制接口 ================== */

    async play() {
        const info = this.queue.current();
        if (!info) {
            this.state = "idle";
            return;
        }

        await this.loadMidi(info);

        if (!this.hasContent()) {
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

    async restart() {
        const info = this.queue.current();
        if (!info) return;

        await this.loadMidi(info);
        this.state = "playing";
        this.lastTime = Date.now();
    }

    /**
     * 快进/回退：跳转到指定秒数（0 ≤ t ≤ 曲目时长），从该位置继续。
     * 不改变播放/暂停状态；idle/stopped 时恢复为播放。
     * 打包音符时间单位 = 1/40 秒（processPlayback 中 currentTime*40 对照）。
     */
    seek(positionSec: number) {
        if (!this.hasContent()) return;

        const meta = this.queue.current();
        // duration 为内部 tick 单位（TIME_SCALE=40，40 tick = 1 秒）
        const durationSec = (meta?.duration ?? 0) / 40;
        const target = Math.max(0, Math.min(positionSec, durationSec || positionSec));

        this.currentTime = target;
        const targetTicks = target * 40;

        // 各轨道跳到第一条 time ≥ 目标刻的音符（略过的音符不再播放）
        for (let t = 0; t < this.tracks.length; t++) {
            const arr = this.tracks[t];
            let idx = 0;
            while (idx + 1 < arr.length && arr[idx + 1] < targetTicks) idx += 4;
            this.indices[t] = idx;
        }

        if (this.state === "idle" || this.state === "stopped") {
            this.state = "playing";
            this.lastTime = Date.now();
        }

        this.signal.publish();
    }

    end() {
        this.state = "stopped";
        this.tracks = [];
        this.indices = [];
        this.currentTime = 0;
        this.isLoading = false;
        this.signal.dispose();
    }

    /* ================== 调度 ================== */

    tick(now: number) {
        if (this.state === "stopped") {
            return;
        }

        const block = this.dimension.getBlock(this.pos);

        if (!block || this.state == "idle") {
            this.lastTime = now;
            return;
        }

        if (block.typeId !== "xypiano:piano_left") {
            this.end();
            return;
        }

        if (this.state === "paused") {
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
        if (this.isAllTracksFinished()) {
            this.prepareNext();
        }
    }

    /* ================== 内部逻辑 ================== */

    private isAllTracksFinished(): boolean {
        for (let i = 0; i < this.tracks.length; i++) {
            if (this.indices[i] < this.tracks[i].length) {
                return false;
            }
        }
        return true;
    }

    private async prepareNext() {
        if (this.isLoading) return;

        this.isLoading = true;

        // ✅ 清空当前数据
        this.tracks = [];
        this.indices = [];
        this.totalNotes = 0;

        while (true) {
            const nextInfo = this.queue.next();

            if (!nextInfo) {
                this.state = "idle";
                this.isLoading = false;
                return;
            }

            await this.loadMidi(nextInfo);

            if (this.hasContent()) {
                this.state = "playing";
                this.lastTime = Date.now();
                this.isLoading = false;
                return;
            }
        }
    }

    private processPlayback() {
        const tracks = this.tracks;
        const indices = this.indices;
        const currentTime = this.currentTime * 40;

        while (true) {
            let minTime = Infinity;
            let minTrack = -1;

            for (let t = 0; t < tracks.length; t++) {
                const idx = indices[t];
                const arr = tracks[t];

                if (idx >= arr.length) continue;

                const time = arr[idx + 1];

                if (time < minTime) {
                    minTime = time;
                    minTrack = t;
                }
            }

            if (minTrack === -1) break;

            if (minTime > currentTime) break;

            const arr = tracks[minTrack];
            const i = indices[minTrack];

            const midi = arr[i];

            // duration 只在用的时候除
            const duration = arr[i + 2] / 100;

            const info = processNote(midi, false);

            this.playNote(info, duration);

            indices[minTrack] += 4;
        }
    }

    private async loadMidi(info: MidiSongMeta) {
        try {
            const midi = await midiManager.load(info);
            if (!midi) throw new Error(`曲目内容不存在: ${info.id}`);

            this.tracks = this.extractTracks(midi);

            // 初始化每个轨道 idx
            this.indices = new Array(this.tracks.length).fill(0);

            // 总 note 数（用于 UI）
            this.totalNotes = this.tracks.reduce(
                (sum, t) => sum + t.length / 4,
                0
            );
        } catch (e) {
            console.error(`加载 MIDI 失败: ${info.name}`, e);
            this.tracks = [];
            this.indices = [];
            this.totalNotes = 0;
        }

        this.currentTime = 0;
    }

    private extractTracks(midi: MidiSong): Uint16Array[] {
        const result: Uint16Array[] = [];

        for (const track of midi.tracks) {
            if (track.notes && track.notes.length > 0) {
                result.push(packNotes(track.notes));
            }
        }

        return result;
    }

    private playNote(info: NoteInfo, duration: number) {
        if (info.sample === "none") return;

        const id = getSoundIdByDuration(duration);

        this.dimension.playSound(`${id}.${info.sample}`, this.pos, {
            pitch: info.pitch,
            volume: 2,
        });

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
        const currentNoteIndex =
            this.indices.reduce((sum, i) => sum + i, 0) / 4;

        const durationMs = (this.queue.current()?.duration ?? 0) * 25; // 1 tick = 25ms（40 tick/s）
        const durationSec = durationMs / 1000;

        return {
            pos: this.pos,
            dimension: this.dimension,
            state: this.state,
            midiName: this.queue.current()?.name ?? "unknown",

            totalNotes: this.totalNotes,

            currentNoteIndex,

            // 时间制进度（与拖动条/时间显示一致）：currentTime / 时长，0~1
            progress:
                durationSec > 0
                    ? Math.min(1, Math.max(0, this.currentTime / durationSec))
                    : 0,

            currentTime: this.currentTime,

            /** 曲目总时长（ms；meta.duration 为内部 tick，1 tick = 25ms） */
            durationMs,

            queueIndex: this.queue.getIndex(),
            queueLength: this.queue.getLength(),
            lastActiveTime: this.lastActiveTime,
            listenerCount: this.signal.listenerCount(),
        };
    }
}
