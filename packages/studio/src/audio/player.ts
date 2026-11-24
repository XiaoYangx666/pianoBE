import {
    AppPlayer,
    type MidiNoteEvent,
    type MidiPlayerLike,
    type PlayerState,
} from "@piano/ui";
import {
    PIANO_SAMPLE_KEYS,
    TIME_SCALE,
    encodeSong,
    readAllSongNotes,
    readSongHeader,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import type { TemplateInfo } from "@piano/assembly";

const SAMPLE_DURATION = 4.0;
const RELEASE_FADE = 0.08;
const MAX_SAMPLE_GAIN = 0.25;
const SCHEDULE_AHEAD = 0.35;
const SCHEDULE_INTERVAL_MS = 100;

interface InternalNote extends MidiNoteEvent {
    endTime: number;
}

class StudioMidiPlayer implements MidiPlayerLike {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private sampleBuffers = new Map<string, AudioBuffer>();
    private loadingSamples: Promise<void> | null = null;
    private activeSources = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
    private template: TemplateInfo | null = null;

    private notes: InternalNote[] = [];
    private nextIdx = 0;
    private duration = 0;
    private songId: string | null = null;
    private songName = "";
    private playStartCtx = 0;
    private songOffset = 0;
    private timer: number | null = null;
    private volumeValue = 1;
    private status: PlayerState["status"] = "idle";
    private listeners = new Set<(state: PlayerState) => void>();

    setTemplate(template: TemplateInfo | null): void {
        this.template = template;
    }

    getState(): PlayerState {
        return {
            status: this.status,
            songId: this.songId,
            songName: this.songName,
            currentTime: this.currentTime(),
            duration: this.duration,
            volume: this.volumeValue,
        };
    }

    getNotes(): readonly MidiNoteEvent[] {
        return this.notes;
    }

    subscribe(listener: (state: PlayerState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        const snapshot = this.getState();
        for (const l of this.listeners) l(snapshot);
    }

    private currentTime(): number {
        if (this.status === "playing" && this.ctx) {
            return Math.min(this.duration, this.songOffset + (this.ctx.currentTime - this.playStartCtx));
        }
        return this.songOffset;
    }

    private ensureAudioContext(): AudioContext {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.volumeValue;
            this.masterGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") void this.ctx.resume();
        return this.ctx;
    }

    private async ensureSamplesLoaded(): Promise<void> {
        if (this.sampleBuffers.size > 0) return;
        if (this.loadingSamples) return this.loadingSamples;

        this.loadingSamples = (async () => {
            const ctx = this.ensureAudioContext();
            const packs = [
                { id: "piano_v1", dir: "piano_v1" },
                { id: "piano_v2", dir: "piano_v2" },
                { id: "piano_v3", dir: "piano_v3" },
            ];
            await Promise.all(
                packs.flatMap((pack) =>
                    PIANO_SAMPLE_KEYS.map(async (key) => {
                        let raw: ArrayBuffer | null = null;
                        if (this.template) {
                            const entry = await this.template.addon.read(
                                `${this.template.rpPath}sounds/${pack.dir}/${key}.ogg`,
                            );
                            if (entry) raw = entry.bytes.slice().buffer;
                        }
                        if (!raw) {
                            const webFile = key.replace(/#/g, "sharp");
                            const res = await fetch(`./piano/${pack.dir}/${webFile}.ogg`);
                            if (res.ok) raw = await res.arrayBuffer();
                        }
                        if (!raw) return;
                        try {
                            const decoded = await ctx.decodeAudioData(raw);
                            this.sampleBuffers.set(`${pack.id}:${key}`, decoded);
                        } catch {
                            // 忽略单个损坏样本
                        }
                    }),
                ),
            );
        })().finally(() => {
            this.loadingSamples = null;
        });

        return this.loadingSamples;
    }

    private clearVoices(): void {
        for (const item of this.activeSources) {
            try {
                item.source.stop();
            } catch {
                // ignore
            }
        }
        this.activeSources.clear();
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            window.clearInterval(this.timer);
            this.timer = null;
        }
    }

    private scheduleTick(): void {
        if (!this.ctx || !this.masterGain || this.status !== "playing") return;
        const elapsed = this.ctx.currentTime - this.playStartCtx;
        const pos = this.songOffset + elapsed;
        const horizon = pos + SCHEDULE_AHEAD;

        while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].time <= horizon) {
            const note = this.notes[this.nextIdx++];
            if (note.time + note.duration < pos) continue;
            const startAt = Math.max(this.ctx.currentTime, this.playStartCtx + (note.time - this.songOffset));
            const { layer, key, rate } = this.pickSample(note.midi, note.velocity);
            const buf = this.sampleBuffers.get(`piano_v${layer + 1}:${key}`) ?? this.sampleBuffers.get(`piano_v2:${key}`);
            if (!buf) continue;

            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.playbackRate.value = rate;

            const gain = this.ctx.createGain();
            const level = Math.max(0.05, note.velocity) * MAX_SAMPLE_GAIN;
            const hold = Math.min(SAMPLE_DURATION, Math.max(0.06, note.duration));
            gain.gain.setValueAtTime(level, startAt);
            gain.gain.setValueAtTime(level, startAt + hold);
            gain.gain.linearRampToValueAtTime(0.0001, startAt + hold + RELEASE_FADE);

            src.connect(gain);
            gain.connect(this.masterGain);

            const entry = { source: src, gain };
            this.activeSources.add(entry);
            src.onended = () => this.activeSources.delete(entry);
            src.start(startAt);
            src.stop(startAt + hold + RELEASE_FADE + 0.02);
        }

        if (pos >= this.duration) {
            this.clearTimer();
            this.songOffset = this.duration;
            this.status = "ended";
        }
        this.emit();
    }

    private pickSample(midi: number, velocity: number): { layer: number; key: string; rate: number } {
        const layer = velocity < 0.38 ? 0 : velocity < 0.72 ? 1 : 2;
        const closest = findClosestKey(midi);
        return {
            layer,
            key: closest.key,
            rate: Math.pow(2, (midi - closest.midi) / 12),
        };
    }

    async playBytes(id: string, name: string, bytes: Uint8Array, kind: "pbe3" | "mid" = "pbe3"): Promise<void> {
        const pbe3 = kind === "mid" ? encodeSong(midiBufferToSong(bytes, name)) : bytes;
        const header = readSongHeader(pbe3);
        const rawNotes = readAllSongNotes(pbe3);
        const notes: InternalNote[] = rawNotes
            .filter((e) => e.midi >= 21 && e.midi <= 108)
            .map((e) => {
                const time = e.time / TIME_SCALE;
                const dur = Math.max(0.06, e.soundDuration / TIME_SCALE);
                return {
                    midi: e.midi,
                    time,
                    duration: dur,
                    velocity: Math.max(0.05, Math.min(1, e.velocity / 127)),
                    endTime: time + dur,
                };
            });

        this.clearTimer();
        this.clearVoices();
        this.songId = id;
        this.songName = name;
        this.notes = notes;
        this.duration = Math.max(header.duration / TIME_SCALE, notes[notes.length - 1]?.endTime ?? 0);
        this.songOffset = 0;
        this.nextIdx = 0;
        this.status = "playing";
        this.emit();

        await this.ensureSamplesLoaded();
        const ctx = this.ensureAudioContext();
        this.playStartCtx = ctx.currentTime;
        this.timer = window.setInterval(() => this.scheduleTick(), SCHEDULE_INTERVAL_MS);
        this.scheduleTick();
    }

    pause(): void {
        if (this.status !== "playing") return;
        this.songOffset = this.currentTime();
        this.clearTimer();
        this.clearVoices();
        this.status = "paused";
        this.emit();
    }

    resume(): void {
        if (this.status !== "paused" && this.status !== "ended") return;
        if (this.status === "ended") {
            this.songOffset = 0;
            this.nextIdx = 0;
        }
        const ctx = this.ensureAudioContext();
        this.playStartCtx = ctx.currentTime;
        this.status = "playing";
        this.timer = window.setInterval(() => this.scheduleTick(), SCHEDULE_INTERVAL_MS);
        this.scheduleTick();
    }

    stop(): void {
        this.clearTimer();
        this.clearVoices();
        this.songId = null;
        this.songName = "";
        this.notes = [];
        this.duration = 0;
        this.songOffset = 0;
        this.nextIdx = 0;
        this.status = "idle";
        this.emit();
    }

    seek(time: number): void {
        const clamped = Math.max(0, Math.min(this.duration, time));
        this.clearVoices();
        this.songOffset = clamped;
        this.nextIdx = this.notes.findIndex((n) => n.time >= clamped);
        if (this.nextIdx === -1) this.nextIdx = this.notes.length;
        if (this.ctx && this.status === "playing") {
            this.playStartCtx = this.ctx.currentTime;
            this.scheduleTick();
        } else {
            this.emit();
        }
    }

    setVolume(volume: number): void {
        this.volumeValue = Math.max(0, Math.min(1, volume));
        if (this.masterGain) this.masterGain.gain.value = this.volumeValue;
        this.emit();
    }
}

