import {
    getSoundLayerByDuration,
    pianoSoundId,
    processNote,
} from "@piano/core/note";
import {
    noteEnd,
    scheduleNotes,
    type LabNote,
    type ScheduledNote,
} from "@piano/core/audioLab";
import {
    fluidr3SampleUrl,
    loadVcslManifest,
    vcslSampleUrl,
    type LabConfig,
    type VcslManifest,
} from "./labAssets";

export interface LabPlayState {
    status: "idle" | "loading" | "playing" | "paused" | "ended";
    currentTime: number;
    duration: number;
    /** 当前正在发声的声部数（按释放结束估算） */
    voices: number;
    /** 实时 RMS / 峰值（dBFS） */
    rmsDb: number;
    peakDb: number;
    label: string;
}

export interface LabPlayOptions {
    label?: string;
    onState?: (state: LabPlayState) => void;
    onEnded?: () => void;
    /** 从片段第几秒开始（默认 0，已经相对于片段） */
    offset?: number;
    /** 试听用的输出增益（dB），用于 A/B 响度匹配 */
    gainDb?: number;
}

interface DecodedSample {
    buffer: AudioBuffer;
    url: string;
}

const LOOKAHEAD = 0.6;
const TIMER_MS = 40;
const MASTER_TRIM = 0.72;

function db(value: number): number {
    return 20 * Math.log10(Math.max(value, 1e-6));
}

/**
 * Audio Lab 的实时 WebAudio 引擎。
 *
 * 与正式 SampledMidiPlayer 的区别：
 * - 支持真实多力度层、Note Off 释放、多种量化策略；
 * - 这些差异只存在实验页，正式播放器不受影响；
 * - 采样映射仍复用 core 的 processNote / pianoSoundId。
 */
export class LabAudioEngine {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private analyser: AnalyserNode | null = null;
    private meterData: Float32Array<ArrayBuffer> | null = null;

    private buffers = new Map<string, DecodedSample>();
    private pending = new Map<string, Promise<DecodedSample | undefined>>();
    private raw = new Map<string, ArrayBuffer>();
    private manifest: VcslManifest | null = null;

    private events: ScheduledNote[] = [];
    private config: LabConfig | null = null;
    private nextIndex = 0;
    private startTime = 0;
    private duration = 0;
    private timer: number | null = null;
    private generation = 0;
    private active: { end: number }[] = [];
    private sources: AudioBufferSourceNode[] = [];
    private state: LabPlayState = {
        status: "idle",
        currentTime: 0,
        duration: 0,
        voices: 0,
        rmsDb: -60,
        peakDb: -60,
        label: "",
    };
    private listeners = new Set<(state: LabPlayState) => void>();

    subscribe(listener: (state: LabPlayState) => void): () => void {
        this.listeners.add(listener);
        listener({ ...this.state });
        return () => this.listeners.delete(listener);
    }

    getState(): LabPlayState {
        return { ...this.state };
    }

    private emit(patch: Partial<LabPlayState> = {}) {
        this.state = { ...this.state, ...patch };
        const snapshot = { ...this.state };
        for (const listener of this.listeners) listener(snapshot);
    }

    private async ensureContext(): Promise<AudioContext> {
        if (this.ctx) return this.ctx;
        const ctx = new AudioContext({ latencyHint: "interactive" });
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 20;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.22;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        compressor.connect(analyser);
        analyser.connect(ctx.destination);
        this.ctx = ctx;
        this.compressor = compressor;
        this.analyser = analyser;
        this.meterData = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
        return ctx;
    }

    /** 每次播放使用新的 master，停止时只断开这一路，保留已解码采样供 A/B 复用。 */
    private newMaster(ctx: AudioContext, gainDb = 0): GainNode {
        const master = ctx.createGain();
        master.gain.value = MASTER_TRIM * 10 ** (gainDb / 20);
        master.connect(this.compressor!);
        this.master = master;
        return master;
    }

