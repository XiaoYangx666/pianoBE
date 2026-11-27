/**
 * Audio Lab 离线渲染与客观测量（开发工具）。
 *
 * 用法（仓库根目录，先构建 core 与实验采样）：
 *   node tools/audio-lab-render.mjs
 *
 * 输入：
 *   midis/files/LiSA 红莲华.mid（高密度快歌）
 *   midis/files/周杰伦 - 枫.mid（较慢、力度变化明显）
 *
 * 输出：
 *   build/audio-lab/*.ogg / *.wav     A/B 试听
 *   build/audio-lab/metrics.json      调度 / 力度 / 释放指标
 *   build/audio-lab/probes.json       力度探针（供 Python 做频谱分析）
 *
 * 所有方案使用同一套采样映射与增益规则；A/B 组内共用一个峰值归一系数，
 * 避免“各自归一化”掩盖响度差异。
 */
import midiPkg from "@tonejs/midi";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    durationBuckets,
    layerForVelocity,
    noteEnd,
    scheduleMetrics,
    scheduleNotes,
    velocityBuckets,
    velocityHistogram,
    velocityGainDb,
    voiceStats,
} from "../../packages/core/dist/audioLab/index.js";
import { pianoSoundId, processNote, velocityLayerIndex } from "../../packages/core/dist/midi/note.js";

const { Midi } = midiPkg;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FFMPEG = process.env.FFMPEG || "D:\\ffmpeg\\bin\\ffmpeg.exe";
const SR = 44100;
const OUT = join(ROOT, "build", "audio-lab");
const SOUNDS = join(ROOT, "packages", "web", "public", "piano");
const LAB = join(ROOT, "packages", "web", "public", "lab", "vcsl");
const MANIFEST = join(LAB, "manifest.json");

const TRACKS = [
    {
        id: "lisa",
        label: "LiSA 红莲华（高密度快歌）",
        file: join(ROOT, "midis", "files", "LiSA 红莲华.mid"),
        seconds: 30,
    },
    {
        id: "feng",
        label: "周杰伦 枫（慢速表情）",
        file: join(ROOT, "midis", "files", "周杰伦 - 枫.mid"),
        seconds: 30,
    },
];

const LAYER_IDS = ["vl2", "vl3", "vl4"];

// midis/files/ 被 gitignore，干净克隆里没有这些曲子：先说清楚缺什么，
// 而不是在 readFileSync 里抛一个裸 ENOENT。
const missingTracks = TRACKS.filter((track) => !existsSync(track.file));
if (missingTracks.length > 0) {
    console.error("❌ audio-lab render 需要本地 MIDI 源文件（midis/files/ 不入库）：");
    for (const track of missingTracks) console.error(`   缺少 ${track.file}`);
    console.error("   把对应 .mid 放回 midis/files/ 后再运行。");
    process.exit(1);
}

function noteNameToFile(name) {
    return name.replace("#", "sharp");
}

function run(command, args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const chunks = [];
        let stderr = "";
        child.stdout.on("data", (chunk) => chunks.push(chunk));
        child.stderr.on("data", (chunk) => (stderr += String(chunk)));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolvePromise(Buffer.concat(chunks));
            else reject(new Error(`${command} 退出码 ${code}\n${stderr.slice(-2000)}`));
        });
    });
}

function parseMidi(path) {
    const midi = new Midi(readFileSync(path));
    const notes = [];
    for (const track of midi.tracks) {
        for (const note of track.notes) {
            if (note.velocity <= 0) continue;
            notes.push({
                midi: note.midi,
                time: note.time,
                duration: note.duration,
                velocity: note.velocity,
            });
        }
    }
    notes.sort((a, b) => a.time - b.time);
    return { midi, notes };
}

