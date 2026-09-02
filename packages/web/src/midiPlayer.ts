import * as toneMidi from "@tonejs/midi";
import { SampledMidiPlayer, type NoteEvent, type PlayerState } from "@piano/core/player";

export type { PlayerState, NoteEvent } from "@piano/core/player";

type MidiCtor = typeof import("@tonejs/midi").Midi;

// @tonejs/midi 为 webpack UMD(CJS) 产物（__esModule=true 但无 .default），
// Node ESM / esbuild / rollup-commonjs 的 default、具名导出互操作不一致，
// 统一运行时解包（详见 @piano/core midi/convert.ts 同类处理）。
function resolveMidi(): MidiCtor {
    const ns = toneMidi as unknown as Record<string, unknown>;
    const ctor = [
        ns.Midi,
        (ns.default as Record<string, unknown> | undefined)?.Midi,
        (ns["module.exports"] as Record<string, unknown> | undefined)?.Midi,
    ].find((c) => typeof c === "function");
    if (!ctor) {
        throw new Error(
            "@tonejs/midi 互操作失败：无法定位 Midi 构造器，" +
                `namespace keys=${JSON.stringify(Object.keys(ns))}`
        );
    }
    return ctor as MidiCtor;
}
const Midi = resolveMidi();

/** 采样音频基路径（vite public → server 静态托管） */
const SAMPLE_BASE = "/piano";

/**
 * 直接解析 .mid 原始字节 → 音符事件（按起始时间排序）。
 * 与 server 的 midiBufferToSong 使用同一解析库（@tonejs/midi），
 * 前端无需经过 JSON 转换即可播放。
 */
export function parseMidi(buffer: ArrayBuffer): NoteEvent[] {
    const midi = new Midi(buffer);
    const events: NoteEvent[] = [];
    for (const track of midi.tracks) {
        for (const n of track.notes) {
            const velocity = Math.max(0, Math.min(1, n.velocity));
            if (velocity === 0) continue;
            events.push({
                midi: n.midi,
                time: n.time,
                duration: n.duration,
                velocity,
            });
        }
    }
    events.sort((a, b) => a.time - b.time);
    return events;
}

/**
 * 前端 MIDI 播放器（薄壳）：播放引擎在 core（@piano/core/player，与生成器共用），
 * 这里只负责 URL 采样源（/piano/<档>/<键>.ogg，文件名 # → sharp）与 .mid 事件解析。
 * 支持播放 / 暂停 / 继续 / 停止 / 跳转，多订阅状态回调。
 */
export class MidiPlayer extends SampledMidiPlayer {
    constructor() {
        super();
        // 采样文件名含 #（如 F#3/D#3）：静态文件系统存 Fsharp3/Dsharp3（URL 中 # 会被当 fragment 截断）
        this.sampleSource = async (dir: string, fileName: string) => {
            const url = `${SAMPLE_BASE}/${dir}/${fileName.replace(/#/g, "sharp")}.ogg`;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`sample ${url} ${res.status}`);
                return res.arrayBuffer();
            } catch {
                return null;
            }
        };
    }

    /** 播放 .mid 字节。须在用户手势（点击）中调用以通过浏览器音频策略。 */
    async play(
        songId: string,
        buffer: ArrayBuffer,
        name: string,
        durationSec: number
    ): Promise<void> {
        await this.playSong(songId, name, durationSec, parseMidi(buffer));
    }
}

/** 全局单例 */
export const midiPlayer = new MidiPlayer();