export const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
export const mix = (from: number, to: number, weight: number) => from + (to - from) * weight;

/** Minimal note contract shared by Bedrock notes and the Web preview. */
export interface VfxNoteEvent {
    midi: number;
    duration: number;
    velocity: number;
    tick: number;
    source: "manual" | "midi" | "simulation";
    hasVelocity: boolean;
    /** Song-internal seconds, used for cue-aware particle lookups in the preview. */
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
    tick: number;
}

/** 每架启用钢琴对应一个音乐特征聚合器。状态受 MIDI 键域与游戏刻窗口限制。 */
export class VfxMusic {
    private readonly keys = new Map<number, { until: number; duration: number; velocity: number; source: VfxNoteEvent["source"] }>();
    private readonly recentNotes: VfxKeyNote[] = [];
    private readonly window = new Map<number, number>();
    private readonly chordKeys = new Set<number>();
    private chordStart = -Infinity;
    private chordSize = 0;
    private hits = 0;
    private measured = 0;
    private velocitySum = 0;
    private lastTick: number | undefined;
    private values = { ...quietFeatures };

    note(event: VfxNoteEvent) {
        const { midi, tick } = event;
        if (!Number.isInteger(midi) || midi < 21 || midi > 108) return;
        const velocity = event.hasVelocity ? clampUnit(event.velocity / 127) : quietFeatures.velocity;
        const duration = Math.max(0.05, Math.min(30, event.duration));
        this.keys.set(midi, { until: tick + Math.ceil(duration * 20), duration, velocity, source: event.source });
        this.recentNotes.push({ midi, velocity, duration, tick });
        if (this.recentNotes.length > 48) this.recentNotes.shift();
        this.window.set(tick, Math.min(64, (this.window.get(tick) ?? 0) + 1));
        if (tick - this.chordStart >= 3) {
            this.chordStart = tick;
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

    recent(withinTicks = 24): readonly VfxKeyNote[] {
        const latest = this.recentNotes.at(-1)?.tick;
        if (latest === undefined) return [];
        const cutoff = latest - withinTicks;
        return this.recentNotes.filter((note) => note.tick >= cutoff);
    }

    transport(event: VfxTransportEvent) {
        if (event.type === "resume") return;
        for (const [midi, key] of this.keys) if (key.source === "midi") this.keys.delete(midi);
        this.recentNotes.length = 0;
        this.clearAttacks();
        this.window.clear();
        this.chordKeys.clear();
        this.chordStart = -Infinity;
        if (event.type === "seek" || event.type === "track") this.values = { ...quietFeatures };
    }

    clear() {
        this.keys.clear();
        this.transport({ type: "seek", position: 0 });
    }

    sample(tick: number): Readonly<MusicFeatures> {
        const delta = Math.max(1, tick - (this.lastTick ?? tick - 4)) / 20;
        this.lastTick = tick;
        let count = 0;
        for (const [time, added] of this.window) {
            if (time <= tick - 20) this.window.delete(time);
            else count += added;
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
            if (key.until <= tick) { this.keys.delete(midi); continue; }
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

/** 固定测试乐句：休止、琶音、长音、和弦与密集段。 */
export function simulatedVfxNotes(tick: number, elapsed: number, mode: "phrase" | "note" | "chord" | "dense"): VfxNoteEvent[] {
    const time = elapsed % 240;
    const notes = (keys: number[], velocity: number, duration: number): VfxNoteEvent[] =>
        keys.map(midi => ({ midi, velocity, duration, tick, source: "simulation", hasVelocity: true }));
    if (mode === "note") return time % 40 === 0 ? notes([48 + 7 * Math.floor(time / 40)], 78, 1.3) : [];
    if (mode === "chord") return time % 40 === 0 ? notes([43, 55, 59, 62, 67], 98, 0.8) : [];
    if (mode === "dense") return time >= 40 && time < 168 && time % 4 === 0 ? notes([48 + (time % 36), 72], 104, 0.24) : [];
    if (time < 48 || time >= 192) return [];
    if (time < 96) return time % 8 === 0 ? notes([48 + (time - 48) / 2], 68 + (time - 48), 0.45) : [];
    if (time === 96) return notes([76], 91, 1.8);
    if (time >= 132 && time % 20 === 12) return notes([43, 55, 59, 62, 70], 108, 0.65);
    return time >= 132 && time % 4 === 0 ? notes([60 + time % 24], 87, 0.35) : [];
}
