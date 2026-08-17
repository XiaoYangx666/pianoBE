/**
 * 音符→采样映射（与 addon 完全一致，零 MC 依赖）。
 * 采样基准音：C / D# / F# / A（每 3 个半音一个采样），变调播放。
 * 前端（WebAudio 采样播放）与 addon（playSound）共用同一套映射，音色一致。
 */

const NOTE_ORDER = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
];
// 采样基准
const baseNotes = ["C", "D#", "F#", "A"];
const baseIndexes = baseNotes.map((n) => NOTE_ORDER.indexOf(n));

/** 单个音符的采样映射结果 */
export interface NoteInfo {
    name: string;
    /** 使用的采样音名（如 "C4"） */
    sample: string;
    /** 变调比（2^(diff/12)），采样播放时作为 playbackRate / pitch */
    pitch: number;
    midi: number;
}

// MIDI → 音名（60 -> C4）
export function midiToNoteName(midi: number): string {
    const noteIndex = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_ORDER[noteIndex]}${octave}`;
}

// 音名 → MIDI（C4 -> 60）
export function noteNameToMidi(note: string): number {
    const namePart = note.slice(0, -1);
    const octavePart = Number(note.slice(-1));
    const index = NOTE_ORDER.indexOf(namePart);
    return (octavePart + 1) * 12 + index;
}

function getShortestDiff(a: number, b: number): number {
    let diff = a - b;
    if (diff > 6) diff -= 12;
    if (diff < -6) diff += 12;
    return diff;
}

export function processNote(midi: number, shift: boolean): NoteInfo {
    // 升八度
    if (shift) midi += 12;

    const name = midiToNoteName(midi);

    // 防止负数（更健壮）
    const noteIndex = ((midi % 12) + 12) % 12;

    let bestBaseIndex = 0;
    let bestDiff = Infinity;

    for (const baseIndex of baseIndexes) {
        const diff = getShortestDiff(noteIndex, baseIndex);

        if (Math.abs(diff) < Math.abs(bestDiff)) {
            bestDiff = diff;
            bestBaseIndex = baseIndex;
        }
    }

    // sample 对应的 octave
    const sampleMidi = midi - bestDiff;
    const sampleName = midiToNoteName(sampleMidi);

    return {
        name,
        sample: sampleName,
        pitch: Math.pow(2, bestDiff / 12),
        midi,
    };
}

/** 根据 note 时长获取采样音色档（与 addon 音效 id 一致） */
export function getSoundIdByDuration(duration: number): string {
    if (duration < 1) {
        return "piano_short";
    } else if (duration > 4) {
        return "piano_long";
    } else {
        return "piano";
    }
}
