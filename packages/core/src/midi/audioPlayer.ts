import { processNote, getSoundIdByDuration, noteNameToMidi } from "./note.js";

/**
 * WebAudio 采样播放引擎（前端播放器共享核心：管理端 web 与独立生成器共用）。
 *
 * - 音符→采样映射用 core 的 processNote / getSoundIdByDuration，与游戏内一致
 * - 采样来源可插拔（SampleSource）：web 用 URL（fetch /piano/...），
 *   生成器从模板 mcaddon 的 rp/sounds 提取；文件名差异由各端 source 自行处理
 * - 模板/静态目录只有基础采样键（A0-A7/C1-C8/D#/F# 等），缺键时按音高距离
 *   就近用基础采样变调（playbackRate）替代，与游戏 playSound({pitch}) 思路一致
 * - 注意：本模块只通过 exports map 的 "./player" 子路径导出，不进 barrel，
 *   保证 addon（游戏包）依赖图永远够不到它
 */

export interface NoteEvent {
    midi: number;
    /** 起始时间（秒） */
    time: number;
    /** 时值（秒） */
    duration: number;
    /** 力度 0~1 */
    velocity: number;
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

/** 采样加载器：dir=piano/piano_short/piano_long，fileName 为模板内原始名（如 "D#4.ogg"） */
export type SampleSource = (
    dir: string,
    fileName: string
) => Promise<ArrayBuffer | null>;

/** 采样档位 → rp/sounds 目录名（与 addon 结构一致） */
export const SAMPLE_DIRS: Record<string, string> = {
    piano: "piano",
    piano_short: "piano_short",
    piano_long: "piano_long",
};

/** 全部采样键名（基础键 C/D#/F#/A；文件系统命名差异由 SampleSource 处理） */
export const SAMPLE_KEYS = [
    "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7",
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
    "D#1", "D#2", "D#3", "D#4", "D#5", "D#6", "D#7",
    "F#1", "F#2", "F#3", "F#4", "F#5", "F#6", "F#7",
];

/** 全量采样清单：3 档 × 30 键 = 90 个 */
export const ALL_SAMPLES = Object.values(SAMPLE_DIRS).flatMap((dir) =>
    SAMPLE_KEYS.map((key) => ({ dir, sample: key }))
);

// ---- WebAudio 最小类型面（core 不引 DOM lib，避免污染全局类型） ----
interface ParamLike {
    value: number;
    setValueAtTime(v: number, t: number): void;
    linearRampToValueAtTime(v: number, t: number): void;
}
interface GainLike {
    gain: ParamLike;
    connect(d: unknown): void;
}
interface CompLike {
    threshold: { value: number };
    knee: { value: number };
    ratio: { value: number };
    attack: { value: number };
    release: { value: number };
    connect(d: unknown): void;
}
interface SourceLike {
    buffer: unknown;
    playbackRate: { value: number };
    connect(g: unknown): void;
    start(t: number): void;
    stop(t: number): void;
}
interface BufferLike {
    duration: number;
}
interface CtxLike {
    currentTime: number;
    destination: unknown;
    createGain(): GainLike;
    createDynamicsCompressor(): CompLike;
    createBufferSource(): SourceLike;
    decodeAudioData(data: ArrayBuffer): Promise<BufferLike>;
    resume(): Promise<void>;
    close(): Promise<void>;
}

function createAudioContext(): CtxLike {
    const g = globalThis as Record<string, unknown>;
    const Ctor = (g.AudioContext ?? g.webkitAudioContext) as
        | (new () => CtxLike)
        | undefined;
    if (!Ctor) throw new Error("当前环境不支持 WebAudio");
    return new Ctor();
}

/**
 * 采样播放引擎基类：调度循环 / 音符播放 / 力度包络 / 采样缓存 / 变调兜底。
 * 子类只需提供 sampleSource 与事件来源，再暴露自己的播放入口。
 */
export abstract class SampledMidiPlayer {
    protected ctx: CtxLike | null = null;
    protected master: GainLike | null = null;
    private sampleCache = new Map<string, BufferLike>();
    private sampleFailed = new Set<string>();
    private preloaded = false;
    private events: NoteEvent[] = [];
    private nextIndex = 0;
    private startTime = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private timerId = 0;
    /** seek/重播代数：使 seek 前已排定的异步音符失效 */
    private seekGen = 0;

    /** 采样加载器；未设置时不可播放（available = false） */
    sampleSource: SampleSource | null = null;

    private state: PlayerState = {
        status: "idle",
        songId: null,
        songName: "",
        currentTime: 0,
        duration: 0,
    };
    private listeners = new Set<(s: PlayerState) => void>();

    constructor() {
        // 子类构造函数里赋值 sampleSource；这里无额外初始化
    }

    /** 当前是否可播放（已绑定采样源） */
    get available(): boolean {
        return this.sampleSource !== null;
    }

    /** 当前播放中的曲目 id（非空闲时有效） */
    get playingId(): string | null {
        return this.state.status === "playing" || this.state.status === "paused"
            ? this.state.songId
            : null;
    }

