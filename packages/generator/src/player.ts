import { SampledMidiPlayer, type NoteEvent } from "@piano/core/player";
import { TIME_SCALE, pbe2ToNoteEvents } from "@piano/core";
import type { PlayerLike, PlayerNote, PlayerState } from "@piano/ui";
import type { TemplateInfo } from "./template";
import type { SongEntry } from "./types";

export type { NoteEvent } from "@piano/core/player";

/**
 * 生成器预览播放器（薄壳）：WebAudio 采样播放引擎在 core（@piano/core/player，
 * 与管理端 web 共用同一引擎），这里只负责：
 * - 采样源：从已加载模板 mcaddon 的 rp/sounds 提取（不重复存放音效文件）
 * - 事件来源：SongEntry 中的 PBE2 事件流
 * 播放行为（调度/变调/包络/兜底）与游戏一致，由 core 引擎保证。
 */

/** SongEntry → 音符事件（PBE2 事件流解码） */
export function songEntryToEvents(entry: SongEntry): NoteEvent[] {
    return entry.data ? pbe2ToNoteEvents(entry.data) : [];
}

export class PreviewPlayer extends SampledMidiPlayer {
    /** 播放中曲目变化回调（null = 已停止/结束），用于刷新 ▶/⏹ */
    onStateChange: (songId: string | null) => void = () => {};

    private lastId: string | null = null;
    private currentNotes: NoteEvent[] = [];

    constructor() {
        super();
        this.subscribe((s) => {
            const id =
                s.status === "playing" || s.status === "paused" ? s.songId : null;
            if (id !== this.lastId) {
                this.lastId = id;
                this.onStateChange(id);
            }
        });
    }

    /** 当前曲目的音符事件（播放器展开时用于绘制钢琴卷帘） */
    getNotes(): readonly NoteEvent[] {
        return this.currentNotes;
    }

    /** 绑定模板（内含 rp 音效）；更换模板时重新绑定并停止播放、清空采样缓存 */
    bindTemplate(info: TemplateInfo | null) {
        this.stop();
        this.clearSampleCache();
        this.sampleSource = null;
        if (!info) return;
        const soundsRoot = `${info.rpPath}sounds/`;
        this.sampleSource = async (dir: string, fileName: string) => {
            const file = await info.addon.read(`${soundsRoot}${dir}/${fileName}.ogg`);
            if (!file) return null;
            return file.bytes.slice().buffer;
        };
    }

    /** 预览播放（须在用户手势中调用） */
    async play(entry: SongEntry): Promise<void> {
        if (!this.sampleSource) throw new Error("底包模板未加载，无法预览");
        const events = songEntryToEvents(entry);
        this.currentNotes = events;
        await this.playSong(entry.id, entry.name, entry.duration / TIME_SCALE, events);
    }
}

/** 全局单例 */
export const previewPlayer = new PreviewPlayer();

const AUDIO_PREVIEW_ID = "audio-preview";

function emitState(listeners: Set<(state: PlayerState) => void>, state: PlayerState) {
    for (const listener of listeners) listener(state);
}

/** 原音频试听：用 HTMLAudioElement 流式播放本地文件，内存占用与浏览器音频缓冲一致。 */
class AudioPreviewPlayer implements PlayerLike {
    private audio: HTMLAudioElement | null = null;
    private objectUrl: string | null = null;
    private notes: PlayerNote[] = [];
    private volumeValue = 1;
    private state: PlayerState = {
        status: "idle",
        songId: null,
        songName: "",
        currentTime: 0,
        duration: 0,
        volume: 1,
    };
    private listeners = new Set<(state: PlayerState) => void>();

    getState(): PlayerState {
        return this.state;
    }

    subscribe(listener: (state: PlayerState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getNotes(): PlayerNote[] {
        return this.notes;
    }

    private update(patch: Partial<PlayerState>) {
        this.state = { ...this.state, ...patch };
        emitState(this.listeners, this.state);
    }

    async play(file: File, name: string, duration = 0, notes: PlayerNote[] = []): Promise<void> {
        this.dispose();
        this.notes = notes;
        this.objectUrl = URL.createObjectURL(file);
        const audio = new Audio(this.objectUrl);
        audio.preload = "metadata";
        audio.volume = this.volumeValue;
        this.audio = audio;

        const readDuration = () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                this.update({ duration: audio.duration });
            }
        };

        audio.addEventListener("loadedmetadata", readDuration);
        audio.addEventListener("durationchange", readDuration);
        audio.addEventListener("timeupdate", () => {
            this.update({ currentTime: audio.currentTime });
        });
        audio.addEventListener("play", () => {
            this.update({ status: "playing" });
        });
        audio.addEventListener("pause", () => {
            if (this.state.status === "idle") return;
            this.update({ status: audio.ended ? "ended" : "paused" });
        });
        audio.addEventListener("ended", () => {
            this.update({ status: "ended", currentTime: audio.duration || this.state.duration });
        });
        audio.addEventListener("error", () => {
            this.update({ status: "idle", songId: null, songName: "", currentTime: 0 });
        });

        this.update({
            status: "playing",
            songId: AUDIO_PREVIEW_ID,
            songName: name,
            currentTime: 0,
            duration: duration > 0 ? duration : 0,
            volume: this.volumeValue,
        });

        try {
            await audio.play();
        } catch {
            this.update({ status: "paused" });
        }
    }