function pickSegment(notes, seconds) {
    // 选择 30s 内“音符最多 + 弱力度音符多”的一段：快歌仍取最密段，
    // 慢速表情曲则会优先保留真正的弱奏，便于观察多力度层。
    let bestStart = 0;
    let bestScore = -1;
    for (let start = 0; start + seconds <= Math.max(...notes.map((n) => n.time + n.duration)); start += 2) {
        const segment = notes.filter((note) => note.time >= start && note.time < start + seconds);
        const soft = segment.filter((note) => Math.round(note.velocity * 127) <= 42).length;
        const score = segment.length + soft * 1.5;
        if (score > bestScore) {
            bestScore = score;
            bestStart = start;
        }
    }
    return {
        start: bestStart,
        notes: notes
            .filter((note) => note.time >= bestStart && note.time < bestStart + seconds)
            .map((note) => ({ ...note, time: note.time - bestStart })),
    };
}

function sampleRequest(note, config, manifest) {
    const info = processNote(note.midi, false);
    if (config.sampleSet === "vcsl") {
        const key = manifest.keys[info.sample];
        const layerIndex = config.velocityMode === "single" ? 1 : layerForVelocity(note.velocity, config.velocityMode);
        const layer = key.layers[LAYER_IDS[layerIndex]];
        const levelOffset = layer.levelOffset ?? 0;
        const gainDb =
            key.baseGain +
            (1 - config.layerDynamics) * levelOffset +
            velocityGainDb(note.velocity, config.velocityExponent);
        return {
            path: join(LAB, LAYER_IDS[layerIndex], `${noteNameToFile(info.sample)}.ogg`),
            pitch: info.pitch,
            gain: 10 ** (gainDb / 20),
            layerIndex,
        };
    }
    const layer = config.velocityMode === "single"
        ? 1
        : velocityLayerIndex(Math.max(1, Math.round(note.velocity * 127)), 0);
    return {
        path: join(SOUNDS, pianoSoundId(0, layer), `${noteNameToFile(info.sample)}.ogg`),
        pitch: info.pitch,
        gain: 10 ** (velocityGainDb(note.velocity, config.velocityExponent) / 20),
        layerIndex: 0,
    };
}

const decodeCache = new Map();
async function decode(path) {
    if (decodeCache.has(path)) return decodeCache.get(path);
    const raw = await run(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-i", path,
        "-ar", String(SR), "-ac", "2", "-f", "f32le", "-",
    ]);
    const data = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const frames = new Float32Array(data.length);
    frames.set(data);
    const result = { left: new Float32Array(frames.length / 2), right: new Float32Array(frames.length / 2), length: frames.length / 2 };
    for (let i = 0; i < result.length; i++) {
        result.left[i] = frames[i * 2];
        result.right[i] = frames[i * 2 + 1];
    }
    decodeCache.set(path, result);
    return result;
}

function render(notes, config, manifest, { useVelocity = true } = {}) {
    const scheduled = scheduleNotes(notes, {
        mode: config.scheduleMode,
        tickSeconds: config.tickSeconds,
        velocityMode: config.velocityMode,
        velocityExponent: config.velocityExponent,
    });
    const duration = Math.max(...scheduled.map((note) => note.start + note.duration)) + 4.2;
    const frames = Math.ceil(duration * SR);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    for (const note of scheduled) {
        const effective = useVelocity ? note : { ...note, velocity: 100 / 127 };
        const request = sampleRequest(effective, config, manifest);
        if (!existsSync(request.path)) continue;
        const sample = decodeSync(request.path, request);
        if (!sample) continue;
        const gain = request.gain;
        const pitch = request.pitch;
        const start = Math.max(0, Math.floor(note.start * SR));
        const sourceFrames = sample.length;
        const outputFrames = Math.floor(sourceFrames / pitch);
        const attack = Math.max(1, Math.floor(0.006 * SR));
        const releaseStart = Math.floor(note.duration * SR);
        const release = config.releaseMode === "noteoff-long"
            ? Math.max(0.35, config.releaseSeconds)
            : Math.max(0.01, config.releaseSeconds);
        const releaseFrames = Math.max(1, Math.floor(release * SR));

        for (let i = 0; i < outputFrames && start + i < frames; i++) {
            let env = 1;
            if (i < attack) env = i / attack;
            if (config.releaseMode === "noteoff" || config.releaseMode === "noteoff-long") {
                if (i >= releaseStart) {
                    env *= Math.max(0, 1 - (i - releaseStart) / releaseFrames);
                    if (i >= releaseStart + releaseFrames) break;
                }
            }
            const position = i * pitch;
            const index = Math.floor(position);
            if (index + 1 >= sourceFrames) break;
            const fraction = position - index;
            const l = sample.left[index] * (1 - fraction) + sample.left[index + 1] * fraction;
            const r = sample.right[index] * (1 - fraction) + sample.right[index + 1] * fraction;
            const value = gain * env;
            left[start + i] += l * value;
            right[start + i] += r * value;
        }
    }
    return { left, right, frames, scheduled };
}

