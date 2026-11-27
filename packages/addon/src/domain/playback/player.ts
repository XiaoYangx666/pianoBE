import { processNote } from "@domain/util/note";
import { Signal } from "@domain/util/signal";
import { createSongCursor, readLoadedSongNotes, SCHEDULE_LEAD_TICKS, TIME_SCALE, computeNormalizationGainDbFromNotes, isDefaultPerformanceSelection, reportDiagnostic, type MusicSelection, type SongHandle, type PerformanceCue } from "@piano/core";
import { NoteInfo } from "@domain/types";
import { PlayQueue, type QueueAddResult } from "./queue";
import type { PlaybackRecord } from "@domain/playback/playbackRecord";
import type { PianoTransportEvent } from "./visualEvent";

type PlayerState = "idle" | "playing" | "paused" | "stopped";

interface MidiOutput {
    note(
        note: NoteInfo,
        soundDuration: number,
        velocity: number,
        gain: number,
        songTime: number,
        hasVelocity: boolean,
        keyDuration: number
    ): void;
    playing(value: boolean): void;
    transport?(event: PianoTransportEvent): void;
    /** 立即停止所有正在发声/释放的实例（seek、暂停、销毁）；正常播放结束不调用。 */
    stopNotes(): void;
}

/** 播放器只需要“按引用获取共享曲目”，缓存策略由存储层/SongCache 统一负责。 */
export interface MidiLoader {
    acquire(ref: MusicSelection): Promise<SongHandle | undefined>;
    resolvePerformanceCues?(ref: MusicSelection, performanceId: string): Promise<readonly PerformanceCue[] | undefined>;
}

export class MidiPlayer {
    /** 当前曲目引用（持有期间 SongCache 不会淘汰事件流） */
    private song?: SongHandle;
    private performanceCues?: readonly PerformanceCue[];
    private cursor?: ReturnType<typeof createSongCursor>;
    private totalNotes = 0;
    private currentTime = 0;

    private lastTime = Date.now();

    private state: PlayerState = "idle";

    private isLoading = false;
    private generation = 0;
    /** 本轮 loadMidi 因曲目内容缺失（本地/远程都取不到）而失败。 */
    private loadMissing = false;