    private teardownSession() {
        this.clearTimer();
        for (const source of this.sources) {
            try {
                source.stop();
            } catch {
                // 已结束的 source 再次 stop 会抛错，忽略
            }
        }
        this.sources = [];
        if (this.master && this.ctx) {
            const master = this.master;
            try {
                master.gain.cancelScheduledValues(this.ctx.currentTime);
                master.gain.setValueAtTime(master.gain.value, this.ctx.currentTime);
                master.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.02);
            } catch {
                // 忽略
            }
            setTimeout(() => master.disconnect(), 80);
            this.master = null;
        }
        this.active = [];
    }

    /** 预先解码一段音符需要的采样，返回进度（0~1）。 */
    async preload(notes: readonly LabNote[], config: LabConfig, onProgress?: (ratio: number) => void): Promise<void> {
        const ctx = await this.ensureContext();
        const requests = await this.resolveRequests(notes, config);
        const urls = [...new Set(requests.map((request) => request.url))];
        let done = 0;
        let failed = 0;
        await mapLimit(urls, 6, async (url) => {
            const result = await this.getSample(ctx, url);
            if (!result) failed++;
            done++;
            onProgress?.(urls.length ? done / urls.length : 1);
        });
        if (failed > 0) {
            console.warn(`[Audio Lab] ${failed}/${urls.length} 个采样加载失败`);
        }
    }

    private async resolveRequests(notes: readonly LabNote[], config: LabConfig) {
        if (config.sampleSet === "vcsl" && !this.manifest) {
            this.manifest = await loadVcslManifest();
        }
        return scheduleNotes(notes, {
            mode: config.scheduleMode,
            tickSeconds: config.tickSeconds,
            velocityMode: config.velocityMode,
            velocityExponent: config.velocityExponent,
        }).map((note) => this.resolveNote(note, config));
    }

    /** 单音符 → 采样 URL / 变调 / 增益。 */
    private resolveNote(note: ScheduledNote, config: LabConfig) {
        const info = processNote(note.midi, false);
        if (config.sampleSet === "vcsl") {
            const manifest = this.manifest!;
            const key = manifest.keys[info.sample];
            const layerIndex = config.velocityMode === "single" ? 1 : note.layer;
            const layerId = ["vl2", "vl3", "vl4"][Math.max(0, Math.min(2, layerIndex))];
            const layer = key?.layers[layerId];
            const levelOffset = layer?.levelOffset ?? 0;
            const baseGain = key?.baseGain ?? 0;
            const gainDb =
                baseGain +
                (1 - config.layerDynamics) * levelOffset +
                note.velocityGainDb;
            return {
                note,
                url: vcslSampleUrl(layerIndex, info.sample, manifest.generatedAt),
                pitch: info.pitch,
                gainDb,
                layerIndex,
            };
        }
        const dir = pianoSoundId(0, getSoundLayerByDuration(note.duration));
        return {
            note,
            url: fluidr3SampleUrl(dir, info.sample),
            pitch: info.pitch,
            gainDb: note.velocityGainDb,
            layerIndex: 0,
        };
    }

    async play(notes: readonly LabNote[], config: LabConfig, options: LabPlayOptions = {}): Promise<void> {
        this.stop();
        const ctx = await this.ensureContext();
        await ctx.resume().catch(() => {});
        const generation = ++this.generation;
        this.config = config;
        this.duration = Math.max(0, ...notes.map((note) => note.time + note.duration));

        const requests = await this.resolveRequests(notes, config);
        if (generation !== this.generation) return;

        const urls = [...new Set(requests.map((request) => request.url))];
        this.emit({
            status: "loading",
            currentTime: 0,
            duration: this.duration,
            label: options.label ?? "",
            voices: 0,
        });
        let done = 0;
        await mapLimit(urls, 6, async (url) => {
            await this.getSample(ctx, url);
            done++;
            if (urls.length > 0 && (done % 6 === 0 || done === urls.length)) {
                this.emit({ status: "loading", currentTime: 0, duration: this.duration });
            }
        });
        if (generation !== this.generation) return;

        const master = this.newMaster(ctx, options.gainDb ?? 0);
        this.events = requests.map((request) => request.note);
        const offset = Math.max(0, options.offset ?? 0);
        this.nextIndex = this.events.findIndex((note) => note.start >= offset);
        if (this.nextIndex === -1) this.nextIndex = this.events.length;
        this.startTime = ctx.currentTime + 0.06 - offset;
        this.active = [];
        this.emit({
            status: "playing",
            currentTime: offset,
            duration: this.duration,
            label: options.label ?? "",
            voices: 0,
        });
        const id = ++this.timerIdValue;
        this.timer = window.setInterval(() => this.tick(id, options, master), TIMER_MS);
        this.tick(id, options, master);
    }

    private timerIdValue = 0;

    private tick(id: number, options: LabPlayOptions, master?: GainNode) {
        if (id !== this.timerIdValue) return;
        const ctx = this.ctx;
        const destination = master ?? this.master;
        if (!ctx || !destination || !this.config || this.state.status !== "playing") return;

        const current = ctx.currentTime - this.startTime;
        if (current >= this.duration + 0.4) {
            this.clearTimer();
            this.active = [];
            this.emit({ status: "ended", currentTime: this.duration, voices: 0 });
            options.onEnded?.();
            return;
        }

        while (this.nextIndex < this.events.length) {
            const note = this.events[this.nextIndex];
            if (note.start > current + LOOKAHEAD) break;
            const when = Math.max(this.startTime + note.start, ctx.currentTime + 0.005);
            void this.scheduleNote(ctx, destination, note, when, this.config);
            const end = noteEnd(note, {
                releaseMode: this.config.releaseMode,
                releaseSeconds: this.config.releaseSeconds,
                sampleSeconds: 4,
            });
            this.active.push({ end: this.startTime + end });
            this.nextIndex++;
        }

        const now = ctx.currentTime;
        this.active = this.active.filter((voice) => voice.end > now);
        const meter = this.readMeter();
        this.emit({
            currentTime: Math.min(Math.max(0, current), this.duration),
            voices: this.active.length,
            rmsDb: meter.rmsDb,
            peakDb: meter.peakDb,
        });
    }

    private readMeter(): { rmsDb: number; peakDb: number } {
        const analyser = this.analyser;
        const data = this.meterData;
        if (!analyser || !data) return { rmsDb: -60, peakDb: -60 };
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            sum += value * value;
            peak = Math.max(peak, Math.abs(value));
        }
        return {
            rmsDb: db(Math.sqrt(sum / data.length)),
            peakDb: db(peak),
        };
    }

    private async scheduleNote(
        ctx: BaseAudioContext,
        destination: AudioNode,
        note: ScheduledNote,
        when: number,
        config: LabConfig
    ): Promise<void> {
        const request = this.resolveNote(note, config);
        const sample = await this.getSample(ctx, request.url);
        if (!sample || this.config !== config) return;
        this.playBuffer(ctx, destination, sample.buffer, request.pitch, request.gainDb, when, note, config);
    }

    /** 播放一个采样（实时与离线渲染共用）。 */
    private playBuffer(
        ctx: BaseAudioContext,
        destination: AudioNode,
        buffer: AudioBuffer,
        pitch: number,
        gainDb: number,
        when: number,
        note: ScheduledNote,
        config: LabConfig
    ) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitch;

        const gain = ctx.createGain();
        const peak = Math.min(1.6, 10 ** (gainDb / 20));
        const t = Math.max(when, ctx.currentTime + 0.002);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(peak, t + 0.006);

        const naturalEnd = t + buffer.duration / pitch;
        if (config.releaseMode === "tier") {
            // 正式音色采样自身已经按 0.5s / 2s / 4s 做过淡出，这里不再覆盖。
            source.connect(gain);
            gain.connect(destination);
            source.start(t);
            source.stop(naturalEnd + 0.02);
            this.sources.push(source);
            return;
        }

        if (config.releaseMode === "natural") {
            source.connect(gain);
            gain.connect(destination);
            source.start(t);
            source.stop(naturalEnd + 0.02);
            this.sources.push(source);
            return;
        }

        const release =
            config.releaseMode === "noteoff-long"
                ? Math.max(0.35, config.releaseSeconds)
                : Math.max(0.01, config.releaseSeconds);
        const noteEndTime = t + Math.max(0.03, note.duration);
        const stopAt = Math.min(naturalEnd, noteEndTime + release);
        if (noteEndTime < naturalEnd) {
            gain.gain.setValueAtTime(peak, noteEndTime);
            gain.gain.linearRampToValueAtTime(0.0001, stopAt);
        } else {
            gain.gain.setValueAtTime(peak, Math.max(t + 0.006, naturalEnd - 0.04));
            gain.gain.linearRampToValueAtTime(0.0001, naturalEnd);
        }
        source.connect(gain);
        gain.connect(destination);
        source.start(t);
        source.stop(stopAt + 0.02);
        this.sources.push(source);
    }

    private async getSample(ctx: BaseAudioContext, url: string): Promise<DecodedSample | undefined> {
        const cached = this.buffers.get(url);
        if (cached) return cached;
        const pending = this.pending.get(url);
        if (pending) return pending;

        const promise = (async () => {
            try {
                let raw = this.raw.get(url);
                if (!raw) {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`${response.status}`);
                    raw = await response.arrayBuffer();
                    this.raw.set(url, raw);
                }
                const buffer = await ctx.decodeAudioData(raw.slice(0));
                const decoded = { buffer, url };
                this.buffers.set(url, decoded);
                return decoded;
            } catch (error) {
                console.warn(`[Audio Lab] 采样加载失败 ${url}`, error);
                return undefined;
            } finally {
                this.pending.delete(url);
            }
        })();
        this.pending.set(url, promise);
        return promise;
    }

    pause() {
        if (this.state.status !== "playing") return;
        void this.ctx?.suspend();
        this.clearTimer();
        this.emit({ status: "paused" });
    }

    resume() {
        if (this.state.status !== "paused" || !this.ctx) return;
        void this.ctx.resume();
        this.emit({ status: "playing" });
        const id = ++this.timerIdValue;
        this.timer = window.setInterval(() => this.tick(id, {}), TIMER_MS);
    }

    stop() {
        this.generation++;
        this.timerIdValue++;
        this.teardownSession();
        this.events = [];
        this.active = [];
        this.emit({ status: "idle", currentTime: 0, voices: 0, rmsDb: -60, peakDb: -60 });
    }

    /** 释放全部资源（离开实验页时调用）。 */
    dispose() {
        this.stop();
        this.buffers.clear();
        this.pending.clear();
        this.raw.clear();
        if (this.ctx) {
            void this.ctx.close().catch(() => {});
            this.ctx = null;
            this.compressor = null;
            this.analyser = null;
            this.meterData = null;
        }
    }

    private clearTimer() {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** 离线渲染一段：与实时播放共用采样、增益与包络规则。 */
    async renderOffline(
        notes: readonly LabNote[],
        config: LabConfig,
        duration: number,
        offset = 0,
        gainDb = 0
    ): Promise<AudioBuffer> {
        const sampleRate = 44100;
        const length = Math.max(1, Math.ceil((duration + 0.6) * sampleRate));
        const ctx = new OfflineAudioContext(2, length, sampleRate);
        const master = ctx.createGain();
        master.gain.value = MASTER_TRIM * 10 ** (gainDb / 20);
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 20;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.22;
        master.connect(compressor);
        compressor.connect(ctx.destination);

        if (config.sampleSet === "vcsl" && !this.manifest) {
            this.manifest = await loadVcslManifest();
        }
        const scheduled = scheduleNotes(notes, {
            mode: config.scheduleMode,
            tickSeconds: config.tickSeconds,
            velocityMode: config.velocityMode,
            velocityExponent: config.velocityExponent,
        });
        const requests = scheduled.map((note) => this.resolveNote(note, config));
        const urls = [...new Set(requests.map((request) => request.url))];
        await mapLimit(urls, 6, async (url) => {
            if (!this.buffers.has(url)) {
                const sample = await this.getSample(ctx, url);
                if (!sample) console.warn(`[Audio Lab] 离线渲染缺少采样 ${url}`);
            }
        });

        for (const request of requests) {
            const sample = this.buffers.get(request.url) ?? (await this.getSample(ctx, request.url));
            if (!sample) continue;
            const when = request.note.start - offset;
            if (when < -request.note.duration) continue;
            this.playBuffer(
                ctx,
                master,
                sample.buffer,
                request.pitch,
                request.gainDb,
                Math.max(0, when),
                request.note,
                config
            );
        }
        return ctx.startRendering();
    }
}

async function mapLimit<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (true) {
                const index = next++;
                if (index >= items.length) return;
                await worker(items[index], index);
            }
        })
    );
}

/** AudioBuffer → 16-bit PCM WAV。 */
export function encodeWav(buffer: AudioBuffer): Blob {
    const channels = Math.min(2, buffer.numberOfChannels);
    const frames = buffer.length;
    const bytes = 44 + frames * channels * 2;
    const view = new DataView(new ArrayBuffer(bytes));
    const write = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, bytes - 8, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, frames * channels * 2, true);
    const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let offset = 44;
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const value = Math.max(-1, Math.min(1, data[channel][frame]));
            view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
            offset += 2;
        }
    }
    return new Blob([view.buffer], { type: "audio/wav" });
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