// 解码使用同步缓存：先异步预解码所有需要的采样。
const rawSamples = new Map();
async function preloadSamples(notes, config, manifest) {
    for (const note of scheduleNotes(notes, {
        mode: config.scheduleMode,
        tickSeconds: config.tickSeconds,
        velocityMode: config.velocityMode,
        velocityExponent: config.velocityExponent,
    })) {
        const request = sampleRequest(note, config, manifest);
        if (!rawSamples.has(request.path) && existsSync(request.path)) {
            rawSamples.set(request.path, await decode(request.path));
        }
    }
}

function decodeSync(path) {
    return rawSamples.get(path);
}

function peakOf(audio) {
    let peak = 0;
    for (let i = 0; i < audio.frames; i++) {
        peak = Math.max(peak, Math.abs(audio.left[i]), Math.abs(audio.right[i]));
    }
    return peak;
}

function scale(audio, factor) {
    for (let i = 0; i < audio.frames; i++) {
        audio.left[i] *= factor;
        audio.right[i] *= factor;
    }
}

function concat(gapSeconds, ...audios) {
    const gap = Math.floor(gapSeconds * SR);
    const frames = audios.reduce((sum, audio) => sum + audio.frames, 0) + gap * (audios.length - 1);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    let offset = 0;
    for (const audio of audios) {
        left.set(audio.left, offset);
        right.set(audio.right, offset);
        offset += audio.frames + gap;
    }
    return { left, right, frames };
}

function writeWav(audio, path) {
    const channels = 2;
    const buffer = Buffer.alloc(44 + audio.frames * channels * 2);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(SR, 24);
    buffer.writeUInt32LE(SR * channels * 2, 28);
    buffer.writeUInt16LE(channels * 2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(audio.frames * channels * 2, 40);
    let offset = 44;
    for (let i = 0; i < audio.frames; i++) {
        for (const channel of [audio.left, audio.right]) {
            const value = Math.max(-1, Math.min(1, channel[i]));
            buffer.writeInt16LE(Math.round(value * 32767), offset);
            offset += 2;
        }
    }
    return writeFile(path, buffer);
}

async function encodeOgg(wavPath, oggPath) {
    await run(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", wavPath,
        "-c:a", "libvorbis", "-q:a", "4", oggPath,
    ]);
}

