import type { PlayerLike, PlayerState } from "../layout/PlayerBar";
import type { PlayerNote } from "../components/NoteRoll";

/**
 * 共享播放器外壳：把「MIDI 采样播放」与「原音频试听」合并成一个 PlayerLike，
 * 并向 PlayerBar 暴露当前音源与音符（钢琴卷帘）。生成器与管理页共用。
 *
 * UI 包不直接依赖 @piano/core：MIDI 播放器通过结构类型注入。
 */

export interface MidiNoteEvent {
    midi: number;
    /** 起始时间（秒） */
    time: number;
    /** 时值（秒） */
    duration: number;
    /** 力度 0~1 */
    velocity: number;
}

export interface MidiPlayerLike extends PlayerLike {
    /** 当前曲目的音符事件（播放器展开时绘制卷帘） */
    getNotes(): readonly MidiNoteEvent[];
}

const AUDIO_PREVIEW_ID = "audio-preview";

function emitState(listeners: Set<(state: PlayerState) => void>, state: PlayerState) {
    for (const listener of listeners) listener(state);
}

/** 原音频试听：用 HTMLAudioElement 流式播放，内存占用与浏览器音频缓冲一致。 */
export class AudioPreviewPlayer implements PlayerLike {
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

    /** 播放本地 Blob/File 或 URL；notes 仅用于卷帘展示。 */
    async play(
        source: Blob | string,
        name: string,
        duration = 0,
        notes: PlayerNote[] = []
    ): Promise<void> {
        this.dispose();
        this.notes = notes;

        const url =
            typeof source === "string" ? source : URL.createObjectURL(source);
        if (typeof source !== "string") this.objectUrl = url;

        const audio = new Audio(url);
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

/**
 * 统一播放器：在 MIDI 采样播放与原音频试听之间切换，
 * 并把当前音源、音符与力度信息提供给 PlayerBar。
 */
export class AppPlayer implements PlayerLike {
    protected readonly audio = new AudioPreviewPlayer();
    private active: "idle" | "midi" | "audio" = "idle";
    private listeners = new Set<(state: PlayerState) => void>();
    private midiSongId: string | null = null;
    private midiNotes: PlayerNote[] = [];
    private audioNotes: PlayerNote[] = [];

    constructor(protected readonly midi: MidiPlayerLike) {
        this.midi.subscribe((state) => {
            if (
                state.status === "playing" ||
                state.status === "paused" ||
                state.status === "ended"
            ) {
                if (this.active !== "midi") {
                    this.active = "midi";
                    this.midiSongId = null;
                    this.audio.stop();
                }
                this.notify();
            } else if (this.active === "midi") {
                this.active = "idle";
                this.notify();
            }
        });

        this.audio.subscribe((state) => {
            if (state.status !== "idle") {
                if (this.active !== "audio") {
                    this.active = "audio";
                    this.audioNotes = this.audio.getNotes();
                    this.midi.stop();
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
        const state = this.midi.getState();
        if (state.songId !== this.midiSongId) {
            this.midiSongId = state.songId;
            this.midiNotes = this.midi.getNotes().map((note) => ({
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
                ...this.audio.getState(),
                sourceLabel: "原音频试听",
                notes: this.audioNotes,
                hasVelocity: false,
            };
        }
        if (this.active === "midi") {
            return {
                ...this.midi.getState(),
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
        if (this.active === "audio") this.audio.pause();
        else this.midi.pause();
    }

    resume(): void {
        if (this.active === "audio") this.audio.resume();
        else this.midi.resume();
    }

    stop(): void {
        this.midi.stop();
        this.audio.stop();
        this.active = "idle";
        this.notify();
    }

    seek(time: number): void {
        if (this.active === "audio") this.audio.seek(time);
        else this.midi.seek(time);
    }

    setVolume(volume: number): void {
        this.midi.setVolume?.(volume);
        this.audio.setVolume(volume);
    }

    /** 原音频试听入口：切换音源并携带可选音符（卷帘展示）。 */
    async playAudio(
        source: Blob | string,
        name: string,
        duration = 0,
        notes: PlayerNote[] = []
    ): Promise<void> {
        this.active = "audio";
        this.audioNotes = notes;
        this.midi.stop();
        await this.audio.play(source, name, duration, notes);
    }

    /** 停止原音频试听（MIDI 不受影响）。 */
    stopAudio(): void {
        this.audio.stop();
    }
}