    /** 逐曲响度归一化（默认关闭，由钢琴设置控制）。 */
    private normalizeLoudnessValue = false;
    private normalizationGain = 1;
    private normalizationDb = 0;

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
        return { ...this.queue.snapshot(), state: this.state, seconds: this.currentTime };
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
        if (this.loadMissing) {
            this.queue.dropCurrent(song);
            this.state = "idle";
            return;
        }
        this.state = "paused";
        this.currentTime = record.seconds;
        if (!this.hasContent()) return;
        this.seek(record.seconds);
        if (record.state === "playing") this.resume();
    }

    /* ================== 控制接口 ================== */

    async play() {
        if (!this.isAlive()) return;
        this.output.stopNotes();
        const generation = ++this.generation;
        const info = this.queue.current();
        if (!info) {
            this.state = "idle";
            this.isLoading = false;
            this.output.playing(false);
            this.output.transport?.({ type: "stop", position: 0 });
            return;
        }

        this.output.transport?.({ type: "track", position: 0 });
        this.isLoading = true;
        await this.loadMidi(info, generation);
        if (generation !== this.generation) return;
        this.isLoading = false;

        if (this.loadMissing) {
            // 失效条目已被 `play()` 选中：摘除后从它的后继继续。
            await this.prepareNext(this.queue.dropCurrent(info), true);
            return;
        }

        if (!this.hasContent()) {
            this.prepareNext();
            return;
        }

        this.state = "playing";
        this.output.playing(true);
        this.output.transport?.({ type: "start", position: 0 });
        this.lastTime = Date.now();
    }

    pause() {
        if (this.state !== "playing") return;
        this.state = "paused";
        this.output.stopNotes();
        this.output.playing(false);
        this.output.transport?.({ type: "pause", position: this.currentTime });
    }

    resume() {
        if (this.state !== "paused") return;

        if (!this.hasContent()) {
            this.prepareNext();
            return;
        }

        this.state = "playing";
        this.output.playing(true);
        this.output.transport?.({ type: "resume", position: this.currentTime });
        this.lastTime = Date.now();
    }

    async restart() {
        if (this.queue.current()) await this.play();
    }

    /** 加入队列（去重）。 */
    addToQueue(ref: MusicSelection): QueueAddResult {
        return this.queue.enqueueUnique(ref);
    }

    /** 按顺序加入、跳过重复项，队满时停止。 */
    addCollectionToQueue(refs: readonly MusicSelection[]): { added: number; exists: number; full: boolean } {
        let added = 0;
        let exists = 0;
        for (const ref of refs) {
            const result = this.addToQueue(ref);
            if (result === "full") return { added, exists, full: true };
            if (result === "added") added++;
            else exists++;
        }
        return { added, exists, full: false };
    }

    /**
     * 立即播放指定曲目：
     * - 已在队列中 → 跳转到已有条目；
     * - 不在队列中 → 插入当前曲目之后；
     * 不清理原队列，也不产生重复条目。
     */
    async playNow(ref: MusicSelection) {
        const existing = this.queue.indexOf(ref);
        if (existing >= 0) this.queue.jump(existing);
        else if (!this.queue.insertBack(ref)) throw new Error("播放队列已满");
        await this.play();
    }

    /** 整卡播放：卡片歌曲在当前曲目后组成连续块，后续队列不会被跳过。 */
    async playCollection(refs: readonly MusicSelection[]): Promise<{ added: number; exists: number } | undefined> {
        if (!refs.length) return undefined;
        const result = this.queue.insertCollectionAfterCurrent(refs);
        if (!result) throw new Error("播放队列无法容纳整张存储卡");
        await this.play();
        return result;
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
        // 先收掉跳转前的所有实例，避免旧音符继续发声到原定释放时间。
        this.output.stopNotes();
        this.cursor.seek(target * TIME_SCALE);
        if (this.state === "idle" || this.state === "stopped") {
            this.state = "playing";
            this.output.playing(true);
            this.lastTime = Date.now();
        }
        this.output.transport?.({ type: "seek", position: target });

        this.signal.publish();
    }

    end() {
        this.queue.clear();
        this.stopPlayback("stopped");
        this.signal.dispose();
        this.disposedSignal.publish();
        this.disposedSignal.dispose();
    }

    clearQueue() {
        if (!this.isAlive()) return;
        this.queue.clear();
        this.stopPlayback("idle");
    }

    removeFromQueue(ref: MusicSelection): boolean {
        if (!this.isAlive()) return false;
        const index = this.queue.indexOf(ref);
        if (index < 0) return false;
        const removingCurrent = index === this.queue.getIndex();
        this.queue.remove(index);
        if (removingCurrent) this.stopPlayback("idle");
        return true;
    }

    private stopPlayback(state: "idle" | "stopped") {
        this.generation++;
        const position = this.currentTime;
        const wasActive = this.state !== "idle" || this.isLoading;
        this.state = state;
        this.releaseSong();
        this.totalNotes = 0;
        this.currentTime = 0;
        this.isLoading = false;
        if (wasActive || state === "stopped") this.output.stopNotes();
        this.output.playing(false);
        this.output.transport?.({ type: "stop", position });
        this.signal.publish();
    }

    /** 开关逐曲响度归一化；播放中切换从后续音符开始生效。 */
    setNormalizeLoudness(enabled: boolean) {
        if (this.normalizeLoudnessValue === enabled) return;
        this.normalizeLoudnessValue = enabled;
        this.updateNormalizationGain();
    }

    /** 当前曲目的归一化增益（dB，仅用于展示/调试）。 */
    get normalizationGainDb() {
        return this.normalizationDb;
    }

    private updateNormalizationGain() {
        if (!this.normalizeLoudnessValue || !this.song) {
            this.normalizationDb = 0;
            this.normalizationGain = 1;
            return;
        }
        const { header } = this.song.song;
        const notes = readLoadedSongNotes(this.song.song);
        this.normalizationDb = computeNormalizationGainDbFromNotes(
            notes.map((note) => ({
                velocity: note.velocity,
                durationSeconds: note.soundDuration / TIME_SCALE,
            })),
            header.duration / TIME_SCALE
        );
        this.normalizationGain = 10 ** (this.normalizationDb / 20);
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

    /**
     * 切到下一首。
     * @param first 指定首轮候选（由 dropCurrent 给出），此时不再调用 `queue.next()`，
     *              避免指针二次前进跳过后继曲目。
     * @param useFirst 为 true 表示完全采用 `first`（即使为 undefined 也不再自行取歌）。
     */
    private async prepareNext(first?: MusicSelection, useFirst = false) {
        if (this.isLoading) return;

        this.isLoading = true;
        const generation = ++this.generation;

        // 释放当前曲目引用，再从队列取下一首
        this.releaseSong();
        this.totalNotes = 0;

        const limit = this.queue.getLength();
        let nextInfo = useFirst ? first : this.queue.next();
        for (let attempt = 0; attempt < limit && nextInfo; attempt++) {
            this.output.transport?.({ type: "track", position: 0 });
            await this.loadMidi(nextInfo, generation);
            if (generation !== this.generation) return;

            if (this.loadMissing) {
                // 曲目已从曲库删除（或曲库快照过期）：摘掉队列里的失效条目，
                // 避免每次轮播都重试同一首并刷“曲目内容不存在”。
                nextInfo = this.queue.dropCurrent(nextInfo);
                continue;
            }

            if (this.hasContent()) {
                this.state = "playing";
                this.output.playing(true);
                this.output.transport?.({ type: "start", position: 0 });
                this.lastTime = Date.now();
                this.isLoading = false;
                return;
            }
            nextInfo = this.queue.next();
        }
        this.state = "idle";
        this.output.playing(false);
        this.output.transport?.({ type: "stop", position: this.currentTime });
        this.isLoading = false;
    }

    private processPlayback() {
        const cursor = this.cursor;
        if (!cursor) return;
        // 20 TPS 下只能落在 50ms 网格；提前半个 tick 取“最近 tick”，
        // 让量化误差围绕 0 而不是全部拖后（见 tools/audio-lab-report.md）。
        const horizon = this.currentTime * TIME_SCALE + SCHEDULE_LEAD_TICKS;

        while (true) {
            const time = cursor.peekTime();
            if (time > horizon || time === Infinity) break;
            const note = cursor.next();
            if (!note) break;
            this.output.note(
                processNote(note.midi, false),
                note.soundDuration / TIME_SCALE,
                note.velocity,
                this.normalizationGain,
                time / TIME_SCALE,
                true,
                note.keyDuration / TIME_SCALE
            );
        }
    }

    private async loadMidi(info: MusicSelection, generation: number) {
        this.loadMissing = false;
        try {
            const song = await this.loader.acquire(info);
            if (generation !== this.generation) {
                song?.release();
                return;
            }
            if (!song) {
                this.loadMissing = true;
                throw new Error(`曲目内容不存在: ${info.name} (${info.id})`);
            }

            this.releaseSong();
            this.song = song;
            const cues = await this.resolvePerformance(info, song);
            if (generation !== this.generation) return;
            this.performanceCues = cues;
            this.cursor = createSongCursor(song.song);
            this.totalNotes = song.song.noteCount;
            this.updateNormalizationGain();
        } catch (e) {
            if (generation !== this.generation) return;
            // 曲目被删除属于数据过期，不是播放器故障：降级为 WARN，并附上被摘除的信息。
            if (this.loadMissing) {
                reportDiagnostic("warn", "playback", "曲目已失效，已从队列移除", undefined, {
                    song: info.id,
                    name: info.name,
                });
            } else {
                reportDiagnostic("error", "playback", "加载 MIDI 失败", e, {
                    song: info.id,
                    name: info.name,
                });
            }
            this.releaseSong();
            this.totalNotes = 0;
        }

        this.currentTime = 0;
    }

    private async resolvePerformance(
        info: MusicSelection,
        song: SongHandle,
    ): Promise<readonly PerformanceCue[] | undefined> {
        const { performanceId } = info;
        if (performanceId === "plain") return;
        if (isDefaultPerformanceSelection(info.id, performanceId)) {
            return song.song.header.performance;
        }

        const fields = { song: info.id, name: info.name, performance: performanceId };
        try {
            const cues = await this.loader.resolvePerformanceCues?.(info, performanceId);
            if (cues) return cues;
            reportDiagnostic("warn", "playback", "演出不可用，继续普通演奏", undefined, fields);
        } catch (error) {
            reportDiagnostic("warn", "playback", "读取演出失败，继续普通演奏", error, fields);
        }
    }

    private releaseSong() {
        this.cursor = undefined;
        const song = this.song;
        this.song = undefined;
        this.performanceCues = undefined;
        song?.release();
        this.updateNormalizationGain();
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

    get performance() {
        const song = this.song?.song;
        const cues = this.performanceCues;
        if (!song || !cues) return;
        return { cues, duration: song.duration / TIME_SCALE };
    }

    get loadedSong() {
        return this.song?.song;
    }

    get position() {
        return this.currentTime;
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