async function measure(path) {
    const stderr = await new Promise((resolvePromise) => {
        const child = spawn(FFMPEG, ["-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let text = "";
        child.stderr.on("data", (chunk) => (text += String(chunk)));
        child.on("close", () => resolvePromise(text));
    });
    const integrated = [...stderr.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].map((m) => Number(m[1]));
    const peaks = [...stderr.matchAll(/Peak:\s*(-?[\d.]+) dBFS/g)].map((m) => Number(m[1]));
    return { lufs: integrated.at(-1) ?? null, peak: peaks.at(-1) ?? null };
}

function scheme(name, label, config) {
    return { name, label, config };
}

function baseConfig() {
    return {
        sampleSet: "vcsl",
        velocityMode: "layers3",
        scheduleMode: "exact",
        releaseMode: "noteoff",
        releaseSeconds: 0.12,
        layerDynamics: 0,
        velocityExponent: 1.6,
        tickSeconds: 0.05,
    };
}

const GROUPS = [
    {
        id: "velocity",
        label: "力度：单层音量 vs 2/3 层真实采样",
        schemes: [
            scheme("single", "单层 vl3 + 音量", { ...baseConfig(), velocityMode: "single" }),
            scheme("layers2", "2 层 vl2/vl4", { ...baseConfig(), velocityMode: "layers2" }),
            scheme("layers3", "3 层 vl2/vl3/vl4", { ...baseConfig(), velocityMode: "layers3" }),
        ],
        pair: ["single", "layers3"],
    },
    {
        id: "schedule",
        label: "调度：50ms tick 量化策略",
        schemes: [
            scheme("exact", "原始精确时间", { ...baseConfig(), scheduleMode: "exact" }),
            scheme("ceil", "50ms 向上取整（现状）", { ...baseConfig(), scheduleMode: "tick-ceil" }),
            scheme("round", "最近 tick", { ...baseConfig(), scheduleMode: "tick-round" }),
            scheme("round-lead", "最近 tick + 提前 1 tick", { ...baseConfig(), scheduleMode: "tick-round-lead" }),
        ],
        pair: ["ceil", "exact"],
        pair2: ["ceil", "round"],
    },
    {
        id: "release",
        label: "释放：三档采样 vs Note Off",
        schemes: [
            scheme("tier", "三档 0.5/2/4s（现状）", { ...baseConfig(), sampleSet: "fluidr3", velocityMode: "single", releaseMode: "tier" }),
            scheme("release-80", "Note Off + 80ms", { ...baseConfig(), sampleSet: "fluidr3", velocityMode: "single", releaseMode: "noteoff", releaseSeconds: 0.08 }),
            scheme("release-120", "Note Off + 120ms", { ...baseConfig(), sampleSet: "fluidr3", velocityMode: "single", releaseMode: "noteoff", releaseSeconds: 0.12 }),
            scheme("release-350", "Note Off + 350ms", { ...baseConfig(), sampleSet: "fluidr3", velocityMode: "single", releaseMode: "noteoff-long", releaseSeconds: 0.35 }),
            scheme("natural", "忽略 Note Off", { ...baseConfig(), sampleSet: "fluidr3", velocityMode: "single", releaseMode: "natural" }),
        ],
        pair: ["tier", "release-120"],
    },
    {
        id: "combined",
        label: "游戏现状 vs 综合改进",
        schemes: [
            scheme("current", "现状：单层 + 50ms ceil + 三档", {
                ...baseConfig(),
                sampleSet: "fluidr3",
                velocityMode: "single",
                scheduleMode: "tick-ceil",
                releaseMode: "tier",
                velocityExponent: 1.0,
            }),
            scheme("improved", "改进：3 层 + 精确 + Note Off", {
                ...baseConfig(),
                velocityMode: "layers3",
                scheduleMode: "exact",
                releaseMode: "noteoff",
            }),
        ],
        pair: ["current", "improved"],
        fixedVelocityFor: ["current"],
    },
];

async function renderProbe(manifest) {
    // 力度探针：同一音高、同一时值，只改变力度；用于频谱质心与层间响度连续性。
    const notes = [];
    const values = [];
    for (let velocity = 40; velocity <= 120; velocity += 4) values.push(velocity);
    values.forEach((value, index) => {
        notes.push({ midi: 60, time: index * 0.55, duration: 0.42, velocity: value / 127 });
        notes.push({ midi: 67, time: index * 0.55 + 0.02, duration: 0.42, velocity: value / 127 });
        notes.push({ midi: 72, time: index * 0.55 + 0.04, duration: 0.42, velocity: value / 127 });
    });
    const output = {};
    const audios = {};
    for (const mode of ["single", "layers3"]) {
        const config = { ...baseConfig(), velocityMode: mode, scheduleMode: "exact", releaseMode: "noteoff" };
        await preloadSamples(notes, config, manifest);
        audios[mode] = render(notes, config, manifest);
    }
    const commonPeak = Math.max(0.0001, ...Object.values(audios).map((audio) => peakOf(audio)));
    const commonScale = 0.89 / commonPeak;
    for (const mode of ["single", "layers3"]) {
        const audio = audios[mode];
        scale(audio, commonScale);
        const wav = join(OUT, `probe-${mode}.wav`);
        await writeWav(audio, wav);
        output[mode] = { file: wav, stepSeconds: 0.55, noteCount: values.length, velocities: values, pitches: [60, 67, 72] };
    }
    return output;
}

async function main() {
    if (!existsSync(MANIFEST)) throw new Error("缺少实验采样清单，请先运行 node tools/build-audio-lab-assets.mjs");
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
    await mkdir(OUT, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), tracks: [], groups: [], probes: {} };

    for (const track of TRACKS) {
        if (!existsSync(track.file)) {
            console.warn(`跳过缺失曲目：${track.file}`);
            continue;
        }
        const { notes: allNotes } = parseMidi(track.file);
        const segment = pickSegment(allNotes, track.seconds);
        const info = {
            id: track.id,
            label: track.label,
            source: track.file.replace(ROOT + "\\", ""),
            start: segment.start,
            seconds: track.seconds,
            noteCount: segment.notes.length,
            density: segment.notes.length / track.seconds,
            groups: [],
        };
        console.log(`\n${track.label}：${segment.notes.length} 音符 / ${track.seconds}s，起点 ${segment.start.toFixed(1)}s`);

        for (const group of GROUPS) {
            console.log(`  实验 ${group.id}`);
            const results = [];
            for (const item of group.schemes) {
                const useVelocity = !(group.fixedVelocityFor ?? []).includes(item.name);
                await preloadSamples(segment.notes, item.config, manifest);
                const audio = render(segment.notes, item.config, manifest, { useVelocity });
                results.push({ item, audio, useVelocity });
            }
            // 同组共用一个峰值归一系数，保留方案之间的响度差异。
            const commonPeak = Math.max(0.0001, ...results.map((result) => peakOf(result.audio)));
            const commonScale = 0.89 / commonPeak;
            const summary = [];
            for (const result of results) {
                scale(result.audio, commonScale);
                const wav = join(OUT, `${track.id}-${group.id}-${result.item.name}.wav`);
                const ogg = wav.replace(/\.wav$/, ".ogg");
                await writeWav(result.audio, wav);
                await encodeOgg(wav, ogg);
                const measured = await measure(ogg);
                const scheduled = scheduleNotes(segment.notes, {
                    mode: result.item.config.scheduleMode,
                    tickSeconds: result.item.config.tickSeconds,
                    velocityMode: result.item.config.velocityMode,
                    velocityExponent: result.item.config.velocityExponent,
                });
                const entry = {
                    name: result.item.name,
                    label: result.item.label,
                    config: result.item.config,
                    file: ogg.replace(ROOT + "\\", ""),
                    wav: wav.replace(ROOT + "\\", ""),
                    lufs: measured.lufs,
                    peakDb: measured.peak,
                    schedule: scheduleMetrics(scheduled),
                    voices: voiceStats(scheduled, {
                        releaseMode: result.item.config.releaseMode,
                        releaseSeconds: result.item.config.releaseSeconds,
                        sampleSeconds: 4,
                    }),
                    velocityBuckets: velocityBuckets(segment.notes, result.item.config.velocityMode),
                    velocityHistogram: velocityHistogram(segment.notes, 8),
                    durationBuckets: durationBuckets(segment.notes),
                };
                summary.push(entry);
                console.log(`    ${result.item.name.padEnd(12)} ${measured.lufs?.toFixed(1)} LUFS  误差均值 ${entry.schedule.meanMs.toFixed(1)}ms`);
            }
            const pairs = [];
            for (const pair of [group.pair, group.pair2].filter(Boolean)) {
                const a = summary.find((entry) => entry.name === pair[0]);
                const b = summary.find((entry) => entry.name === pair[1]);
                if (!a || !b) continue;
                const aWav = join(OUT, pathOf(a.wav));
                const bWav = join(OUT, pathOf(b.wav));
                const abWav = join(OUT, `${track.id}-${group.id}-${pair[0]}-vs-${pair[1]}-AB.wav`);
                const left = await readWav(aWav);
                const right = await readWav(bWav);
                // 试听 A/B 时把 B 的整体响度匹配到 A，避免“谁更响谁更好听”；
                // 单个方案文件仍保持原始电平，报告里的 LUFS 也来自原始文件。
                let gainDb = 0;
                if (a.lufs != null && b.lufs != null) {
                    gainDb = Math.max(-12, Math.min(12, a.lufs - b.lufs));
                    scale(right, 10 ** (gainDb / 20));
                }
                const peak = Math.max(peakOf(left), peakOf(right));
                if (peak > 0.95) {
                    const trim = 0.95 / peak;
                    scale(left, trim);
                    scale(right, trim);
                }
                const merged = concat(0.8, left, right);
                await writeWav(merged, abWav);
                await encodeOgg(abWav, abWav.replace(/\.wav$/, ".ogg"));
                pairs.push({
                    a: pair[0],
                    b: pair[1],
                    file: abWav.replace(ROOT + "\\", "").replace(/\.wav$/, ".ogg"),
                    matchedGainDb: Number(gainDb.toFixed(2)),
                });
            }
            info.groups.push({ id: group.id, label: group.label, schemes: summary, pairs });
        }
        report.tracks.push(info);
    }

    console.log("\n生成力度探针…");
    report.probes = await renderProbe(manifest);
    await writeFile(join(OUT, "metrics.json"), JSON.stringify(report, null, 2) + "\n");
    await writeIndex(report);
    console.log(`完成：${join(OUT, "metrics.json")}`);
}

async function writeIndex(report) {
    const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = [];
    for (const track of report.tracks) {
        rows.push(`<h2>${esc(track.label)}<span>${track.noteCount} 音符 / ${track.seconds}s · 起点 ${track.start.toFixed(1)}s</span></h2>`);
        for (const group of track.groups) {
            rows.push(`<section><h3>${esc(group.label)}</h3>`);
            for (const pair of group.pairs) {
                rows.push(
                    `<div class="card"><div class="title">A/B 连播 · ${esc(pair.a)} → ${esc(pair.b)}` +
                    `<span>B 响度匹配 ${pair.matchedGainDb >= 0 ? "+" : ""}${pair.matchedGainDb} dB</span></div>` +
                    `<audio controls preload="none" src="${esc(pair.file.split(/[\\/]/).pop())}"></audio></div>`
                );
            }
            rows.push(`<details><summary>单个方案</summary><div class="grid">`);
            for (const scheme of group.schemes) {
                rows.push(
                    `<div class="card"><div class="title">${esc(scheme.label)}</div>` +
                    `<div class="meta">${scheme.lufs?.toFixed(1) ?? "—"} LUFS · 误差均值 ${scheme.schedule.meanMs.toFixed(1)} ms · ` +
                    `P90 ${scheme.schedule.p90AbsMs.toFixed(1)} ms · 最大声部 ${scheme.voices.maxVoices}</div>` +
                    `<audio controls preload="none" src="${esc(scheme.file.split(/[\\/]/).pop())}"></audio></div>`
                );
            }
            rows.push(`</div></details></section>`);
        }
    }
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Audio Lab A/B</title>
<style>
body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:980px;margin:32px auto;padding:0 20px;color:#1d2328;background:#f7f8f7}
h1{font-size:22px;margin-bottom:4px}h2{font-size:18px;margin:32px 0 6px;border-top:1px solid #d8ddda;padding-top:18px}h2 span{font-size:12px;font-weight:400;color:#687370;margin-left:10px}h3{font-size:14px;margin:18px 0 8px;color:#39433f}
.card{border:1px solid #dde2df;border-radius:8px;padding:10px 12px;margin:8px 0;background:#fff}
.title{font-weight:600;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.title span,.meta{font-weight:400;font-size:12px;color:#687370}
audio{width:100%;margin-top:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}summary{cursor:pointer;font-size:12px;color:#687370;margin-top:8px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style><h1>Audio Lab A/B</h1><p>每组 A/B 连播对 B 做了整体响度匹配；单个方案保留原始电平。文件由 <code>tools/audio-lab-render.mjs</code> 生成。</p>${rows.join("\n")}</html>`;
    await writeFile(join(OUT, "index.html"), html);
}

function pathOf(relative) {
    return relative.replace(/^build[\\/]audio-lab[\\/]/, "");
}

async function readWav(path) {
    const buffer = await readFile(path);
    const frames = (buffer.length - 44) / 4;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        left[i] = buffer.readInt16LE(44 + i * 4) / 32768;
        right[i] = buffer.readInt16LE(46 + i * 4) / 32768;
    }
    return { left, right, frames };
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
