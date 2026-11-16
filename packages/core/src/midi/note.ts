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

/**
 * 可切换的钢琴音色（采样包）。
 * value 是设置中持久化的稳定编号，id 对应 rp/sounds 下的采样目录前缀。
 */
export const PIANO_TIMBRES = [
    { value: 0, id: "piano", label: "标准钢琴", description: "默认 · FluidR3 GM 大钢琴，熟悉的电子琴音色" },
    { value: 1, id: "classic_grand", label: "经典三角", description: "CC0 · VCSL 施坦威 B，温暖圆润的古典独奏" },
    { value: 2, id: "bright_grand", label: "明亮三角", description: "CC BY 3.0 · Salamander 雅马哈 C5，清晰通透" },
    { value: 3, id: "upright", label: "原声立式", description: "CC0 · FreePats Kawai 立式，亲切柔和" },
    { value: 4, id: "electric_piano", label: "复古电钢", description: "CC0 · FM 合成，80 年代 DX7 电钢" },
] as const;

export type PianoTimbre = (typeof PIANO_TIMBRES)[number]["id"];
export type PianoTimbreValue = (typeof PIANO_TIMBRES)[number]["value"];

/** 采样时长档位：短音 / 标准音 / 长音 */
export const PIANO_SOUND_LAYERS = ["short", "standard", "long"] as const;
export type PianoSoundLayer = (typeof PIANO_SOUND_LAYERS)[number];

/** 全部基础采样键（C / D# / F# / A，每 3 个半音一个采样） */
export const PIANO_SAMPLE_KEYS = [
    "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7",
    "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
    "D#1", "D#2", "D#3", "D#4", "D#5", "D#6", "D#7",
    "F#1", "F#2", "F#3", "F#4", "F#5", "F#6", "F#7",
] as const;

export const DEFAULT_PIANO_TIMBRE = PIANO_TIMBRES[0].value;

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

/** 根据音色编号取音色定义（未知编号回退到默认音色） */
export function getPianoTimbre(value: number) {
    return PIANO_TIMBRES.find((timbre) => timbre.value === value) ?? PIANO_TIMBRES[0];
}

/** 根据 note 时长选择采样档位 */
export function getSoundLayerByDuration(duration: number): PianoSoundLayer {
    if (duration < 1) return "short";
    if (duration > 4) return "long";
    return "standard";
}

/**
 * 音色编号 + 采样档位 → rp/sounds 音效 id 前缀。
 * 例如 (0, "short") → "piano_short"，(1, "standard") → "classic_grand"。
 * stereo=true 时返回立体声定义，例如 "piano_short_stereo" / "classic_grand_stereo"。
 */
export function pianoSoundId(timbre: number, layer: PianoSoundLayer, stereo = false): string {
    const id = getPianoTimbre(timbre).id;
    const base = layer === "standard" ? id : `${id}_${layer}`;
    return stereo ? `${base}_stereo` : base;
}

/** 根据 note 时长获取采样音色档（与 addon 音效 id 一致） */
export function getSoundIdByDuration(
    duration: number,
    timbre: number = DEFAULT_PIANO_TIMBRE,
    stereo = false
): string {
    return pianoSoundId(timbre, getSoundLayerByDuration(duration), stereo);
}
