import { midiManager } from "@midiPlayer";
import { Dimension, Vector3 } from "@minecraft/server";
import { getSoundIdByDuration, processNote } from "@utils/note";
import { summonParticle } from "@utils/particle";
import { Signal } from "@utils/signal";
import { Cardinal_Direction, MidiInfo, MidiJson, NoteInfo } from "../types";
import { PlayQueue } from "./queue";

type PlayerState = "idle" | "playing" | "paused" | "stopped";

export class MidiPlayer {
    pos: Vector3;
    dir: Cardinal_Direction;
    dimension: Dimension;

    private tracks: Float32Array[] = [];
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

        while (true) {
            let minTime = Infinity;
            let minTrack = -1;

            // 找最早的 note
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

            if (minTrack === -1) break; // 全播完

            if (minTime > this.currentTime) break;

            const arr = tracks[minTrack];
            const i = indices[minTrack];

            const midi = arr[i];
            const duration = arr[i + 2];

            const info = processNote(midi, false);

            this.playNote(info, duration);

            indices[minTrack] += 4;
        }
    }

    private async loadMidi(info: MidiInfo) {
        try {
            const midi = await midiManager.load(info);

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

    private extractTracks(midi: MidiJson): Float32Array[] {
        const result: Float32Array[] = [];

        for (const track of midi.tracks) {
            if (track.notes && track.notes.length > 0) {
                result.push(track.notes);
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

        return {
            pos: this.pos,
            dimension: this.dimension,
            state: this.state,
            midiName: this.queue.current()?.name ?? "unknown",

            totalNotes: this.totalNotes,

            currentNoteIndex,

            progress:
                this.totalNotes === 0 ? 0 : currentNoteIndex / this.totalNotes,

            currentTime: this.currentTime,

            queueIndex: this.queue.getIndex(),
            queueLength: this.queue.getLength(),
            lastActiveTime: this.lastActiveTime,
            listenerCount: this.signal.listenerCount(),
        };
    }
}
