import type { LabNote } from "@piano/core/audioLab";

export type DemoTrack = "fast" | "slow" | "chords" | "arpeggio" | "velocity";

export const DEMO_LABELS: Record<DemoTrack, string> = {
    fast: "快速十六分旋律（120 BPM）",
    slow: "慢速表情旋律（60 BPM）",
    chords: "密集和弦",
    arpeggio: "琶音",
    velocity: "力度阶梯（同一音高）",
};

function note(midi: number, time: number, duration: number, velocity: number): LabNote {
    return { midi, time, duration, velocity: velocity / 127 };
}

function fast(): LabNote[] {
    const notes: LabNote[] = [];
    const step = 60 / 120 / 4; // 125ms 十六分
    // 8 小节：右手快速跑动，左手每拍一个低音
    const melody = [72, 74, 76, 79, 81, 79, 76, 74, 72, 76, 81, 84, 83, 81, 79, 76];
    for (let bar = 0; bar < 8; bar++) {
        for (let i = 0; i < 16; i++) {
            const index = (bar * 5 + i) % melody.length;
            const velocity = i % 4 === 0 ? 112 : i % 2 === 0 ? 88 : 70;
            notes.push(note(melody[index] + (bar % 2 === 0 ? 0 : 12), bar * 16 * step + i * step, step * 0.9, velocity));
        }
        notes.push(note(36 + (bar % 4 === 0 ? 0 : 2), bar * 16 * step, step * 3.5, 100));
        notes.push(note(48 + (bar % 4 === 0 ? 0 : 2), bar * 16 * step + step * 2, step * 1.5, 78));
    }
    return notes;
}

function slow(): LabNote[] {
    const notes: LabNote[] = [];
    const beat = 60 / 60;
    const chords: number[][] = [
        [48, 55, 64, 72],
        [45, 52, 60, 69],
        [41, 48, 57, 65],
        [43, 50, 59, 67],
    ];
    for (let bar = 0; bar < 4; bar++) {
        const chord = chords[bar];
        const at = bar * 4 * beat;
        chord.forEach((midi, index) => {
            notes.push(note(midi, at + index * 0.02, beat * 3.6, 58 + index * 9));
        });
        notes.push(note(chord[3] + 12, at + beat * 2, beat * 1.6, 96));
        notes.push(note(chord[2] + 12, at + beat * 3, beat * 0.8, 74));
    }
    return notes;
}

function chords(): LabNote[] {
    const notes: LabNote[] = [];
    const roots = [48, 53, 55, 48, 50, 55, 57, 48];
    roots.forEach((root, index) => {
        const at = index * 0.5;
        const gain = index % 4 === 0 ? 110 : 92;
        for (const interval of [0, 4, 7, 12, 16, 19]) {
            notes.push(note(root + interval, at, 0.45, gain - Math.abs(interval) * 0.8));
        }
    });
    return notes;
}

function arpeggio(): LabNote[] {
    const notes: LabNote[] = [];
    const pattern = [48, 55, 60, 64, 67, 72, 67, 64];
    const step = 60 / 100 / 4;
    for (let i = 0; i < 32; i++) {
        notes.push(note(pattern[i % pattern.length] + (i >= 16 ? 12 : 0), i * step, step * 1.8, 62 + (i % 4) * 12));
    }
    return notes;
}

function velocity(): LabNote[] {
    const notes: LabNote[] = [];
    const values = [28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124];
    values.forEach((value, index) => {
        notes.push(note(60, index * 0.55, 0.42, value));
        notes.push(note(64, index * 0.55 + 0.02, 0.42, value));
        notes.push(note(67, index * 0.55 + 0.04, 0.42, value));
    });
    return notes;
}

export function makeDemo(track: DemoTrack): LabNote[] {
    switch (track) {
        case "fast":
            return fast();
        case "slow":
            return slow();
        case "chords":
            return chords();
        case "arpeggio":
            return arpeggio();
        case "velocity":
            return velocity();
        default:
            return [];
    }
}

/** 截取一个片段并平移到 0 秒。 */
export function sliceNotes(notes: readonly LabNote[], start: number, length: number): LabNote[] {
    const end = start + length;
    return notes
        .filter((note) => note.time >= start && note.time < end)
        .map((note) => ({ ...note, time: note.time - start }));
}

export function noteName(midi: number): string {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function trackStats(notes: readonly LabNote[]) {
    if (!notes.length) return { count: 0, duration: 0, nps: 0, min: 0, max: 0 };
    const duration = Math.max(...notes.map((note) => note.time + note.duration));
    const midis = notes.map((note) => note.midi);
    return {
        count: notes.length,
        duration,
        nps: notes.length / Math.max(0.001, duration),
        min: Math.min(...midis),
        max: Math.max(...midis),
    };
}
