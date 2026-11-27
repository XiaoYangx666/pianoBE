import type { CqtMeta } from "./cqt";

export interface AmtNote {
    pitch: number;
    start: number;
    end: number;
    velocity: number;
}

/** 与 AMT 参考实现一致的阈值/峰值提取逻辑 */
export function decodeNotes(
    frame: Float32Array,
    onset: Float32Array,
    meta: CqtMeta,
    frames: number
): AmtNote[] {
    const { n_bins, fs, hop, pitch_low, frame_thr, onset_thr, min_frames } = meta;
    const frameSeconds = hop / fs;
    const active = new Uint8Array(n_bins * frames);
    for (let i = 0; i < active.length; i++) active[i] = frame[i] >= frame_thr ? 1 : 0;

    const notes: AmtNote[] = [];
    const minLength = min_frames * frameSeconds;
    for (let row = 0; row < n_bins; row++) {
        const pitch = row + pitch_low;
        const offset = row * frames;
        const onsets: number[] = [];
        for (let column = 0; column < frames; column++) {
            const probability = onset[offset + column];
            const left = column > 0 ? onset[offset + column - 1] : -1;
            const right = column < frames - 1 ? onset[offset + column + 1] : -1;
            if (probability >= onset_thr && probability >= left && probability > right) {
                onsets.push(column);
                active[offset + column] = 1;
            }
        }
        for (let i = 0; i < onsets.length; i++) {
            const start = onsets[i];
            const next = i + 1 < onsets.length ? onsets[i + 1] : frames;
            let end = start + 1;
            while (end < next && active[offset + end]) end++;
            const startSeconds = start * frameSeconds;
            const endSeconds = end * frameSeconds;
            if (endSeconds - startSeconds >= minLength - 1e-9) {
                notes.push({ pitch, start: startSeconds, end: endSeconds, velocity: 100 });
            }
        }
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return notes;
}

function writeVarLen(target: number[], value: number) {
    let buffer = value & 0x7f;
    while ((value >>= 7)) {
        buffer <<= 8;
        buffer |= (value & 0x7f) | 0x80;
    }
    while (true) {
        target.push(buffer & 0xff);
        if (buffer & 0x80) buffer >>= 8;
        else break;
    }
}

/**
 * 单轨 SMF：division 480，配合 960 ticks/s 正好是默认 120 BPM。
 * 与 AMT 参考实现的输出保持一致，@piano/core 可直接解析。
 */
export function notesToMidi(notes: AmtNote[]): Uint8Array {
    const TICKS_PER_SECOND = 960;
    const events: Array<{ tick: number; on: boolean; pitch: number; velocity: number }> = [];
    for (const note of notes) {
        events.push({
            tick: Math.round(note.start * TICKS_PER_SECOND),
            on: true,
            pitch: note.pitch,
            velocity: note.velocity,
        });
        events.push({
            tick: Math.round(note.end * TICKS_PER_SECOND),
            on: false,
            pitch: note.pitch,
            velocity: 0,
        });
    }
    events.sort((a, b) => a.tick - b.tick || (a.on === b.on ? 0 : a.on ? 1 : -1));

    const track: number[] = [];
    let lastTick = 0;
    for (const event of events) {
        writeVarLen(track, event.tick - lastTick);
        lastTick = event.tick;
        track.push(event.on ? 0x90 : 0x80, event.pitch & 0x7f, event.velocity & 0x7f);
    }
    writeVarLen(track, 0);
    track.push(0xff, 0x2f, 0x00);

    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0x01, 0xe0];
    const length = track.length;
    const trackHeader = [
        0x4d,
        0x54,
        0x72,
        0x6b,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
    ];
    return new Uint8Array([...header, ...trackHeader, ...track]);
}
