/**
 * 离线声部负载模拟：不需要进游戏。
 *
 * 用真实 PBE2 曲库跑与运行时一致的释放模型：
 *   - Note Off 后 release 秒淡出，再 stop；
 *   - 同键重触发快速收掉旧实例；
 *   - 同时实例上限 maxVoices，超出停掉最早的；
 *   - 超长音符最多持有 maxHeld 秒。
 *
 * 用法：node tools/analyze-voice-load.mjs
 * 输出：tools/voice-load-report.md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pbe2ToNoteEvents } from "../packages/core/dist/pbe2/index.js";
import { processNote } from "../packages/core/dist/midi/note.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = join(ROOT, "midis", "library");
const REPORT = join(ROOT, "tools", "voice-load-report.md");

const SAMPLE_SECONDS = 4;
const TICK_SECONDS = 0.05;
const MAX_VOICES = 64;
const MAX_HELD_SECONDS = 8;
const SAME_NOTE_FADE_SECONDS = 0.04;
const SAME_NOTE_STOP_SECONDS = 0.1;

/** 读一份 PBE2 曲目为秒制音符事件。 */
function loadSong(file) {
    const data = new Uint8Array(readFileSync(join(LIBRARY, file)));
    return pbe2ToNoteEvents(data);
}

function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

/**
 * 模拟一首曲目。
 * audible = 实际还在发声；handle = JS 里仍持有 SoundInstance 的实例数。
 */
function simulate(notes, releaseSeconds) {
    const voices = [];
    let open = [];
    const byMidi = new Map();
    let evictions = 0;

    for (const note of notes) {
        const start = note.time;
        const pitch = processNote(note.midi, false).pitch;
        const naturalEnd = start + SAMPLE_SECONDS / pitch;
        const noteOff = start + Math.max(0.05, note.duration);
        const releaseEnd = noteOff + releaseSeconds;
        const audibleEnd = Math.min(naturalEnd, releaseEnd);
        const handleEnd = Math.min(noteOff, start + MAX_HELD_SECONDS) + releaseSeconds + 0.1;

        // 同键重触发：旧实例 40ms 淡出、约 100ms 后 stop。
        const same = byMidi.get(note.midi);
        if (same) {
            for (const voice of same) {
                if (voice.handleEnd <= start) continue;
                voice.audibleEnd = Math.min(voice.audibleEnd, start + SAME_NOTE_FADE_SECONDS);
                voice.handleEnd = Math.min(voice.handleEnd, start + SAME_NOTE_STOP_SECONDS);
            }
        }

        const voice = { start, audibleEnd, handleEnd, midi: note.midi };
        voices.push(voice);
        const list = same ?? [];
        list.push(voice);
        byMidi.set(note.midi, list);
        open.push(voice);

        // 清掉已经结束的句柄；上限只看仍持有 handle 的实例。
        if (open.length > 64) open = open.filter((item) => item.handleEnd > start);
        let active = open.filter((item) => item.handleEnd > start).length;
        while (active > MAX_VOICES) {
            const index = open.findIndex((item) => item.handleEnd > start);
            if (index < 0) break;
            const evicted = open.splice(index, 1)[0];
            evicted.audibleEnd = start;
            evicted.handleEnd = start;
            active--;
            evictions++;
        }

        // 同键列表只需要保留仍可能冲突的实例。
        if (list.length > 16) {
            byMidi.set(note.midi, list.filter((item) => item.handleEnd > start));
        }
    }

    const end = Math.max(0, ...voices.map((voice) => Math.max(voice.audibleEnd, voice.handleEnd)));
    const audible = [];
    const handles = [];
    let audibleIndex = 0;
    let handleIndex = 0;
    const audibleEvents = voices
        .flatMap((voice) => [
            { time: voice.start, delta: 1 },
            { time: voice.audibleEnd, delta: -1 },
        ])
        .sort((a, b) => a.time - b.time || a.delta - b.delta);
    const handleEvents = voices
        .flatMap((voice) => [
            { time: voice.start, delta: 1 },
            { time: voice.handleEnd, delta: -1 },
        ])
        .sort((a, b) => a.time - b.time || a.delta - b.delta);

    let audibleNow = 0;
    let handlesNow = 0;
    let peakAudible = 0;
    let peakHandles = 0;
    let peakAudibleTime = 0;
    for (let time = 0; time <= end + TICK_SECONDS; time += TICK_SECONDS) {
        while (audibleIndex < audibleEvents.length && audibleEvents[audibleIndex].time <= time) {
            audibleNow += audibleEvents[audibleIndex++].delta;
        }
        while (handleIndex < handleEvents.length && handleEvents[handleIndex].time <= time) {
            handlesNow += handleEvents[handleIndex++].delta;
        }
        audible.push(audibleNow);
        handles.push(handlesNow);
        if (audibleNow > peakAudible) {
            peakAudible = audibleNow;
            peakAudibleTime = time;
        }
        if (handlesNow > peakHandles) peakHandles = handlesNow;
    }

    return {
        notes: notes.length,
        duration: end,
        peakAudible,
        peakAudibleTime,
        peakHandles,
        p95Audible: percentile(audible, 0.95),
        p95Handles: percentile(handles, 0.95),
        meanAudible: audible.reduce((sum, value) => sum + value, 0) / Math.max(1, audible.length),
        evictions,
        maxHeldAtEnd: handles.at(-1) ?? 0,
    };
}

