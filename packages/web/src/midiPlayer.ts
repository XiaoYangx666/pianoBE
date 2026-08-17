import pkg from "@tonejs/midi";
import { processNote, getSoundIdByDuration } from "@piano/core/note";

const { Midi } = pkg;

/** 采样音频基路径（vite public → server 静态托管） */
const SAMPLE_BASE = "/piano";

/** 采样档位 → 目录名（与 addon rp/sounds 结构一致） */
const SAMPLE_DIRS: Record<string, string> = {
    piano: "piano",
    piano_short: "piano_short",
    piano_long: "piano_long",
};

/** 全部采样键名（addon rp/sounds 实际文件；F#/D# 在文件系统中为 Fsharp/Dsharp） */
const SAMPLE_KEYS = [
    "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7",
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
    "Dsharp1", "Dsharp2", "Dsharp3", "Dsharp4", "Dsharp5", "Dsharp6", "Dsharp7",
    "Fsharp1", "Fsharp2", "Fsharp3", "Fsharp4", "Fsharp5", "Fsharp6", "Fsharp7",
];

/** 全量采样清单：3 档 × 30 键 = 90 个 */
const ALL_SAMPLES = Object.values(SAMPLE_DIRS).flatMap((dir) =>
    SAMPLE_KEYS.map((key) => ({ dir, sample: key }))
);

export interface NoteEvent {
    midi: number;
    /** 起始时间（秒） */
    time: number;
    /** 时值（秒） */
    duration: number;
    /** 力度 0~1 */
    velocity: number;
}

/**
 * 直接解析 .mid 原始字节 → 音符事件（按起始时间排序）。
 * 与 server 的 midiBufferToSong 使用同一解析库（@tonejs/midi），
 * 前端无需经过 JSON 转换即可播放。
 */
export function parseMidi(buffer: ArrayBuffer): NoteEvent[] {
    const midi = new Midi(buffer);
    const events: NoteEvent[] = [];
    for (const track of midi.tracks) {
        for (const n of track.notes) {
            const velocity = Math.max(0, Math.min(1, n.velocity));
            if (velocity === 0) continue;
            events.push({
                midi: n.midi,
                time: n.time,
                duration: n.duration,
                velocity,
            });
        }
    }
    events.sort((a, b) => a.time - b.time);
    return events;
}

export interface PlayerState {
    status: "idle" | "playing" | "paused" | "ended";
    songId: string | null;
    songName: string;
    /** 当前播放位置（秒） */
    currentTime: number;
    /** 总时长（秒） */
    duration: number;
}

/**
 * 前端 MIDI 播放器：复用 addon 同一套真实钢琴采样音色。
 * - 采样映射用 core 的 processNote（MIDI→采样名+变调比）与
 *   getSoundIdByDuration（时长→piano/piano_short/piano_long），
 *   与游戏内播放完全一致
 * - 支持播放 / 暂停 / 继续 / 停止 / 跳转，多订阅状态回调
 */
export class MidiPlayer {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private sampleCache = new Map<string, AudioBuffer>();
    private sampleFailed = new Set<string>();
    private preloaded = false;
    private events: NoteEvent[] = [];
    private nextIndex = 0;
    private startTime = 0;
    private timer: number | null = null;
    private timerId = 0;
    /** seek/重播代数：用于使 seek 前已排定的异步音符失效 */
    private seekGen = 0;

    private state: PlayerState = {
        status: "idle",
        songId: null,
        songName: "",
        currentTime: 0,
        duration: 0,
    };

    private listener: Set<(s: PlayerState) => void> = new Set();

    /** 订阅状态变化，返回取消订阅函数。支持多个订阅者。 */
    subscribe(listener: (s: PlayerState) => void): () => void {
        this.listener.add(listener);
        return () => this.listener.delete(listener);
    }

    getState(): PlayerState {
        return { ...this.state };
    }

    private emit() {
        const snapshot = { ...this.state };
        for (const listener of this.listener) listener(snapshot);
    }