const KEY_TO_MIDI: Array<{ key: string; midi: number }> = (() => {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const out: Array<{ key: string; midi: number }> = [];
    for (const key of PIANO_SAMPLE_KEYS) {
        const m = /^([A-G]#?)(-?\d+)$/.exec(key);
        if (!m) continue;
        const idx = names.indexOf(m[1]);
        const octave = Number(m[2]);
        if (idx >= 0) out.push({ key, midi: (octave + 1) * 12 + idx });
    }
    return out;
})();

function findClosestKey(midi: number): { key: string; midi: number } {
    let best = KEY_TO_MIDI[0] ?? { key: "C4", midi: 60 };
    let bestDist = Infinity;
    for (const entry of KEY_TO_MIDI) {
        const d = Math.abs(entry.midi - midi);
        if (d < bestDist) {
            bestDist = d;
            best = entry;
        }
    }
    return best;
}

class StudioAppPlayer extends AppPlayer {
    constructor(private readonly studioMidi: StudioMidiPlayer) {
        super(studioMidi);
    }

    setTemplate(template: TemplateInfo | null): void {
        this.studioMidi.setTemplate(template);
    }

    async toggleSong(id: string, name: string, loadBytes: () => Promise<Uint8Array>, kind: "pbe3" | "mid" = "pbe3"): Promise<void> {
        const st = this.studioMidi.getState();
        if (st.songId === id && st.status === "playing") {
            this.pause();
            return;
        }
        if (st.songId === id && st.status === "paused") {
            this.resume();
            return;
        }
        const bytes = await loadBytes();
        await this.studioMidi.playBytes(id, name, bytes, kind);
    }

    async playBytes(id: string, name: string, bytes: Uint8Array, kind: "pbe3" | "mid" = "pbe3"): Promise<void> {
        await this.studioMidi.playBytes(id, name, bytes, kind);
    }
}

const studioMidi = new StudioMidiPlayer();
export const studioPlayer = new StudioAppPlayer(studioMidi);