    pause(): void {
        this.audio?.pause();
    }

    resume(): void {
        if (!this.audio) return;
        if (this.state.status === "ended") this.audio.currentTime = 0;
        void this.audio.play().catch(() => this.update({ status: "paused" }));
    }

    stop(): void {
        this.dispose();
        this.notes = [];
        this.update({
            status: "idle",
            songId: null,
            songName: "",
            currentTime: 0,
            duration: 0,
        });
    }

    seek(time: number): void {
        if (!this.audio) return;
        const duration = this.state.duration || this.audio.duration || 0;
        const target = Math.max(0, Math.min(duration || time, time));
        this.audio.currentTime = target;
        this.update({ currentTime: target });
    }

    setVolume(volume: number): void {
        this.volumeValue = Math.max(0, Math.min(1, volume));
        if (this.audio) this.audio.volume = this.volumeValue;
        this.update({ volume: this.volumeValue });
    }

    private dispose() {
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute("src");
            this.audio.load();
            this.audio = null;
        }
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
    }
}

const audioPreviewPlayer = new AudioPreviewPlayer();

/**
 * 生成器全局播放器：统一 MIDI 试听与原音频试听，
 * 让底部播放器在两种音源之间切换，并向外提供音符数据。
 */
class GeneratorPlayer implements PlayerLike {
    private active: "idle" | "midi" | "audio" = "idle";
    private listeners = new Set<(state: PlayerState) => void>();
    private midiSongId: string | null = null;
    private midiNotes: PlayerNote[] = [];
    private audioNotes: PlayerNote[] = [];

    constructor() {
        previewPlayer.subscribe((state) => {
            if (
                state.status === "playing" ||
                state.status === "paused" ||
                state.status === "ended"
            ) {
                if (this.active !== "midi") {
                    this.active = "midi";
                    this.midiSongId = null;
                    audioPreviewPlayer.stop();
                }
                this.notify();
            } else if (this.active === "midi") {
                this.active = "idle";
                this.notify();
            }
        });

        audioPreviewPlayer.subscribe((state) => {
            if (state.status !== "idle") {
                if (this.active !== "audio") {
                    this.active = "audio";
                    this.audioNotes = audioPreviewPlayer.getNotes();
                    previewPlayer.stop();
                }
                this.notify();
            } else if (this.active === "audio") {
                this.active = "idle";
                this.notify();
            }
        });
    }

    private notify() {
        emitState(this.listeners, this.getState());
    }

    private currentMidiNotes(): PlayerNote[] {
        const state = previewPlayer.getState();
        if (state.songId !== this.midiSongId) {
            this.midiSongId = state.songId;
            this.midiNotes = previewPlayer.getNotes().map((note) => ({
                pitch: note.midi,
                start: note.time,
                end: note.time + note.duration,
                velocity: note.velocity,
            }));
        }
        return this.midiNotes;
    }

    getState(): PlayerState {
        if (this.active === "audio") {
            return {
                ...audioPreviewPlayer.getState(),
                sourceLabel: "原音频试听",
                notes: this.audioNotes,
                hasVelocity: false,
            };
        }
        if (this.active === "midi") {
            return {
                ...previewPlayer.getState(),
                sourceLabel: "MIDI 试听",
                notes: this.currentMidiNotes(),
                hasVelocity: true,
            };
        }
        return {
            status: "idle",
            songId: null,
            songName: "",
            currentTime: 0,
            duration: 0,
            volume: 1,
            sourceLabel: "MIDI 试听",
            notes: [],
            hasVelocity: false,
        };
    }

    subscribe(listener: (state: PlayerState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    pause(): void {
        if (this.active === "audio") audioPreviewPlayer.pause();
        else previewPlayer.pause();
    }

    resume(): void {
        if (this.active === "audio") audioPreviewPlayer.resume();
        else previewPlayer.resume();
    }

    stop(): void {
        previewPlayer.stop();
        audioPreviewPlayer.stop();
        this.active = "idle";
        this.notify();
    }

    seek(time: number): void {
        if (this.active === "audio") audioPreviewPlayer.seek(time);
        else previewPlayer.seek(time);
    }

    setVolume(volume: number): void {
        previewPlayer.setVolume(volume);
        audioPreviewPlayer.setVolume(volume);
    }

    /** MIDI 试听入口：切换音源并记录音符 */
    async playMidi(entry: SongEntry): Promise<void> {
        this.active = "midi";
        this.audioNotes = [];
        audioPreviewPlayer.stop();
        await previewPlayer.play(entry);
    }

    /** 原音频试听入口：切换音源并携带当前转录音符 */
    async playAudio(
        file: File,
        name: string,
        duration = 0,
        notes: PlayerNote[] = []
    ): Promise<void> {
        this.active = "audio";
        this.audioNotes = notes;
        previewPlayer.stop();
        await audioPreviewPlayer.play(file, name, duration, notes);
    }
}

/** 全局单例：AppLayout / PlayerBar 使用它，页面仍可直接操作 previewPlayer 播放 MIDI */
export const appPlayer = new GeneratorPlayer();
