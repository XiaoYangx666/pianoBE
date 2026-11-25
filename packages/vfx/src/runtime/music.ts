import { addTimelineTicks, type TimelineTick } from "./time";

export const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
export const mix = (from: number, to: number, weight: number) => from + (to - from) * weight;

/** A note already normalized onto the current performance timeline by the host adapter. */
export interface VfxNoteEvent {
    midi: number;
    duration: number;
    velocity: number;
    timelineTick: TimelineTick;
    source: "manual" | "midi" | "simulation";
    hasVelocity: boolean;
    /** Original song position; only song-specific choreography may use it for exact cue lookups. */
    songTime?: number;
}

export interface VfxTransportEvent {
    type: "track" | "start" | "pause" | "resume" | "stop" | "seek";
    position: number;
}

export interface MusicFeatures {
    density: number;
    velocity: number;
    dynamics: number;
    activity: number;
    pitch: number;
    low: number;
    middle: number;
    high: number;
    sustain: number;
    surge: number;
    chord: number;
    onset: number;
}

export const quietFeatures: Readonly<MusicFeatures> = {
    density: 0, velocity: 100 / 127, dynamics: 0, activity: 0, pitch: 0.5,
    low: 0, middle: 0, high: 0, sustain: 0, surge: 0, chord: 0, onset: 0,
};

export interface VfxKeyNote {
    midi: number;
    velocity: number;
    duration: number;
    timelineTick: TimelineTick;
    /** Monotonic within one music session; unlike ticks, this also orders notes arriving in the same tick. */
    sequence: number;
}

/** 每架启用钢琴对应一个音乐特征聚合器。所有窗口和持续音只使用演出时间。 */
export class VfxMusic {
    private readonly keys = new Map<number, { until: TimelineTick; duration: number; velocity: number; source: VfxNoteEvent["source"] }>();
    private readonly recentNotes: VfxKeyNote[] = [];
    private readonly window = new Map<TimelineTick, number>();
    private readonly chordKeys = new Set<number>();
    private chordStart: TimelineTick | undefined;
    private chordSize = 0;
    private hits = 0;
    private measured = 0;
    private velocitySum = 0;
    private lastTick: TimelineTick | undefined;
    private newestNoteTick: TimelineTick | undefined;
    private nextNoteSequence = 1;
    private values = { ...quietFeatures };

    note(event: VfxNoteEvent) {
        const { midi, timelineTick } = event;
        if (!Number.isInteger(midi) || midi < 21 || midi > 108) return;
        if ((this.lastTick !== undefined && timelineTick < this.lastTick)
            || (this.newestNoteTick !== undefined && timelineTick < this.newestNoteTick)) {
            throw new Error("VFX music received a backwards timeline note; reset the session on seek");
        }
        this.newestNoteTick = timelineTick;
        const velocity = event.hasVelocity ? clampUnit(event.velocity / 127) : quietFeatures.velocity;
        const duration = Math.max(0.05, Math.min(30, event.duration));
        this.keys.set(midi, {
            until: addTimelineTicks(timelineTick, Math.ceil(duration * 20)),
            duration,
            velocity,
            source: event.source,
        });
        this.recentNotes.push({
            midi,
            velocity,
            duration,
            timelineTick,
            sequence: this.nextNoteSequence++,
        });
        if (this.recentNotes.length > 48) this.recentNotes.shift();
        this.window.set(timelineTick, Math.min(64, (this.window.get(timelineTick) ?? 0) + 1));
        if (this.chordStart === undefined || timelineTick - this.chordStart >= 3) {
            this.chordStart = timelineTick;
            this.chordKeys.clear();
        }
        this.chordKeys.add(midi);
        this.chordSize = Math.max(this.chordSize, this.chordKeys.size);
        this.hits = Math.min(64, this.hits + 1);
        if (event.hasVelocity && this.measured < 64) {
            this.measured++;
            this.velocitySum += velocity;
        }
    }

    recent(timelineTick: TimelineTick, withinTicks = 24): readonly VfxKeyNote[] {
        const cutoff = timelineTick - withinTicks;
        return this.recentNotes.filter(note => note.timelineTick >= cutoff && note.timelineTick <= timelineTick);
    }

    transport(event: VfxTransportEvent) {
        if (event.type !== "resume") this.clear();
    }

