import {
    processNote,
    noteNameToMidi,
    pianoSoundId,
    pianoSoundDirs,
    velocityLayerIndex,
    velocityVolume,
    DEFAULT_PIANO_TIMBRE,
    PIANO_SAMPLE_KEYS,
} from "./note.js";
import {
    NORMALIZE_MAX_GAIN_DB,
    NORMALIZE_TARGET_DB,
    computeNormalizationGainDbFromNotes,
} from "./normalize.js";

/**
 * WebAudio 采样播放引擎（前端播放器共享核心：管理端 web 与独立生成器共用）。
 *
 * - 音符→采样映射用 core 的 processNote / pianoSoundId，与游戏内一致
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
    /** 播放音量 0~1 */
    volume: number;
}

/** 采样加载器：dir=classic_grand_v2 等力度层目录，fileName 为模板内原始名（如 "D#4.ogg"） */
export type SampleSource = (
    dir: string,
    fileName: string
) => Promise<ArrayBuffer | null>;

/** 默认音色的力度层目录（与 addon 结构一致） */
export const SAMPLE_DIRS: string[] = pianoSoundDirs(DEFAULT_PIANO_TIMBRE);

/** 全部采样键名（基础键 C/D#/F#/A；文件系统命名差异由 SampleSource 处理） */
export const SAMPLE_KEYS = PIANO_SAMPLE_KEYS;

/** 默认音色全量采样清单：力度层 × 30 键 */
export const ALL_SAMPLES = SAMPLE_DIRS.flatMap((dir) =>
    SAMPLE_KEYS.map((key) => ({ dir, sample: key }))
);

/** 指定音色的全量采样清单（力度层 × 30 键） */
export function pianoSamples(timbre: number) {
    return pianoSoundDirs(timbre).flatMap((dir) =>
        PIANO_SAMPLE_KEYS.map((sample) => ({ dir, sample }))
    );
}

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
    onended: (() => void) | null;
    connect(g: unknown): void;
    start(t: number): void;
    stop(t?: number): void;
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
 * 预览播放器的基础增益。
 * 游戏内 100% 音量 = 1.0，这里保持对齐；之前是 1.6（+4.1 dB），
 * 会让网页试听明显比游戏和普通视频更响。
 */
const PLAYER_MASTER_GAIN = 1.0;

/** 逐曲响度归一化的目标值（基于音符能量的相对 dB，不是标准 LUFS）。 */
export { NORMALIZE_MAX_GAIN_DB, NORMALIZE_TARGET_DB } from "./normalize.js";

/**
 * 估算一首曲子的相对响度并返回归一化增益（dB）。
 * WebAudio 播放器的 NoteEvent 是秒制、0~1 力度，这里转换成共享模型的 0~127。
 */
