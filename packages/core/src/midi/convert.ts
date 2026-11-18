import * as toneMidi from "@tonejs/midi";
import { OTHER_SCALE, TIME_SCALE, VELOCITY_SCALE } from "../constants.js";
import { crc32Hex } from "./crc32.js";
import { collectSustainSegments, sustainExtensionSeconds } from "./pedal.js";
import type { MidiSong, MidiTrack, MidiTrackInstrument } from "../types.js";

type MidiCtor = typeof import("@tonejs/midi").Midi;

/**
 * @tonejs/midi 是 webpack UMD(CJS) 产物且 __esModule=true 但无 .default，
 * 各运行时 default/具名导出的互操作不一致：
 * - Node ESM：default = module.exports（可用）
 * - esbuild（vite dev 预打包）：具名导出可识别，default 为 undefined
 * - rollup + commonjs（vite build）：具名导出可识别，default 为 undefined
 * 统一在运行时解包，失败给出明确报错（避免裸 `const {Midi}=pkg` 的 undefined 崩溃）。
 */
function resolveMidiCtor(): MidiCtor {
    const ns = toneMidi as unknown as Record<string, unknown>;
    const candidates = [
        ns.Midi,
        (ns.default as Record<string, unknown> | undefined)?.Midi,
        (ns["module.exports"] as Record<string, unknown> | undefined)?.Midi,
    ];
    const ctor = candidates.find((c) => typeof c === "function");
    if (!ctor) {
        throw new Error(
            "[@piano/core] @tonejs/midi 互操作失败：无法定位 Midi 构造器，" +
                `namespace keys=${JSON.stringify(Object.keys(ns))}`
        );
    }
    return ctor as MidiCtor;
}

const Midi = resolveMidiCtor();

/** 从 .mid 二进制解析出可序列化的 MidiSong（id = crc32(内容)，与历史产物一致） */
export function midiBufferToSong(buffer: Uint8Array, name: string): MidiSong {
    const midi = new Midi(buffer);
    const id = crc32Hex(new Uint8Array(buffer));
    // 踏板在 PBE3 里没有独立事件，转换时烘焙进声音时长；
    // 同时保留原始按键时长（keyDuration），供琴键显示使用。
    const sustainSegments = collectSustainSegments(midi.tracks);
    let maxEnd = 0;

    const tracks: MidiTrack[] = midi.tracks.map((track) => {
        const notes: number[] = [];
        const keyDurations: number[] = [];
        for (const n of track.notes) {
            const end = n.time + n.duration;
            const duration = n.duration + sustainExtensionSeconds(end, sustainSegments);
            maxEnd = Math.max(maxEnd, n.time + duration);
            const soundDuration = Math.max(1, Math.round(duration * OTHER_SCALE));
            const keyDuration = Math.max(1, Math.min(soundDuration, Math.round(n.duration * OTHER_SCALE)));
            notes.push(
                n.midi,
                Math.floor(n.time * TIME_SCALE),
                soundDuration,
                Math.round(n.velocity * VELOCITY_SCALE)
            );
            keyDurations.push(keyDuration);
        }
        return {
            instrument: track.instrument as unknown as MidiTrackInstrument,
            notes,
            keyDurations,
        };
    });

    return {
        id,
        name,
        // 踏板可能把最后一个音延长到原文件时长之外，这里取两者较大值。
        duration: Math.round(Math.max(midi.duration, maxEnd) * TIME_SCALE),
        tracks,
    };
}