    /** 播放 .mid 字节。须在用户手势（点击）中调用以通过浏览器音频策略。 */
    async play(
        songId: string,
        buffer: ArrayBuffer,
        name: string,
        durationSec: number
    ): Promise<void> {
        this.stop();

        const ctx = new AudioContext();
        this.ctx = ctx;
        const master = ctx.createGain();
        master.gain.value = 1.6;
        // 压缩器：多音符叠加时限幅，防止削波失真，同时整体响度更足
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 24;
        comp.ratio.value = 12;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
        comp.connect(ctx.destination);
        master.connect(comp);
        this.master = master;

        this.events = parseMidi(buffer);
        this.nextIndex = 0;
        this.startTime = ctx.currentTime;
        this.state = {
            status: "playing",
            songId,
            songName: name,
            currentTime: 0,
            duration: durationSec,
        };
        this.emit();

        await ctx.resume();

        // 首次播放前全量加载 90 个采样（仅一次，之后永久缓存）
        await this.ensurePreloaded(ctx);

        // 预加载期间可能已 stop
        if (!this.ctx || this.state.status !== "playing") return;

        // 预加载耗时不计入进度：从当前时刻重新起算
        this.startTime = ctx.currentTime;

        const id = ++this.timerId;
        this.timer = window.setInterval(() => this.schedule(id), 50);
        this.schedule(id);
    }

    pause() {
        if (this.state.status !== "playing") return;
        this.state.status = "paused";
        this.emit();
    }

    resume() {
        if (this.state.status !== "paused" || !this.ctx || !this.master) return;
        // 从暂停位置继续：重置起始基线，重新调度剩余音符
        const elapsed = this.state.currentTime;
        this.startTime = this.ctx.currentTime - elapsed;
        this.state.status = "playing";
        this.emit();
    }

    /** 跳转到指定秒数（仅 playing/paused 时有效） */
    seek(time: number) {
        if (!this.ctx || !this.master) return;
        if (this.state.status !== "playing" && this.state.status !== "paused") return;

        const t = Math.max(0, Math.min(time, this.state.duration));
        this.state.currentTime = t;

        // seek 使旧调度失效，防止 seek 前已排定的音符与新的叠加
        this.seekGen++;

        // 定位到首个起始时间 >= t 的音符；从 t 继续调度
        this.nextIndex = this.events.findIndex((n) => n.time >= t);
        if (this.nextIndex === -1) this.nextIndex = this.events.length;
        this.startTime = this.ctx.currentTime - t;
        this.emit();
    }

