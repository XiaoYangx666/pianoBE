import type { NoteEvent } from "./midi/audioPlayer.js";
type CinemaNote = NoteEvent & { keyDuration?: number };

export const SECRET_MUSIC_ID = "e1563b03";
/** CRC of the note stream of the arrangement this staging was timed to. */
export const SECRET_MUSIC_CHECKSUM = 2784540404;

export const SECRET_CHAPTERS = [
    { time: 0, title: "余光" },
    { time: 6.1, title: "回声" },
    { time: 24.175, title: "引力" },
    { time: 54.1, title: "悬停" },
    { time: 64.075, title: "回卷" },
    { time: 72.025, title: "穿越" },
    { time: 79.9, title: "归寂" },
];

export const secretEase = (from: number, to: number, value: number) => {
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
};

// Seconds · coherence, radius, height, warmth, light, tension.
// The continuous field survives from the first note to the last shot.
const direction = [
    [0, 0.04, 2.25, 0.58, 0.22, 0.04, 0.05],
    [2.1, 0.11, 2.30, 0.65, 0.31, 0.17, 0.10],
    [6.1, 0.30, 2.48, 0.77, 0.38, 0.31, 0.17],
    [14.1, 0.43, 2.63, 0.94, 0.42, 0.43, 0.24],
    [23.7, 0.39, 2.82, 0.89, 0.40, 0.38, 0.25],
    [29.2, 0.66, 2.68, 1.04, 0.51, 0.55, 0.34],
    [34.3, 0.79, 2.84, 1.31, 0.58, 0.70, 0.42],
    [42.2, 0.85, 3.01, 1.48, 0.60, 0.76, 0.53],
    [47.2, 0.91, 3.19, 1.54, 0.65, 0.82, 0.56],
    [54.1, 0.51, 2.89, 0.64, 0.43, 0.36, 0.22],
    [58.4, 0.17, 3.15, 0.40, 0.36, 0.23, 0.16],
    [63.7, 0.36, 3.25, 0.61, 0.47, 0.40, 0.30],
    [67.0, 0.69, 3.10, 1.09, 0.61, 0.66, 0.59],
    [71.85, 0.99, 2.28, 1.55, 0.69, 0.91, 0.95],
    [73.1, 0.94, 2.72, 1.56, 0.76, 1.00, 0.79],
    [74.00, 0.99, 2.38, 1.68, 0.82, 1.02, 1.00],
    [74.68, 1.00, 3.22, 1.95, 0.89, 1.24, 0.92],
    [76.5, 0.77, 3.68, 1.43, 0.80, 0.76, 0.61],
    [80.0, 0.53, 2.75, 0.86, 0.57, 0.46, 0.33],
    [82.4, 0.31, 2.44, 0.54, 0.39, 0.23, 0.19],
    [86.1, 0.02, 2.59, 0.44, 0.30, 0.00, 0.02],
] as const;
const directingTimes = direction.map(item => ({ time: item[0] }));

type Stroke = { time: number; strength: number; low: number; high: number; count: number };

function groupNotes(notes: readonly NoteEvent[]) {
    const strokes: Stroke[] = [];
    for (const note of notes) {
        let stroke = strokes.at(-1);
        if (!stroke || note.time - stroke.time > 0.026) {
            stroke = { time: note.time, strength: 0, low: 0, high: 0, count: 0 };
            strokes.push(stroke);
        }
        stroke.strength = Math.max(stroke.strength, note.velocity);
        stroke.low = Math.max(stroke.low, note.midi < 55 ? note.velocity : 0);
        stroke.high = Math.max(stroke.high, note.midi >= 71 ? note.velocity : 0);
        stroke.count++;
    }
    return strokes;
}

function lowerBound<T extends { time: number }>(events: readonly T[], time: number) {
    let from = 0;
    let to = events.length;
    while (from < to) {
        const middle = (from + to) >>> 1;
        if (events[middle].time < time) from = middle + 1;
        else to = middle;
    }
    return from;
}