export function computeNormalizationGainDb(
    events: readonly NoteEvent[],
    durationSec: number,
    targetDb = NORMALIZE_TARGET_DB,
    maxGainDb = NORMALIZE_MAX_GAIN_DB
): number {
    return computeNormalizationGainDbFromNotes(
        events.map((event) => ({
            velocity: event.velocity * 127,
            durationSeconds: event.duration,
        })),
        durationSec,
        targetDb,
        maxGainDb
    );
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
    /** 上次进度广播的音频时钟（秒），用于限制进度刷新频率 */
    private lastEmitTime = 0;
    /** seek/重播代数：使 seek 前已排定的异步音符失效 */
    private seekGen = 0;
    /** 已启动的采样源；seek/stop 时用于立即静音，避免旧音符继续播放 */
    private activeSources = new Set<SourceLike>();

    /** 采样加载器；未设置时不可播放（available = false） */
    sampleSource: SampleSource | null = null;

    private timbreValue: number = DEFAULT_PIANO_TIMBRE;

    /** 上一次设置的音量：换曲/换 AudioContext 后沿用 */
    private volumeValue = 1;

    /** 是否启用逐曲响度归一化（默认关闭，由 UI 开关控制）。 */
    private normalizeLoudnessValue = false;
    /** 当前曲目的归一化线性增益与 dB 值。 */
    private songGain = 1;
    private songGainDb = 0;

    private state: PlayerState = {
        status: "idle",
        songId: null,
        songName: "",
        currentTime: 0,
        duration: 0,
        volume: 1,
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

    /** Sample the same clock as the scheduler between state publications. */
    getPlaybackTime(): number {
        if (!this.ctx || this.state.status !== "playing" || this.timer === null) return this.state.currentTime;
        return Math.min(this.state.duration, Math.max(0, this.ctx.currentTime - this.startTime));
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
        this.seekGen++;

        const ctx = createAudioContext();
        this.ctx = ctx;
        const master = ctx.createGain();
        master.gain.value = PLAYER_MASTER_GAIN * this.volumeValue;
        // 轻量限幅：只削掉多音符叠加的峰值，不再用高压缩比把密集段落压得更响。
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 8;
        comp.ratio.value = 4;
        comp.attack.value = 0.005;
        comp.release.value = 0.25;
        comp.connect(ctx.destination);
        master.connect(comp);
        this.master = master;

        this.events = events;
        this.nextIndex = 0;
        this.startTime = ctx.currentTime;
        this.lastEmitTime = 0;
        this.state = {
            status: "playing",
            songId,
            songName,
            currentTime: 0,
            duration: durationSec,
            volume: this.volumeValue,
        };
        this.recomputeSongGain();
        this.applyMasterGain();
        this.emit();

        await ctx.resume();

        // 首次播放前全量加载采样（仅一次，之后永久缓存）
        await Promise.all(pianoSamples(this.timbreValue).map(({ dir, sample }) => this.getSample(ctx, dir, sample)));
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
        // seek 使旧调度失效，并立即停掉已经发声的采样
        this.seekGen++;
        this.stopActiveSources();
        // 定位到首个起始时间 >= t 的音符；从 t 继续调度
        this.nextIndex = this.events.findIndex((n) => n.time >= t);
        if (this.nextIndex === -1) this.nextIndex = this.events.length;
        this.startTime = this.ctx.currentTime - t;
        this.lastEmitTime = t;
        this.emit();
    }

    stop() {
        this.clearTimer();
        this.seekGen++;
        this.stopActiveSources();
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
            this.master = null;
        }
        this.events = [];
        this.nextIndex = 0;
        this.songGain = 1;
        this.songGainDb = 0;
        this.state = {
            status: "idle",
            songId: null,
            songName: "",
            currentTime: 0,
            duration: 0,
            volume: this.volumeValue,
        };
        this.emit();
    }

    /** 清空采样缓存与失败标记（换模板/换音源后调用，强制重新加载） */
    clearSampleCache() {
        this.sampleCache.clear();
        this.sampleFailed.clear();
        this.preloaded = false;
    }

    /** 当前音量 0~1 */
    get volume() {
        return this.volumeValue;
    }

    /** 当前是否启用逐曲响度归一化。 */
    get normalizeLoudness() {
        return this.normalizeLoudnessValue;
    }

    /**
     * 开关逐曲响度归一化；播放中切换会立即生效，方便 A/B。
     * 默认关闭，不做任何强制处理。
     */
    setNormalizeLoudness(enabled: boolean) {
        if (this.normalizeLoudnessValue === enabled) return;
        this.normalizeLoudnessValue = enabled;
        this.recomputeSongGain();
        this.applyMasterGain();
        this.emit();
    }

    /** 当前曲目的归一化增益（dB，仅用于展示/调试）。 */
    get normalizationGainDb() {
        return this.songGainDb;
    }

    private recomputeSongGain() {
        if (!this.normalizeLoudnessValue || this.events.length === 0) {
            this.songGainDb = 0;
            this.songGain = 1;
            return;
        }
        this.songGainDb = computeNormalizationGainDb(this.events, this.state.duration);
        this.songGain = 10 ** (this.songGainDb / 20);
    }

    private applyMasterGain() {
        if (this.master) {
            this.master.gain.value = PLAYER_MASTER_GAIN * this.volumeValue * this.songGain;
        }
    }

    /** 调整音量；立即作用于正在播放的 master gain，并对之后的播放生效。 */
    setVolume(volume: number) {
        const next = Math.max(0, Math.min(1, volume));
        this.volumeValue = next;
        this.state.volume = next;
        this.applyMasterGain();
        this.emit();
    }

    /** 当前播放音色（音色编号与 @piano/core 的 PIANO_TIMBRES 一致） */
    get timbre() {
        return this.timbreValue;
    }

    /** 切换音色；清空采样缓存，下一次播放/预热按新音色加载。播放中切换只影响后续音符。 */
    setTimbre(timbre: number) {
        if (this.timbreValue === timbre) return;
        this.timbreValue = timbre;
        this.clearSampleCache();
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
                pianoSamples(this.timbreValue).map(({ dir, sample }) => this.getSample(off, dir, sample))
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
        // 进度广播限流到 ~10Hz：50ms 的调度粒度保留，但不必每次都通知 UI 重渲染
        if (current - this.lastEmitTime >= 0.1) {
            this.lastEmitTime = current;
            this.emit();
        }
    }

    private clearTimer() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** 立即停止所有已启动的采样源（seek/换曲/停止时调用）。 */
    private stopActiveSources() {
        for (const source of this.activeSources) {
            try {
                source.stop();
            } catch {
                // 已经自然结束
            }
        }
        this.activeSources.clear();
    }

    /** 播放单个音符：core 映射选采样 + 变调（playbackRate），与 addon 一致 */
    private async playNote(ctx: CtxLike, master: GainLike, note: NoteEvent, when: number) {
        // 必须在任何 await 之前捕获：采样加载完成后才能判断期间是否发生了 seek/换曲。
        const gen = this.seekGen;
        const info = processNote(note.midi, false);
        const velocity = Math.max(1, Math.round(note.velocity * 127));
        const dir = pianoSoundId(this.timbreValue, velocityLayerIndex(velocity, this.timbreValue));
        let buffer = await this.getSample(ctx, dir, info.sample);
        let pitch = info.pitch;
        if (!buffer) {
            // 采样不齐是常态（只有基础键）：按音高距离就近变调替代，与游戏 playSound({pitch}) 一致
            const alt = await this.getFallbackSample(ctx, dir, note.midi);
            if (!alt) return; // 完全没有可用采样时才放弃（实际不可能）
            buffer = alt.buffer;
            pitch = Math.pow(2, (note.midi - alt.midi) / 12);
        }
        if (gen !== this.seekGen) return; // seek/换曲后旧音符失效
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

    /** 播放采样 buffer：变调 + 力度音量，Note Off 后约 600ms 淡出（与 addon 一致） */
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
        src.onended = () => this.activeSources.delete(src);
        this.activeSources.add(src);

        const gain = ctx.createGain();
        // 力度 → 音量倍数；参考力度 90 为 1，强奏最高约 1.67 倍。
        const peak = Math.min(1.2, 0.95 * velocityVolume(velocity * 127));
        const t = when;

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(peak, t + 0.008);

        // 采样按 pitch 变调后实际时长缩短：naturalEnd 按变调后时长计算
        const sampleDur = buffer.duration / pitch;
        const naturalEnd = t + sampleDur;
        const noteEnd = t + Math.max(0.12, duration);
        const releaseEnd = Math.min(naturalEnd, noteEnd + 0.6);
        if (releaseEnd < naturalEnd) {
            gain.gain.setValueAtTime(peak, noteEnd);
            gain.gain.linearRampToValueAtTime(0.0001, releaseEnd);
        } else {
            gain.gain.setValueAtTime(peak, naturalEnd - 0.05);
            gain.gain.linearRampToValueAtTime(0.0001, naturalEnd);
        }

        src.connect(gain);
        gain.connect(master);
        src.start(t);
        src.stop(Math.min(naturalEnd, releaseEnd) + 0.05);
    }
}