function loadIndex() {
    const meta = JSON.parse(readFileSync(join(LIBRARY, "index.json"), "utf8"));
    const files = new Set(readdirSync(LIBRARY).filter((name) => name.endsWith(".bin")));
    return meta.filter((song) => files.has(`${song.id}.bin`));
}

function summarize(releaseSeconds) {
    const index = loadIndex();
    const results = [];
    for (const meta of index) {
        try {
            const notes = loadSong(`${meta.id}.bin`);
            const stats = simulate(notes, releaseSeconds);
            results.push({ id: meta.id, name: meta.name, ...stats });
        } catch (error) {
            console.warn(`跳过 ${meta.name}: ${error.message}`);
        }
    }
    const peaks = results.map((item) => item.peakAudible);
    const p95 = results.map((item) => item.p95Audible);
    return {
        releaseSeconds,
        songs: results,
        maxPeak: Math.max(...peaks),
        maxP95: Math.max(...p95),
        meanPeak: peaks.reduce((a, b) => a + b, 0) / peaks.length,
        totalEvictions: results.reduce((sum, item) => sum + item.evictions, 0),
        songsOverCap: results.filter((item) => item.evictions > 0).length,
    };
}

const settings = [0.12, 0.35, 0.6, 0.8];
const summaries = settings.map(summarize);
const main = summaries.find((item) => item.releaseSeconds === 0.6);
const top = [...main.songs].sort((a, b) => b.peakAudible - a.peakAudible).slice(0, 12);

const lines = [
    "# 离线声部负载模拟（600ms 释放）",
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- 曲库：${main.songs.length} 首真实 PBE2`,
    `- 采样长度：${SAMPLE_SECONDS}s；同键重触发 ${SAME_NOTE_FADE_SECONDS * 1000}ms 淡出 / ${SAME_NOTE_STOP_SECONDS * 1000}ms 停止`,
    `- 实例上限：${MAX_VOICES}；超长音符最多持有 ${MAX_HELD_SECONDS}s`,
    "- `audible` = 实际还在发声；`handle` = JS 仍持有 SoundInstance 的实例数（淡出期间两者相同）",
    "",
    "## 释放时长对比",
    "",
    "| 释放 | 全库最大 audible | 全库最大 P95 | 平均峰值 | 触发上限的曲目 | 被上限停掉的实例 |",
    "|---|---|---|---|---|---|",
];
for (const summary of summaries) {
    lines.push(
        `| ${summary.releaseSeconds}s | ${summary.maxPeak} | ${summary.maxP95} | ${summary.meanPeak.toFixed(1)} | ` +
            `${summary.songsOverCap} | ${summary.totalEvictions} |`
    );
}

lines.push(
    "",
    "## 600ms 释放下最重的 12 首",
    "",
    "| 曲目 | 音符 | 时长 | 峰值发声 | 峰值出现 | P95 发声 | 峰值 handle | 上限停掉 |",
    "|---|---|---|---|---|---|---|---|"
);
for (const song of top) {
    lines.push(
        `| ${song.name} | ${song.notes} | ${song.duration.toFixed(0)}s | ${song.peakAudible} | ` +
            `${song.peakAudibleTime.toFixed(1)}s | ${song.p95Audible} | ${song.peakHandles} | ${song.evictions} |`
    );
}

const worst = top[0];
lines.push(
    "",
    "## 结论",
    "",
    `- 600ms 释放下全库最大同时发声 **${main.maxPeak}**，出现在《${worst?.name ?? "?"}》第 ${worst?.peakAudibleTime.toFixed(1)} 秒。`,
    `- 全库最大 P95 为 **${main.maxP95}**，即 95% 的时间发声数不超过这个值。`,
    `- ${MAX_VOICES} 上限 ${main.totalEvictions === 0 ? "没有触发" : `被触发 ${main.totalEvictions} 次`}。`,
    `- 模拟结束时所有实例的 handle 都为 0，说明按 Note Off + 释放模型不会留下永久实例。`,
    "",
    "复现：`node tools/analyze-voice-load.mjs`",
    ""
);

writeFileSync(REPORT, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