    stop() {
        this.clearTimer();
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
            this.master = null;
        }
        this.events = [];
        this.nextIndex = 0;
        this.state = {
            status: "idle",
            songId: null,
            songName: "",
            currentTime: 0,
            duration: 0,
        };
        this.emit();
    }

    /** 提前调度当前时刻及之后的音符（每次只调度一小段） */
    private schedule(id: number) {
        if (id !== this.timerId) return;
        const ctx = this.ctx;
        const master = this.master;
        if (!ctx || !master || this.state.status !== "playing") return;

        const current = ctx.currentTime - this.startTime;
        const lookahead = 0.3; // 秒，提前调度窗口

        // 已到结尾：留 0.2s 余韵后结束
        if (current >= this.state.duration + 0.2) {
            this.clearTimer();
            this.state.status = "ended";
            this.state.currentTime = this.state.duration;
            this.emit();
            return;
        }

        // 调试日志已移除；保留采样缺失警告便于定位
        while (
            this.nextIndex < this.events.length &&
            this.events[this.nextIndex].time <= current + lookahead
        ) {
            const note = this.events[this.nextIndex];
            const when = Math.max(this.startTime + note.time, ctx.currentTime);
            this.playNote(ctx, master, note, when);
            this.nextIndex++;
        }

        this.state.currentTime = Math.min(current, this.state.duration);
        this.emit();
    }

    private clearTimer() {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** 播放单个音符：core 映射选采样 + 变调（playbackRate），与 addon 一致 */
    private playNote(ctx: AudioContext, master: GainNode, note: NoteEvent, when: number) {
        const info = processNote(note.midi, false);
        const dir = SAMPLE_DIRS[getSoundIdByDuration(note.duration)];
        const gen = this.seekGen;
        this.getSample(ctx, dir, info.sample)
            .then((buffer) => {
                // seek 后旧的异步音符已失效，跳过播放
                if (gen !== this.seekGen) return;
                if (!buffer) {
                    console.warn(`[midiPlayer] 采样缺失 midi=${note.midi} ${dir}/${info.sample}（静默跳过）`);
                    return;
                }
                this.playBuffer(
                    ctx,
                    master,
                    buffer,
                    info.pitch,
                    note.velocity,
                    when,
                    note.duration
                );
            })
            .catch(() => {
                // 采样加载失败静默跳过（不影响整体播放）
            });
    }

    /** 全量预加载 90 个采样（仅首次调用真正加载，之后复用缓存） */
    private async ensurePreloaded(ctx: AudioContext): Promise<void> {
        if (this.preloaded) return;
        await Promise.all(
            ALL_SAMPLES.map(({ dir, sample }) =>
                this.getSample(ctx, dir, sample).catch(() => {})
            )
        );
        this.preloaded = true;
    }

    /** 加载（并缓存）单个采样 OGG */
    private async getSample(
        ctx: AudioContext,
        dir: string,
        sample: string
    ): Promise<AudioBuffer | undefined> {
        const key = `${dir}/${sample}`;
        const cached = this.sampleCache.get(key);
        if (cached) return cached;
        if (this.sampleFailed.has(key)) return undefined;

        // 采样文件名含 #（如 F#3/D#3）：文件系统已改为 Fsharp3/Dsharp3 存储，
        // 避免 URL 中 # 被当作 fragment 截断；此处做同名映射
        const fileName = sample.replace(/#/g, "sharp");
        const url = `${SAMPLE_BASE}/${dir}/${fileName}.ogg`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`sample ${url} ${res.status}`);
            const arrayBuf = await res.arrayBuffer();
            const buffer = await ctx.decodeAudioData(arrayBuf);
            this.sampleCache.set(key, buffer);
            return buffer;
        } catch (e) {
            // 记入失败集合：预加载后不再重复请求，避免调度时异步晚到丢音
            this.sampleFailed.add(key);
            console.warn(`[midiPlayer] 采样加载失败: ${url}`, e);
            return undefined;
        }
    }

    /** 播放采样 buffer：变调 + 力度包络，短时值截断（与 addon 分档一致） */
    private playBuffer(
        ctx: AudioContext,
        master: GainNode,
        buffer: AudioBuffer,
        pitch: number,
        velocity: number,
        when: number,
        duration: number
    ) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = pitch;

        const gain = ctx.createGain();
        // sqrt 力度曲线：低力度也保有可闻响度；峰值上限提高
        const peak = 0.95 * Math.sqrt(Math.max(0, Math.min(1, velocity)));
        const t = when;

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(peak, t + 0.008);

        // 采样按 pitch 变调后实际时长缩短：naturalEnd 按变调后时长计算
        const sampleDur = buffer.duration / pitch;
        const naturalEnd = t + sampleDur;
        const noteEnd = t + Math.max(0.12, duration);
        if (noteEnd < naturalEnd) {
            gain.gain.setValueAtTime(peak, noteEnd);
            gain.gain.linearRampToValueAtTime(0.0001, noteEnd + 0.08);
        } else {
            gain.gain.setValueAtTime(peak, naturalEnd - 0.05);
            gain.gain.linearRampToValueAtTime(0.0001, naturalEnd);
        }

        src.connect(gain);
        gain.connect(master);

        src.start(t);
        src.stop(naturalEnd + 0.05);
    }
}

/** 全局单例 */
export const midiPlayer = new MidiPlayer();
