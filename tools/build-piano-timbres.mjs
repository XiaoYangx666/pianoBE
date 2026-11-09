/**
 * 下载并生成可切换的钢琴音色采样。
 *
 * 用法（需要 ffmpeg；YDP 音色还需要 fluidsynth）：
 *   node tools/build-piano-timbres.mjs            # 仅生成缺失的音色
 *   node tools/build-piano-timbres.mjs --refresh  # 重新下载并覆盖全部音色
 *   node tools/build-piano-timbres.mjs meta_piano upright_kw
 *
 * 输出：
 *   packages/addon/rp/sounds/<音色>/{short,standard,long}/*.ogg
 *   packages/addon/rp/sounds/sound_definitions.json
 *
 * 源采样缓存在 tools/piano_timbres_source/（已 gitignore）。
 * 运行前请先执行 npm run build:core，确保音色定义与音效 id 映射是最新的。
 */
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { PIANO_TIMBRES, PIANO_SAMPLE_KEYS, PIANO_SOUND_LAYERS, pianoSoundId } from "@piano/core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", "piano_timbres_source");
const SOUNDS = join(ROOT, "packages", "addon", "rp", "sounds");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FLUIDSYNTH = process.env.FLUIDSYNTH ?? "fluidsynth";

const BASE_NOTES = PIANO_SAMPLE_KEYS;
const LAYERS = PIANO_SOUND_LAYERS;
const LAYER_OPTIONS = {
    short: { duration: 0.5, fadeStart: 0.25, fade: 0.25 },
    standard: { duration: 2, fadeStart: 1.4, fade: 0.6 },
    long: { duration: 4, fadeStart: 3, fade: 1 },
};

const TARGET_REFERENCE_DB = -15;
const MAX_PEAK_DB = -6;

const META_BASE = "https://raw.githubusercontent.com/facebookincubator/Meta-open-sound/main/systems/instruments/meta-piano/ogg";
const KW_BASE = "https://raw.githubusercontent.com/freepats/upright-piano-KW/main/samples";
const YDP_URL = "https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2";

const TIMBRES = {
    meta_piano: {
        label: "Meta Piano",
        source: (note) => ({
            url: `${META_BASE}/INSPiano_Vel03_${note.replace("#", "s")}_01.ogg`,
            extension: "ogg",
        }),
    },
    upright_kw: {
        label: "Upright Piano KW",
        source: (note) => {
            // A2 / C4 只有低力度层，其余优先使用高力度层。
            const velocity = note === "A2" || note === "C4" ? "vL" : "vH";
            return {
                url: `${KW_BASE}/${note.replace("#", "%23")}${velocity}.flac`,
                extension: "flac",
            };
        },
    },
    ydp_grand: {
        label: "YDP Grand Piano",
        source: (note) => ({ render: "ydp", note }),
    },
};

function run(command, args, options = {}) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: options.quiet ? ["ignore", "ignore", "pipe"] : "inherit" });
        let stderr = "";
        child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolvePromise();
            else reject(new Error(`${command} 退出码 ${code}${stderr ? `\n${stderr.slice(-2000)}` : ""}`));
        });
    });
}

function capture(command, args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => code === 0
            ? resolvePromise(`${stdout}${stderr}`)
            : reject(new Error(`${command} 退出码 ${code}\n${stderr.slice(-2000)}`)));
    });
}

async function download(url, target, refresh) {
    if (!refresh && existsSync(target)) return;
    await mkdir(dirname(target), { recursive: true });
    console.log(`  下载 ${url}`);
    // 部分网络环境下 Node 自带 fetch 会被重置，curl 更稳定。
    await run("curl", ["-L", "--fail", "--retry", "3", "--retry-all-errors", "-o", target, url], { quiet: true });
    if (!existsSync(target)) throw new Error(`下载失败 ${url}`);
}