    clear() {
        this.keys.clear();
        this.recentNotes.length = 0;
        this.window.clear();
        this.chordKeys.clear();
        this.chordStart = undefined;
        this.lastTick = undefined;
        this.newestNoteTick = undefined;
        // Sequence is event identity, not timeline state. Keep it monotonic even when
        // transients are cleared so an existing engine can never see a reused note id.
        this.values = { ...quietFeatures };
        this.clearAttacks();
    }

    sample(timelineTick: TimelineTick): Readonly<MusicFeatures> {
        if (this.lastTick !== undefined && timelineTick < this.lastTick) {
            throw new Error("VFX music sampled a backwards timeline; reset the session on seek");
        }
        const delta = this.lastTick === undefined ? 4 / 20 : (timelineTick - this.lastTick) / 20;
        this.lastTick = timelineTick;
        let count = 0;
        for (const [time, added] of this.window) {
            if (time <= timelineTick - 20) this.window.delete(time);
            else if (time <= timelineTick) count += added;
        }

        let weight = 0;
        let pitch = 0;
        let low = 0;
        let middle = 0;
        let high = 0;
        let sustain = 0;
        let activeVelocity = 0;
        let activeCount = 0;
        for (const [midi, key] of this.keys) {
            if (key.until <= timelineTick) { this.keys.delete(midi); continue; }
            const w = 0.35 + 0.65 * key.velocity;
            weight += w;
            pitch += w * (midi - 21) / 87;
            if (midi < 48) low += w;
            else if (midi < 72) middle += w;
            else high += w;
            sustain = Math.max(sustain, clampUnit(key.duration / 1.7));
            activeVelocity += key.velocity;
            activeCount++;
        }

        const activeMean = activeCount ? activeVelocity / activeCount : quietFeatures.velocity;
        const density = clampUnit(count / 16);
        const activity = clampUnit(weight / 4 + density * 0.45);
        const chord = this.chordSize >= 3 ? clampUnit((this.chordSize - 2) / 4) : 0;
        const target: MusicFeatures = {
            density, velocity: activeMean,
            dynamics: this.measured ? this.velocitySum / this.measured - quietFeatures.velocity : 0,
            activity, pitch: weight ? pitch / weight : 0.5,
            low: weight ? low / weight : 0, middle: weight ? middle / weight : 0, high: weight ? high / weight : 0,
            sustain, surge: clampUnit((0.72 * density + 0.28 * activity - 0.31) / 0.38),
            chord, onset: clampUnit(this.hits / 4),
        };
        this.clearAttacks();
        for (const key of Object.keys(target) as (keyof MusicFeatures)[]) {
            const old = this.values[key];
            const rising = target[key] > old;
            const tau = key === "pitch" ? 0.3 : key === "surge" ? (rising ? 0.48 : 0.85) : (rising ? 0.18 : 0.72);
            this.values[key] = mix(old, target[key], 1 - Math.exp(-delta / tau));
        }
        return { ...this.values, chord, onset: target.onset };
    }

    private clearAttacks() {
        this.hits = this.chordSize = this.measured = this.velocitySum = 0;
    }
}

/** 固定测试乐句：休止、琶音、长音、和弦与密集段。输入和输出共享同一演出 tick。 */
export function simulatedVfxNotes(timelineTick: TimelineTick, mode: "phrase" | "note" | "chord" | "dense"): VfxNoteEvent[] {
    const time = ((timelineTick % 240) + 240) % 240;
    const notes = (keys: number[], velocity: number, duration: number): VfxNoteEvent[] =>
        keys.map(midi => ({ midi, velocity, duration, timelineTick, source: "simulation", hasVelocity: true }));
    if (mode === "note") return time % 40 === 0 ? notes([48 + 7 * Math.floor(time / 40)], 78, 1.3) : [];
    if (mode === "chord") return time % 40 === 0 ? notes([43, 55, 59, 62, 67], 98, 0.8) : [];
    if (mode === "dense") return time >= 40 && time < 168 && time % 4 === 0 ? notes([48 + (time % 36), 72], 104, 0.24) : [];
    if (time < 48 || time >= 192) return [];
    if (time < 96) return time % 8 === 0 ? notes([48 + (time - 48) / 2], 68 + (time - 48), 0.45) : [];
    if (time === 96) return notes([76], 91, 1.8);
    if (time >= 132 && time % 20 === 12) return notes([43, 55, 59, 62, 70], 108, 0.65);
    return time >= 132 && time % 4 === 0 ? notes([60 + time % 24], 87, 0.35) : [];
}
