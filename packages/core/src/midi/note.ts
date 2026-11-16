/**
 * 音符→采样映射（与 addon 完全一致，零 MC 依赖）。
 * 采样基准音：C / D# / F# / A（每 3 个半音一个采样），变调由播放端 pitch 完成。
 * 前端（WebAudio）与 addon（playSound）共用同一套映射，音色一致。
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
 * 所有滑块的音色，按定义顺序排列。
 * value 是持久化设置里的稳定编号，id 对应 rp/sounds 下的采样目录前缀。
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

/** 力度层序号：0 最轻，2 最强；不是采样时长档位。 */
export type PianoVelocityLayer = 0 | 1 | 2;

/** 音色的力度层配置：层数必须与 rp/sounds 里实际生成的目录一致。 */
export interface PianoVelocityProfile {
    layers: 1 | 2 | 3;
    /** 由轻到强的 MIDI 力度分界，数量为 layers - 1。 */
    thresholds: readonly number[];
}

/** 三层音色统一分界（与 Audio Lab 的 vl2 / vl3 / vl4 对应）。 */
export const PIANO_VELOCITY_THRESHOLDS = [42, 84] as const;
/** 两层音色的分界。 */
export const PIANO_VELOCITY_THRESHOLDS_2 = [64] as const;

/**
 * 每个音色实际拥有的力度层数。
 *
 * 真实多力度源优先：VCSL 三层、KW 立式两层、Salamander 目前只有一层；
 * SF2 由 FluidSynth 按三个力度渲染，因此也能提供三层。
 */
export const PIANO_TIMBRE_VELOCITY: Record<PianoTimbre, PianoVelocityProfile> = {
    piano: { layers: 3, thresholds: PIANO_VELOCITY_THRESHOLDS },
    classic_grand: { layers: 3, thresholds: PIANO_VELOCITY_THRESHOLDS },
    bright_grand: { layers: 1, thresholds: [] },
    upright: { layers: 2, thresholds: PIANO_VELOCITY_THRESHOLDS_2 },
    electric_piano: { layers: 3, thresholds: PIANO_VELOCITY_THRESHOLDS },
};

/** 力度换算的参考值：校准目标响度即在这个力度下测得。 */
export const PIANO_VELOCITY_REFERENCE = 90;
/** 力度曲线指数：1.6 比线性更接近真实钢琴的弱奏压缩。 */
export const PIANO_VELOCITY_EXPONENT = 1.6;

/** 全部采样键（C / D# / F# / A，每 3 个半音一个采样）。 */
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

/** 单个音符的采样映射结果。 */
export interface NoteInfo {
    name: string;
    /** 使用的采样键名，如 "C4" */
    sample: string;
    /** 变调比：2^(diff/12)，播放时采样率 × pitch */
    pitch: number;
    midi: number;
}

// MIDI 音高 → 音名（60 -> C4）
export function midiToNoteName(midi: number): string {
    const noteIndex = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_ORDER[noteIndex]}${octave}`;
}

// 音名 → MIDI 音高（C4 -> 60）
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
    // 八度移调
    if (shift) midi += 12;

    const name = midiToNoteName(midi);

    // 防止负数取模出错
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

/** 根据音色编号取出音色定义（未知编号回落到默认音色）。 */
export function getPianoTimbre(value: number) {
    return PIANO_TIMBRES.find((timbre) => timbre.value === value) ?? PIANO_TIMBRES[0];
}

/** 音色当前的力度层配置（未知编号回落到默认音色）。 */
export function pianoVelocityProfile(timbre: number): PianoVelocityProfile {
    return PIANO_TIMBRE_VELOCITY[getPianoTimbre(timbre).id];
}

/**
 * MIDI 力度（1~127）→ 力度层序号。
 * 例如三层音色：≤42 轻、43~84 中、≥85 强。
 */
export function velocityLayerIndex(velocity: number, timbre: number = DEFAULT_PIANO_TIMBRE): PianoVelocityLayer {
    const profile = pianoVelocityProfile(timbre);
    const value = Math.min(127, Math.max(0, Math.round(velocity)));
    let layer = 0;
    for (const threshold of profile.thresholds) {
        if (value > threshold) layer++;
    }
    return Math.min(profile.layers - 1, layer) as PianoVelocityLayer;
}

/**
 * 力度 → 播放音量倍数。
 * 参考力度 90 为 1.0；弱奏更轻，强奏最多约 +4.5dB（1.67 倍）。
 */
export function velocityVolume(velocity: number): number {
    const value = Math.min(127, Math.max(0, velocity));
    if (value <= 0) return 0;
    return Math.pow(value / PIANO_VELOCITY_REFERENCE, PIANO_VELOCITY_EXPONENT);
}

/** 力度 → 相对参考力度的增益（dB）。 */
export function velocityGainDb(velocity: number): number {
    const volume = velocityVolume(velocity);
    return volume > 0 ? 20 * Math.log10(volume) : -60;
}

/**
 * 音色编号 + 力度层 → rp/sounds 有效 id 前缀。
 * 例如 (1, 1) → "classic_grand_v2"；(0, 0, true) → "piano_v1_stereo"。
 */
export function pianoSoundId(timbre: number, layer: PianoVelocityLayer, stereo = false): string {
    const id = getPianoTimbre(timbre).id;
    const base = `${id}_v${layer + 1}`;
    return stereo ? `${base}_stereo` : base;
}

/** 音色拥有的力度层序号列表。 */
export function pianoSoundLayers(timbre: number): PianoVelocityLayer[] {
    const count = pianoVelocityProfile(timbre).layers;
    return Array.from({ length: count }, (_, index) => index as PianoVelocityLayer);
}

/** 音色全部 3D 采样目录（不含 _stereo）。 */
export function pianoSoundDirs(timbre: number): string[] {
    return pianoSoundLayers(timbre).map((layer) => pianoSoundId(timbre, layer));
}

/** 按力度取采样 id；stereo=true 时返回 2D 变体。 */
export function getSoundIdByVelocity(
    velocity: number,
    timbre: number = DEFAULT_PIANO_TIMBRE,
    stereo = false
): string {
    return pianoSoundId(timbre, velocityLayerIndex(velocity, timbre), stereo);
}