    subscribe(listener: (s: PlayerState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): PlayerState {
        return { ...this.state };
    }

    protected emit() {
        const snapshot = { ...this.state };
        for (const listener of this.listeners) listener(snapshot);
    }

    /**
     * 播放事件序列。须在用户手势（点击）中调用以通过浏览器音频策略。
     * 内部会先 stop，再创建 AudioContext + 预加载全量采样（仅首次）。
     */
    async playSong(
        songId: string,
        songName: string,
        durationSec: number,
        events: NoteEvent[]
    ): Promise<void> {
        this.stop();
        if (!this.sampleSource) throw new Error("采样源未就绪，无法播放");

        const ctx = createAudioContext();
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

        this.events = events;
        this.nextIndex = 0;
        this.startTime = ctx.currentTime;
        this.state = {
            status: "playing",
            songId,
            songName,
            currentTime: 0,
            duration: durationSec,
        };
        this.emit();

        await ctx.resume();

        // 首次播放前全量加载采样（仅一次，之后永久缓存）
        await Promise.all(ALL_SAMPLES.map(({ dir, sample }) => this.getSample(ctx, dir, sample)));
        if (!this.ctx || this.state.status !== "playing") return; // 预加载期间可能已 stop

        // 预加载耗时不计入进度：从当前时刻重新起算
        this.startTime = ctx.currentTime;
        const id = ++this.timerId;
        this.timer = setInterval(() => this.schedule(id), 50);
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

    /** 清空采样缓存与失败标记（换模板/换音源后调用，强制重新加载） */
    clearSampleCache() {
        this.sampleCache.clear();
        this.sampleFailed.clear();
        this.preloaded = false;
    }

    /**
     * 后台预热采样：模板加载后尽早调用，用 OfflineAudioContext 预先解码全部采样，
     * 用户点播放时零等待（避免首次播放的前置延迟/页面遮罩闪烁）。
     * 幂等：只执行一次；无采样源或环境不支持时静默跳过。
     */
    async warmup(): Promise<void> {
        if (this.preloaded || !this.sampleSource) return;
        const g = globalThis as Record<string, unknown>;
        const OfflineCtx = g.OfflineAudioContext as
            | (new (ch: number, len: number, rate: number) => CtxLike)
            | undefined;
        if (!OfflineCtx) return;
        try {
            const off = new OfflineCtx(1, 1, 44100);
            await Promise.all(
                ALL_SAMPLES.map(({ dir, sample }) => this.getSample(off, dir, sample))
            );
            this.preloaded = true;
        } catch {
            // 预热失败不阻塞：播放时按需加载
        }
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

        while (
            this.nextIndex < this.events.length &&
            this.events[this.nextIndex].time <= current + lookahead
        ) {
            const note = this.events[this.nextIndex];
            const when = Math.max(this.startTime + note.time, ctx.currentTime);
            void this.playNote(ctx, master, note, when);
            this.nextIndex++;
        }

        this.state.currentTime = Math.min(current, this.state.duration);
        this.emit();
    }

    private clearTimer() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** 播放单个音符：core 映射选采样 + 变调（playbackRate），与 addon 一致 */
    private async playNote(ctx: CtxLike, master: GainLike, note: NoteEvent, when: number) {
        const info = processNote(note.midi, false);
        const dir = SAMPLE_DIRS[getSoundIdByDuration(note.duration)];
        let buffer = await this.getSample(ctx, dir, info.sample);
        let pitch = info.pitch;
        if (!buffer) {
            // 采样不齐是常态（只有基础键）：按音高距离就近变调替代，与游戏 playSound({pitch}) 一致
            const alt = await this.getFallbackSample(ctx, dir, note.midi);
            if (!alt) return; // 完全没有可用采样时才放弃（实际不可能）
            buffer = alt.buffer;
            pitch = Math.pow(2, (note.midi - alt.midi) / 12);
        }
        const gen = this.seekGen;
        if (gen !== this.seekGen) return; // seek 后旧音符失效
        this.playBuffer(ctx, master, buffer, pitch, note.velocity, when, note.duration);
    }

    /** 主采样缺失：按音高距离找最近可用基础采样（同八度优先，向外扩 ±2 八度） */
    private async getFallbackSample(
        ctx: CtxLike,
        dir: string,
        midi: number
    ): Promise<{ buffer: BufferLike; midi: number } | undefined> {
        const octave = Math.floor(midi / 12) - 1;
        const candidates: { name: string; midi: number; diff: number }[] = [];
        for (let oct = octave - 2; oct <= octave + 2; oct++) {
            for (const base of ["C", "D#", "F#", "A"]) {
                const name = `${base}${oct}`;
                const m = noteNameToMidi(name);
                candidates.push({ name, midi: m, diff: Math.abs(m - midi) });
            }
        }
        candidates.sort((a, b) => a.diff - b.diff);
        for (const c of candidates) {
            const buffer = await this.getSample(ctx, dir, c.name);
            if (buffer) return { buffer, midi: c.midi };
        }
        return undefined;
    }

    /** 加载（并缓存）单个采样；失败记入失败集，调用方决定是否兜底 */
    private async getSample(
        ctx: CtxLike,
        dir: string,
        sample: string
    ): Promise<BufferLike | undefined> {
        const key = `${dir}/${sample}`;
        const cached = this.sampleCache.get(key);
        if (cached) return cached;
        if (this.sampleFailed.has(key)) return undefined;

        try {
            const arrayBuf = await this.sampleSource!(dir, sample);
            if (!arrayBuf) throw new Error("采样缺失");
            const buffer = await ctx.decodeAudioData(arrayBuf);
            this.sampleCache.set(key, buffer);
            return buffer;
        } catch {
            this.sampleFailed.add(key);
            return undefined;
        }
    }

    /** 播放采样 buffer：变调 + 力度包络，短时值截断（与 addon 分档一致） */
    private playBuffer(
        ctx: CtxLike,
        master: GainLike,
        buffer: BufferLike,
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