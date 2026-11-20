import {
    createSecretScore, readLoadedSongNotes, SECRET_MUSIC_CHECKSUM, SECRET_MUSIC_ID, TIME_SCALE,
    type LoadedSong, type SecretPhrase, type SecretScore,
} from "@piano/core";
import { GRAND_KEY_HITBOXES } from "../../data/grand.generated";
import { KEY_HITBOXES } from "../../data/hitboxes.generated";
import { grandDefinition, type InstrumentDefinition } from "../instrument/definition";
import { catmullRom, rgbToHex, segmentsAlong, type Point3, type Segment3 } from "./vfxDraw";
import type { PianoParticleOverride } from "./particleOverride";
import type { VfxEmitter, VfxParticle } from "./vfxLab";
import type { VfxBatch } from "./vfxPreset";
import { vfxStageFrame } from "./vfxStage";

const scores = new WeakMap<LoadedSong, SecretScore>();

export function secretScoreForSong(song?: LoadedSong) {
    if (song?.id !== SECRET_MUSIC_ID || song.header.checksum !== SECRET_MUSIC_CHECKSUM || song.duration !== 3444) return;
    let score = scores.get(song);
    if (!score) {
        const notes = readLoadedSongNotes(song).map(note => ({
            time: note.time / TIME_SCALE, midi: note.midi, velocity: note.velocity / 127,
            duration: note.soundDuration / TIME_SCALE, keyDuration: note.keyDuration / TIME_SCALE,
        }));
        score = createSecretScore(notes, song.duration / TIME_SCALE);
        scores.set(song, score);
    }
    return score;
}

type CinemaParticle = Extract<VfxParticle, `cinema_${string}`>;
const groups = {
    cinema_dust: "field", cinema_filament: "orbit", cinema_sweep: "ripple", cinema_note: "fountain", cinema_shock: "ripple",
} as const;

function render(particle: CinemaParticle, particles: number, lifetime: number,
    variables: Record<string, number>, transform?: VfxEmitter["transform"],
    offset: VfxEmitter["offset"] = { x: 0, y: 0, z: 0 }): VfxEmitter {
    return { particle, effect: groups[particle], particles, lifetime, variables: { ...variables, count: particles, life: lifetime },
        offset, transform };
}

function tint(warmth: number, opacity: number) {
    const w = Math.max(0, Math.min(1, warmth));
    return {
        red: 0.39 + 0.61 * w, green: 0.57 + 0.17 * w, blue: 0.91 - 0.58 * w, opacity: Math.min(1, opacity),
    };
}

type Point = Point3;

/** Billboards per lane. The renderer re-emits the same curve from these samples. */
export const SECRET_ARC_SAMPLES: readonly number[] = [26, 26];

/**
 * One billboard per sample. Neighbouring dashes overlap slightly, so the lane
 * reads as a single continuous arc instead of a row of blobs.
 */
function segmentEmitters(particle: CinemaParticle, segments: readonly Segment3[], life: number,
    color: { red: number; green: number; blue: number; opacity: number }, light: number,
    width: number, travel: number): VfxEmitter[] {
    return segments.map(({ point, tangent, spacing }, index) => {
        const [x, y, z] = point;
        const [tx, ty, tz] = tangent;
        // Dissolve both ends of the lane instead of stopping on a bright dash.
        const edge = Math.min(1, index / 3, (segments.length - 1 - index) / 3);
        return render(particle, 1, life, {
            red: color.red, green: color.green, blue: color.blue, opacity: color.opacity,
            tx0: tx, ty0: ty, tz0: tz, light: light * edge, width,
            length: spacing * (1.15 + 0.55 * edge),
            x1: tx * travel * 0.4, y1: ty * travel * 0.4, z1: tz * travel * 0.4,
            x2: tx * travel * 0.7, y2: ty * travel * 0.7, z2: tz * travel * 0.7,
            x3: tx * travel, y3: ty * travel, z3: tz * travel,
        }, undefined, { x, y, z });
    });
}

function curvedRibbon(frame: SecretPhrase, side: number, accent = 0): VfxEmitter[] {
    const retreat = side < 0;
    const spread = 0.70 + 0.60 * frame.release + 0.20 * accent;
    const radius = (0.86 + 0.30 * frame.radius) * (1 + 0.05 * accent);
    const height = frame.height;
    const s = side;
    const points: Point[] = [
        [s * (1.10 * radius), 0.38 + 0.38 * height, -0.50 - 0.35 * spread],
        [s * (1.95 * radius + 0.20 * accent), 1.05 + 0.65 * height, 0.35 + 0.30 * spread],
        [s * (1.35 * radius), 1.72 + 0.55 * height, 1.05 + 0.30 * spread],
        [s * (0.25 * radius), 1.92 + 0.40 * height, 1.30 + 0.25 * spread],
        [-s * (0.85 * radius), 1.55 + 0.35 * height, 1.00 + 0.25 * spread],
        [-s * (1.58 * radius + 0.20 * accent), 0.86 + 0.30 * height, 0.16 - 0.08 * spread],
    ];
    const strength = Math.min(1, frame.light * frame.coherence * (retreat ? 0.61 : 0.86) + accent * 0.22);
    return segmentEmitters("cinema_filament", segmentsAlong(catmullRom(points),
        SECRET_ARC_SAMPLES[retreat ? 0 : 1]),
    retreat ? 1.38 : 1.48, tint(retreat ? frame.warmth * 0.68 : frame.warmth + 0.20, 1),
    strength, 0.085 + 0.02 * accent, 0.18);
}

