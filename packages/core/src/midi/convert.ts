import * as toneMidi from "@tonejs/midi";
import { OTHER_SCALE, TIME_SCALE } from "../constants.js";
import { crc32Hex } from "./crc32.js";
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

    const tracks: MidiTrack[] = midi.tracks.map((track) => {
        const notes: number[] = [];
        for (const n of track.notes) {
            notes.push(
                n.midi,
                Math.floor(n.time * TIME_SCALE),
                Math.round(n.duration * OTHER_SCALE),
                Math.round(n.velocity * OTHER_SCALE)
            );
        }
        return {
            instrument: track.instrument as unknown as MidiTrackInstrument,
            notes,
        };
    });

    return {
        id,
        name,
        duration: Math.round(midi.duration * TIME_SCALE),
        tracks,
    };
}