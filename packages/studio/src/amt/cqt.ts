/**
 * 浏览器端多速率 log-CQT（移植自 muscriptor web_demo/cqt.js）。
 * 每个八度先按 2^i 抽取，再用固定 128 点 FFT + librosa 稀疏基分析。
 */

export interface CqtOctave {
    n_fft: number;
    decim: number;
    n_rows: number;
    row_start: number;
    /** 稀疏基条目：[行, FFT bin, 实部, 虚部] */
    entries: Array<[number, number, number, number]>;
}

export interface CqtMeta {
    n_bins: number;
    hop: number;
    fs: number;
    pitch_low: number;
    frame_thr: number;
    onset_thr: number;
    min_frames: number;
    halfband: number[];
    octaves: CqtOctave[];
}

export interface CqtResult {
    cqt: Float32Array;
    /** 帧数 */
    frames: number;
}

type Fft = (re: Float64Array, im: Float64Array) => void;

function makeFft(n: number): Fft {
    const levels = Math.round(Math.log2(n));
    const reversed = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        let x = i;
        let r = 0;
        for (let j = 0; j < levels; j++) {
            r = (r << 1) | (x & 1);
            x >>= 1;
        }
        reversed[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
        cos[i] = Math.cos((-2 * Math.PI * i) / n);
        sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    return function fft(re, im) {
        for (let i = 0; i < n; i++) {
            const j = reversed[i];
            if (j > i) {
                let t = re[i];
                re[i] = re[j];
                re[j] = t;
                t = im[i];
                im[i] = im[j];
                im[j] = t;
            }
        }
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1;
            const step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = 0, k = 0; j < half; j++, k += step) {
                    const l = i + j;
                    const r = l + half;
                    const tre = re[r] * cos[k] - im[r] * sin[k];
                    const tim = re[r] * sin[k] + im[r] * cos[k];
                    re[r] = re[l] - tre;
                    im[r] = im[l] - tim;
                    re[l] += tre;
                    im[l] += tim;
                }
            }
        }
    };
}

/** 半带 FIR 低通后按 2 抽取（mode='same' 对齐） */
function decimate2(input: Float32Array, filter: ArrayLike<number>): Float32Array {
    const half = (filter.length - 1) >> 1;
    const n = Math.ceil(input.length / 2);
    const output = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const center = 2 * i;
        let sum = 0;
        for (let j = 0; j < filter.length; j++) {
            const index = center + half - j;
            if (index >= 0 && index < input.length) sum += filter[j] * input[index];
        }
        output[i] = sum;
    }
    return output;
}

export function computeCqt(
    audio: Float32Array,
    meta: CqtMeta,
    onProgress?: (done: number, total: number) => void,
    shouldAbort?: () => boolean
): CqtResult {
    const nBins = meta.n_bins;
    const hop = meta.hop;
    const frames = 1 + Math.floor(audio.length / hop);
    const magnitude = new Float32Array(nBins * frames);
    const fft = makeFft(meta.octaves[0].n_fft);
    let signal = audio;

    for (let oi = 0; oi < meta.octaves.length; oi++) {
        if (shouldAbort?.()) throw new DOMException("转换已取消", "AbortError");
        const octave = meta.octaves[oi];
        const half = octave.n_fft >> 1;
        const hopDown = hop / octave.decim;
        const re = new Float64Array(octave.n_fft);
        const im = new Float64Array(octave.n_fft);
        const accRe = new Float64Array(octave.n_rows);
        const accIm = new Float64Array(octave.n_rows);
        const entries = octave.entries;
        const rowBase = octave.row_start;
        const octaveFrames = Math.min(frames, 1 + Math.floor(signal.length / hopDown));

        for (let t = 0; t < octaveFrames; t++) {
            const start = t * hopDown - half;
            re.fill(0);
            im.fill(0);
            const from = Math.max(0, start);
            const to = Math.min(signal.length, start + octave.n_fft);
            for (let index = from; index < to; index++) re[index - start] = signal[index];
            fft(re, im);

            accRe.fill(0);
            accIm.fill(0);
            for (let e = 0; e < entries.length; e++) {
                const [row, bin, basisRe, basisIm] = entries[e];
                const dataRe = re[bin];
                const dataIm = im[bin];
                accRe[row] += basisRe * dataRe - basisIm * dataIm;
                accIm[row] += basisRe * dataIm + basisIm * dataRe;
            }
            for (let row = 0; row < octave.n_rows; row++) {
                magnitude[(rowBase + row) * frames + t] = Math.hypot(accRe[row], accIm[row]);
            }
        }
        if (oi + 1 < meta.octaves.length) signal = decimate2(signal, meta.halfband);
        onProgress?.(oi + 1, meta.octaves.length);
    }

    let maxDb = -Infinity;
    const cqt = new Float32Array(nBins * frames);
    for (let i = 0; i < magnitude.length; i++) {
        const db = 20 * Math.log10(Math.max(1e-5, magnitude[i]));
        cqt[i] = db;
        if (db > maxDb) maxDb = db;
    }
    const floor = maxDb - 80;
    for (let i = 0; i < cqt.length; i++) if (cqt[i] < floor) cqt[i] = floor;
    return { cqt, frames };
}