function floorSweep(energy: number, phase: number, first: boolean) {
    const extent = first ? 2.1 : 2.69;
    const points: Point[] = [
        [-extent, 0.07, -0.45 - 0.1 * phase],
        [-extent * 0.42, 0.05, extent * 0.52],
        [extent * 0.42, 0.05, extent * 0.52],
        [extent, 0.07, -0.45 - 0.1 * phase],
    ];
    return segmentEmitters("cinema_sweep", segmentsAlong(points, 20), 1.50,
        tint(0.78, 1), energy * 0.75, 0.10, 0.22);
}

function burst(energy: number, phase: number) {
    return render("cinema_shock", energy < 1 ? 18 : 28, 1.15,
        { ...tint(0.88, energy), strength: energy, phase: phase * 37 }, { y: 0.08 });
}

type Keys = readonly (readonly [number, number, number, number, number, number, number, number, number])[];

function keyboard(keys: Keys) {
    const origins = new Map<number, [number, number, number]>();
    // Authored key boxes use the opposite horizontal axis to the stage frame.
    for (const [midi, x, , z, X, y, Z] of keys) {
        if (!origins.has(midi)) origins.set(midi, [-(x + X) / 32, y / 16 + 0.012, (z + Z) / 32]);
    }
    return origins;
}

const grandKeys = keyboard(GRAND_KEY_HITBOXES);
const uprightKeys = keyboard(KEY_HITBOXES);

/** Native renderer for the shared Secret score. Each client batch evolves independently between music samples. */
export class SecretCinemaPlayer {
    private previous: number;
    private nextRibbon = 0;
    private nextDust = 0;
    private readonly keys: typeof grandKeys;
    private readonly centerZ: number;

    constructor(private readonly score: SecretScore, definition: InstrumentDefinition | undefined,
        position: number, start = false) {
        this.previous = start ? -0.0001 : position;
        this.keys = definition === grandDefinition ? grandKeys : uprightKeys;
        const stage = vfxStageFrame(definition);
        this.centerZ = stage.centerZ;
    }

    keyParticleOverride(seconds: number): PianoParticleOverride | undefined {
        if (seconds < 0 || seconds >= this.score.duration) return undefined;
        const now = this.score.at(seconds);
        if (now.light < 0.03) return undefined;
        const c1 = tint(now.warmth * 0.65, 1);
        const c2 = tint(now.warmth * 0.9 + 0.2, 1);
        return {
            style: "stardust",
            colors: [
                rgbToHex(c1.red * 255, c1.green * 255, c1.blue * 255),
                rgbToHex(c2.red * 255, c2.green * 255, c2.blue * 255),
            ],
            glimmer: true,
            intensity: Math.min(1, Math.max(0.45, now.light)),
        };
    }

    update(seconds: number): VfxBatch[] {
        if (seconds === this.previous || seconds >= this.score.duration) return [];
        if (seconds < this.previous || seconds - this.previous > 0.25) {
            this.previous = seconds;
            this.nextDust = this.nextRibbon = seconds;
        }
        const now = this.score.at(seconds);
        const batches: VfxBatch[] = [];
        const ribbon = (accent = 0) => {
            const left = curvedRibbon(now, -1, accent);
            const right = curvedRibbon(now, 1, accent);
            return left.flatMap((emitter, index) => [emitter, right[index]]);
        };

        for (const [i, peak] of this.score.peaks.entries()) {
            if (this.previous < peak && peak <= seconds) {
                const energy = i === 0 ? 0.64 : 1;
                batches.push({ priority: 8, emitters: [
                    ...floorSweep(energy, now.phase, i === 0),
                    ...ribbon(energy),
                    burst(energy * 0.85, now.phase),
                ] });
                this.nextRibbon = seconds + 0.86;
            }
        }

        if (seconds >= this.nextDust) {
            this.nextDust = seconds + 0.88;
            if (now.light > 0.035) batches.push({ priority: 1, emitters: [render("cinema_dust", 23, 1.69, {
                ...tint(now.warmth * 0.78, 0.18 + now.light * 0.42),
                phase: now.phase * 22, release: now.release, radius: now.radius, coherence: now.coherence,
                bright: now.light,
            })] });
        }
        const notes = now.recent.filter(note => note.time > this.previous).sort((a, b) => a.midi - b.midi);
        const lowest = notes[0];
        const highest = notes.at(-1);
        for (const note of new Set([lowest, highest])) {
            if (!note || now.light < 0.05) continue;
            const key = this.keys.get(note.midi);
            if (!key) continue;
            const [x, y, z] = key;
            const pitch = (note.midi - 21) / 87;
            batches.push({ priority: 3, emitters: [render("cinema_note", 2, 0.43 + pitch * 0.12, {
                ...tint(now.warmth * 0.67 + pitch * 0.40, now.light * note.velocity * 0.76),
                drift: (pitch - 0.5) * (1.6 + 0.55 * now.release), height: 0.34 + pitch * 0.65,
                depth: 0.55 + pitch * 1.06, sustain: Math.min(1, note.duration),
            }, { x, y, z: z - this.centerZ })] });
        }
        if (seconds >= this.nextRibbon && now.light > 0.14 && now.coherence > 0.22) {
            batches.push({ priority: 5, emitters: ribbon() });
            this.nextRibbon = seconds + (now.coherence > 0.70 ? 0.88 : 1.07);
        }
        this.previous = seconds;
        return batches;
    }
}