export function createSecretScore(events: readonly CinemaNote[], duration: number) {
    const notes = events.filter(note => note.velocity > 0);
    const strokes = groupNotes(notes);

    // Choose actual accented note groups near the two arrivals of the climactic phrase.
    const peaks = [[71.95, 72.50], [74.15, 74.75]].map(([from, to]) =>
        strokes.filter(s => s.time >= from && s.time <= to)
            .reduce((best, s) => !best || s.low * 5 + s.count > best.low * 5 + best.count ? s : best, undefined as Stroke | undefined)?.time ?? from);
    const travel = new Float32Array(Math.ceil(duration * 80) + 1);
    let energy = 0;
    let cursor = 0;
    for (let i = 1; i < travel.length; i++) {
        const t = i / 80;
        while (cursor < strokes.length && strokes[cursor].time <= t) {
            energy += strokes[cursor++].high * 0.38;
        }
        energy *= 0.982;
        travel[i] = travel[i - 1] + (0.26 + Math.min(1.65, energy) * 0.59) / 80;
    }

    function at(time: number) {
        const end = lowerBound(directingTimes, time);
        const from = direction[Math.max(0, end - 1)];
        const to = direction[Math.min(direction.length - 1, end)];
        const f = from === to ? 0 : secretEase(from[0], to[0], time);
        const [coherence, radius, height, warmth, light, tension] = from.slice(1).map((v, n) => v + (to[n + 1] - v) * f);
        let attack = 0;
        let bass = 0;
        let shimmer = 0;
        let weight = 0;
        let pitch = 0;
        let sustain = 0;
        for (let i = lowerBound(strokes, time - 1.3); i < strokes.length && strokes[i].time <= time; i++) {
            const stroke = strokes[i];
            const age = time - stroke.time;
            const attackShape = Math.min(1, age * 45) * Math.exp(-age * 9.7);
            attack = Math.max(attack, (0.46 + 0.54 * Math.min(1, stroke.count / 6)) * stroke.strength * attackShape);
            bass = Math.max(bass, stroke.low * Math.min(1, age * 40) * Math.exp(-age * 4.6));
            shimmer += stroke.high * Math.exp(-age * 5.5) * 0.30;
        }
        const recent = [];
        for (let i = lowerBound(notes, time - 1.72); i < notes.length && notes[i].time <= time; i++) {
            const note = notes[i];
            const age = time - note.time;
            if (age < (note.keyDuration ?? note.duration) + 0.18) {
                const w = note.velocity * Math.exp(-age * 4);
                weight += w;
                pitch += w * (note.midi - 21) / 87;
            }
            if (age < note.duration) sustain += note.velocity * Math.exp(-age * 2.2) * 0.25;
            if (age < 1.42) recent.push(note);
        }
        const surge = (age: number) => age >= 0 ? secretEase(0, 0.13, age) * Math.exp(-age * 0.61) : 0;
        const releases = peaks.map(peak => time - peak);
        const release = surge(releases[0]) * 0.48 + surge(releases[1]) * 1.12;
        const inhale = releases.reduce((sum, age, index) =>
            sum + secretEase(-0.53, -0.13, age) * (1 - secretEase(-0.06, 0.10, age)) * (0.64 + index * 0.36), 0);
        const flash = releases.reduce((sum, age, index) =>
            sum + (age >= 0 ? secretEase(0, 0.036, age) * Math.exp(-age * 6.6) * (0.70 + index * 0.50) : 0), 0);
        const t = Math.min(travel.length - 2, Math.max(0, time * 80));
        const frame = Math.floor(t);
        const phase = travel[frame] + (travel[frame + 1] - travel[frame]) * (t - frame);
        return {
            coherence, radius: radius * (1 - 0.17 * inhale), height, warmth,
            light: light * (1 - 0.19 * inhale), tension, release, releases, flash, phase: phase - 0.46 * inhale, recent,
            attack, bass, shimmer: Math.min(1.25, shimmer), sustain: Math.min(1, sustain),
            pitch: weight ? pitch / weight : 0.5, activity: Math.min(1, weight / 4),
        };
    }

    return { notes, duration, at, peaks };
}

export type SecretScore = ReturnType<typeof createSecretScore>;
export type SecretPhrase = ReturnType<SecretScore["at"]>;