function midiForNote(note, seconds = 10) {
    const match = /^([A-G]#?)(-?\d+)$/.exec(note);
    if (!match) throw new Error(`无效音名: ${note}`);
    const order = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
    const midi = (Number(match[2]) + 1) * 12 + order[match[1]];
    const division = 480;
    const ticks = Math.round(seconds * division);
    const vlq = (value) => {
        const bytes = [value & 0x7f];
        while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
        return bytes;
    };
    const events = [
        0x00, 0xc0, 0x00,
        0x00, 0x90, midi, 0x50,
        ...vlq(ticks), 0x80, midi, 0x00,
        0x00, 0xff, 0x2f, 0x00,
    ];
    const track = [
        0x4d, 0x54, 0x72, 0x6b,
        (events.length >> 24) & 255, (events.length >> 16) & 255, (events.length >> 8) & 255, events.length & 255,
        ...events,
    ];
    return Uint8Array.from([
        0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 255,
        ...track,
    ]);
}

async function prepareYdp(refresh) {
    const sf2Dir = join(CACHE, "ydp_grand");
    const sf2 = join(sf2Dir, "YDP-GrandPiano-20160804.sf2");
    if (!existsSync(sf2) || refresh) {
        const archive = join(sf2Dir, "YDP-GrandPiano-SF2-20160804.tar.bz2");
        if (!existsSync(archive) || refresh) await download(YDP_URL, archive, true);
        await mkdir(sf2Dir, { recursive: true });
        console.log("  解压 YDP SF2");
        await run("tar", ["-xjf", archive, "-C", sf2Dir]);
        const extracted = join(sf2Dir, "YDP-GrandPiano-SF2-20160804", "YDP-GrandPiano-20160804.sf2");
        if (extracted !== sf2) await copyFile(extracted, sf2);
    }
    await run(FLUIDSYNTH, ["--version"], { quiet: true }).catch(() => {
        throw new Error("未找到 fluidsynth，请安装后重试，或用 FLUIDSYNTH=/path/to/fluidsynth 指定路径");
    });
    return sf2;
}

async function renderYdpNote(sf2, note, refresh) {
    const dir = join(CACHE, "ydp_grand", "rendered");
    const target = join(dir, `${note}.wav`);
    if (!refresh && existsSync(target)) return target;
    await mkdir(dir, { recursive: true });
    const midi = join(dir, `${note}.mid`);
    await writeFile(midi, midiForNote(note));
    console.log(`  FluidSynth 渲染 ${note}`);
    await run(FLUIDSYNTH, [
        "-ni", "-F", target, "-T", "wav", "-r", "48000", "-g", "1.0",
        "-o", "synth.reverb.active=0", "-o", "synth.chorus.active=0",
        sf2, midi,
    ], { quiet: true });
    return target;
}

async function sourcePath(timbreId, note, refresh, ydpSf2) {
    const dir = join(CACHE, timbreId);
    const source = TIMBRES[timbreId].source(note);
    if (source.render === "ydp") return renderYdpNote(ydpSf2, note, refresh);
    const target = join(dir, `${note}.${source.extension}`);
    await download(source.url, target, refresh);
    return target;
}

async function maxVolumeDb(file) {
    const output = await capture(FFMPEG, ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
    const match = /max_volume:\s*(-?[\d.]+) dB/.exec(output);
    if (!match) throw new Error(`无法读取音量: ${file}`);
    return Number(match[1]);
}

async function convertTier(source, target, layer, gainDb) {
    await mkdir(dirname(target), { recursive: true });
    const { duration, fadeStart, fade } = LAYER_OPTIONS[layer];
    const filters = [
        `volume=${gainDb.toFixed(2)}dB`,
        `afade=t=out:st=${Math.min(fadeStart, duration - 0.01)}:d=${fade}`,
    ];
    await run(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", source,
        "-t", String(duration),
        "-af", filters.join(","),
        "-ar", "48000",
        "-c:a", "libvorbis", "-q:a", "2",
        "-map_metadata", "-1",
        target,
    ], { quiet: true });
}

async function buildTimbre(timbreId, refresh, ydpSf2) {
    const definition = TIMBRES[timbreId];
    if (!definition) throw new Error(`未知音色: ${timbreId}`);
    const timbre = PIANO_TIMBRES.find((t) => t.id === timbreId);
    if (!timbre) throw new Error(`@piano/core 中缺少音色定义: ${timbreId}`);
    console.log(`\n[${timbreId}] ${definition.label}`);

    const sources = new Map();
    for (const note of BASE_NOTES) {
        sources.set(note, await sourcePath(timbreId, note, refresh, ydpSf2));
    }

    const entries = [...sources.entries()];
    const peaks = await Promise.all(entries.map(([, source]) => maxVolumeDb(source)));
    const c4Index = entries.findIndex(([note]) => note === "C4");
    const reference = c4Index >= 0
        ? peaks[c4Index]
        : [...peaks].sort((a, b) => a - b)[Math.floor(peaks.length / 2)];
    const overallPeak = Math.max(...peaks);
    let gainDb = TARGET_REFERENCE_DB - reference;
    // 防止游戏内音量 2.0 时削波；同时保留各音之间的自然强弱。
    if (overallPeak + gainDb > MAX_PEAK_DB) gainDb -= overallPeak + gainDb - MAX_PEAK_DB;
    console.log(`  参考峰值 ${reference.toFixed(1)} dB / 整体峰值 ${overallPeak.toFixed(1)} dB → 增益 ${gainDb.toFixed(1)} dB`);

    for (const layer of LAYERS) {
        const dir = join(SOUNDS, pianoSoundId(timbre.value, layer));
        await rm(dir, { recursive: true, force: true });
        for (const [note, source] of sources) {
            await convertTier(source, join(dir, `${note}.ogg`), layer, gainDb);
        }
        console.log(`  ${layer} → ${dir}`);
    }
}

async function writeSoundDefinitions() {
    const definitions = {};
    for (const timbre of PIANO_TIMBRES) {
        for (const layer of LAYERS) {
            const dir = pianoSoundId(timbre.value, layer);
            if (!existsSync(join(SOUNDS, dir))) {
                throw new Error(`缺少采样目录 ${dir}，请先完整生成该音色（不带参数运行本脚本）`);
            }
            for (const note of BASE_NOTES) {
                definitions[`${dir}.${note}`] = {
                    category: "record",
                    sounds: [`sounds/${dir}/${note}`],
                    min_distance: 8,
                    max_distance: 32,
                };
            }
        }
    }
    const target = join(SOUNDS, "sound_definitions.json");
    await writeFile(target, `${JSON.stringify({ format_version: "1.26.0", sound_definitions: definitions }, null, 4)}\n`);
    console.log(`\n音效定义已写入 ${target}（${Object.keys(definitions).length} 条）`);
}

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const selected = args.filter((arg) => !arg.startsWith("--"));
const timbreIds = selected.length ? selected : Object.keys(TIMBRES);

if (timbreIds.some((id) => !TIMBRES[id])) {
    console.error(`未知音色: ${timbreIds.filter((id) => !TIMBRES[id]).join(", ")}`);
    process.exit(1);
}

// 防止 @piano/core 与生成脚本的音色清单漂移。
const configured = new Set(Object.keys(TIMBRES));
for (const timbre of PIANO_TIMBRES) {
    if (timbre.id !== "piano" && !configured.has(timbre.id)) {
        throw new Error(`@piano/core 中的音色 ${timbre.id} 缺少采样生成配置`);
    }
}
for (const id of configured) {
    if (!PIANO_TIMBRES.some((timbre) => timbre.id === id)) {
        throw new Error(`采样生成配置中的音色 ${id} 未在 @piano/core 中注册`);
    }
}

await mkdir(CACHE, { recursive: true });
const ydpSf2 = timbreIds.includes("ydp_grand") ? await prepareYdp(refresh) : undefined;
for (const timbreId of timbreIds) {
    await buildTimbre(timbreId, refresh, ydpSf2);
}
await writeSoundDefinitions();

const totalFiles = (await Promise.all(timbreIds.map(async (id) => {
    const value = PIANO_TIMBRES.find((t) => t.id === id).value;
    const counts = await Promise.all(LAYERS.map(async (layer) =>
        (await readdir(join(SOUNDS, pianoSoundId(value, layer)))).length));
    return counts.reduce((a, b) => a + b, 0);
}))).reduce((a, b) => a + b, 0);
console.log(`\n完成：${timbreIds.length} 个音色，${totalFiles} 个采样文件。`);
