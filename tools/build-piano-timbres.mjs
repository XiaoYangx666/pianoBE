/**
 * 下载并生成可切换的钢琴音色采样。
 *
 * 用法（需要 ffmpeg；SF2 音色还需要 fluidsynth）：
 *   node tools/build-piano-timbres.mjs            # 生成全部音色
 *   node tools/build-piano-timbres.mjs --analyze  # 只测量响度并写报告，不改采样
 *   CALIBRATION=off node tools/build-piano-timbres.mjs   # 关闭校准，用于 A/B
 *   node tools/build-piano-timbres.mjs --refresh  # 重新下载并覆盖全部音色
 *   node tools/build-piano-timbres.mjs upright classic_grand
 *   node tools/build-piano-timbres.mjs bright_grand   # 从本地母带重建 Salamander
 *   node tools/build-piano-timbres.mjs --definitions-only  # 只重建 sound_definitions.json
 *
 * 输出：
 *   packages/addon/rp/sounds/<音色>/{short,standard,long}/*.ogg
 *   packages/addon/rp/sounds/sound_definitions.json
 *
 * 每个采样会生成两套音效定义，共用同一批 OGG：
 *   3D（单声道、有距离衰减）：piano.C4 / piano_short.C4 / classic_grand.C4
 *   立体声（保留立体声、无定位）：piano_stereo.C4 / piano_short_stereo.C4 / classic_grand_stereo.C4
 *
 * 下载的源采样缓存在 tools/piano_timbres_source/（已 gitignore）。
 * Salamander（明亮三角）的母带不随仓库分发，放在 tools/piano_source/（同样已 gitignore）。
 * 所有音色只做两件事：整体响度对齐 + 异常键修复（保留音区自然强弱），不再要求每个键固定 LUFS。
 * 报告：tools/loudness-report.md；验证与 A/B：tools/loudness_check.py → tools/loudness-verification.md、build/loudness-ab/。
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
const WEB_PUBLIC = join(ROOT, "packages", "web", "public", "piano");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FLUIDSYNTH = process.env.FLUIDSYNTH ?? "fluidsynth";
const SEVEN_ZIP = process.env.SEVEN_ZIP ?? "7z";

const BASE_NOTES = PIANO_SAMPLE_KEYS;
const LAYERS = PIANO_SOUND_LAYERS;
const LAYER_OPTIONS = {
    short: { duration: 0.5, fadeStart: 0.25, fade: 0.25 },
    standard: { duration: 2, fadeStart: 1.4, fade: 0.6 },
    long: { duration: 4, fadeStart: 3, fade: 1 },
};

const MAX_PEAK_DB = -6;
/** 音色整体响度目标：取逐键响度的中位数对齐，不要求每个键都到目标。 */
const TIMBRE_TARGET_LUFS = -30;
/** 固定分析窗口（秒），三档音长共用同一测量结果。 */
const ANALYSIS_SECONDS = 1.2;
/** 异常键判定：与邻域环中值的偏差超过该值才处理。 */
const OUTLIER_THRESHOLD_DB = 3;
/** 单个键最多修正多少 dB（只修超出阈值的部分）。 */
const OUTLIER_MAX_CORRECTION_DB = 6;
/** 低于该响度视为该键没有采样（SF2 音域不足）。 */
const MIN_VALID_LUFS = -60;
const KW_BASE = "https://raw.githubusercontent.com/freepats/upright-piano-KW/main/samples";
const FLUIDR3_URL = "https://raw.githubusercontent.com/urish/cinto/master/media/FluidR3%20GM.sf2";
const FM_PIANO1_URL = "https://github.com/freepats/fm-piano1/releases/download/2019-09-16/FM-Piano1-SF2-20190916.7z";
const VCSL_BASE = "https://cdn.jsdelivr.net/gh/sgossner/VCSL@master/Chordophones/Zithers/Grand%20Piano,%20Steinway%20B/Sus";

const NOTE_ORDER = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const MIDI_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteToMidi(note) {
    const match = /^([A-G]#?)(-?\d+)$/.exec(note);
    if (!match) throw new Error(`无效音名: ${note}`);
    return (Number(match[2]) + 1) * 12 + NOTE_ORDER[match[1]];
}

function midiToNoteName(midi) {
    return `${MIDI_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** VCSL 施坦威 B 只按全音采样（A#0–G#7），接入时取最近的源音并变调补缺键。 */
const VCSL_MIDI = [
    22, 34, 46, 58, 70, 82, 94, // A#0–A#6
    24, 36, 48, 60, 72, 84, 96, // C1–C7
    26, 38, 50, 62, 74, 86, 98, // D1–D7
    28, 40, 52, 64, 76, 88, 100, // E1–E7
    30, 42, 54, 66, 78, 90, 102, // F#1–F#7
    32, 44, 56, 68, 80, 92, 104, // G#1–G#7
];
const VCSL_NOTES = VCSL_MIDI.map((midi) => midiToNoteName(midi));
const VCSL_VELOCITY = 3;

const TIMBRES = {
    // 标准钢琴：FluidR3 GM 的 Acoustic Grand（MIT），用 FluidSynth 渲染 program 0。
    piano: {
        label: "Standard Piano (FluidR3 GM)",
        sf2: "fluidr3",
        program: 0,
    },
    // 经典三角：VCSL 施坦威 B（CC0），全音采样。
    classic_grand: {
        label: "Classic Grand (VCSL Steinway B)",
        source: (note) => {
            const target = noteToMidi(note);
            const best = VCSL_NOTES.reduce((a, b) =>
                Math.abs(noteToMidi(b) - target) < Math.abs(noteToMidi(a) - target) ? b : a);
            return {
                url: `${VCSL_BASE}/JHPiano_Sus_Close_${best.replace("#", "%23")}_vl${VCSL_VELOCITY}_rr1.wav`,
                extension: "wav",
                cacheName: `VCSL_${best.replace("#", "s")}_vl${VCSL_VELOCITY}.wav`,
                transpose: target - noteToMidi(best),
            };
        },
    },
    // 明亮三角：Salamander Grand Piano V3（CC BY 3.0，Yamaha C5），母带不随仓库分发。
    bright_grand: {
        label: "Bright Grand (Salamander C5)",
        source: (note) => ({ local: join(ROOT, "tools", "piano_source", `${note}.ogg`) }),
    },
    // 原声立式：FreePats Upright Piano KW（CC0，Kawai 立式）。
    upright: {
        label: "Upright Piano (FreePats KW)",
        source: (note) => {
            // A2 / C4 只有低力度层，其余优先使用高力度层。
            const velocity = note === "A2" || note === "C4" ? "vL" : "vH";
            return {
                url: `${KW_BASE}/${note.replace("#", "%23")}${velocity}.flac`,
                extension: "flac",
            };
        },
    },
    // 复古电钢：FreePats FM Synthesized Piano #1（CC0，DX7 "E.Piano 1"）。
    electric_piano: {
        label: "Electric Piano (FreePats FM #1)",
        sf2: "fm_piano1",
        program: 0,
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
    await run("curl", ["-L", "--fail", "--retry", "8", "--retry-delay", "2", "--retry-all-errors", "-o", target, url], { quiet: true });
    if (!existsSync(target)) throw new Error(`下载失败 ${url}`);
}

function midiForNote(note, program = 0, seconds = 10) {
    const midi = noteToMidi(note);
    const division = 480;
    const ticks = Math.round(seconds * division);
    const vlq = (value) => {
        const bytes = [value & 0x7f];
        while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
        return bytes;
    };
    const events = [
        0x00, 0xc0, program,
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

const SF2_SOURCES = {
    fluidr3: {
        label: "FluidR3 GM",
        file: "FluidR3_GM.sf2",
        url: FLUIDR3_URL,
    },
    fm_piano1: {
        label: "FreePats FM Piano #1",
        file: "FM-Piano1.sf2",
        url: FM_PIANO1_URL,
        archive: "FM-Piano1-SF2-20190916.7z",
    },
};

async function prepareSf2(key, refresh) {
    const meta = SF2_SOURCES[key];
    if (!meta) throw new Error(`未知 SF2 音源: ${key}`);
    const dir = join(CACHE, key);
    const sf2 = join(dir, meta.file);
    if (!existsSync(sf2) || refresh) {
        await mkdir(dir, { recursive: true });
        const archive = join(dir, meta.archive ?? meta.file);
        if (!existsSync(archive) || refresh) await download(meta.url, archive, refresh);
        if (meta.archive) {
            console.log(`  解压 ${meta.label}`);
            await run(SEVEN_ZIP, ["x", "-y", `-o${dir}`, archive], { quiet: true });
        } else if (archive !== sf2) {
            await copyFile(archive, sf2);
        }
        if (!existsSync(sf2)) {
            const found = (await readdir(dir, { recursive: true }))
                .find((name) => String(name).toLowerCase().endsWith(".sf2"));
            if (!found) throw new Error(`解压后未找到 SF2: ${dir}`);
            await copyFile(join(dir, String(found)), sf2);
        }
    }
    if (!existsSync(sf2)) throw new Error(`缺少 SF2: ${sf2}`);
    await run(FLUIDSYNTH, ["--version"], { quiet: true }).catch(() => {
        throw new Error("未找到 fluidsynth，请安装后重试，或用 FLUIDSYNTH=/path/to/fluidsynth 指定路径");
    });
    return sf2;
}

async function renderSf2Note(sf2Key, sf2, note, program, refresh) {
    const dir = join(CACHE, sf2Key, "rendered");
    const target = join(dir, `${note}_p${program}.wav`);
    if (!refresh && existsSync(target)) return target;
    await mkdir(dir, { recursive: true });
    const midi = join(dir, `${note}_p${program}.mid`);
    await writeFile(midi, midiForNote(note, program));
    console.log(`  FluidSynth 渲染 ${SF2_SOURCES[sf2Key].label} ${note}`);
    await run(FLUIDSYNTH, [
        "-ni", "-F", target, "-T", "wav", "-r", "48000", "-g", "1.0",
        "-o", "synth.reverb.active=0", "-o", "synth.chorus.active=0",
        sf2, midi,
    ], { quiet: true });
    return target;
}

/** 返回源文件与构建期需要预变调的半音数（VCSL 全音采样补缺键）。 */
async function sourcePath(timbreId, note, refresh, sf2Paths) {
    const dir = join(CACHE, timbreId);
    const definition = TIMBRES[timbreId];
    if (definition.sf2) {
        const sf2 = sf2Paths[definition.sf2];
        return { file: await renderSf2Note(definition.sf2, sf2, note, definition.program, refresh), transpose: 0 };
    }
    const source = definition.source(note);
    if (source.local) {
        if (!existsSync(source.local)) {
            throw new Error(`缺少本地采样 ${source.local}。Salamander 母带不随仓库分发，请先把 30 个源采样放入 tools/piano_source/`);
        }
        return { file: source.local, transpose: 0 };
    }
    const target = join(dir, source.cacheName ?? `${note}.${source.extension}`);
    await download(source.url, target, refresh);
    return { file: target, transpose: source.transpose ?? 0 };
}

async function maxVolumeDb(file) {
    const output = await capture(FFMPEG, ["-hide_banner", "-i", file, "-t", "4", "-af", "volumedetect", "-f", "null", "-"]);
    const match = /max_volume:\s*(-?[\d.]+) dB/.exec(output);
    if (!match) throw new Error(`无法读取音量: ${file}`);
    return Number(match[1]);
}

/**
 * 固定分析窗口的积分响度。
 * 不跟随音长档：短音只看 0.5s 会把音头权重放大，长音看 4s 又会把衰减算进去，
 * 同一键在三档里会得到不同增益。统一取音头 + 早期延音 1.5s，三档共用同一个键增益。
 */
async function integratedLoudnessDb(file, seconds = ANALYSIS_SECONDS, transpose = 0) {
    const filters = [];
    if (transpose) {
        // 变调会改变频谱，K 加权响度也会跟着变；必须按实际输出的音高测量。
        const ratio = Math.pow(2, transpose / 12).toFixed(6);
        filters.push("aformat=sample_rates=48000", `asetrate=48000*${ratio}`, "aresample=48000");
    }
    filters.push("ebur128");
    const output = await capture(FFMPEG, [
        "-hide_banner", "-nostats", "-i", file,
        "-t", String(seconds),
        "-af", filters.join(","),
        "-f", "null", "-",
    ]);
    const match = /Integrated loudness:\s*I:\s*(-?[\d.]+)/.exec(output);
    if (!match) throw new Error(`无法读取响度: ${file}`);
    return Number(match[1]);
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** 3×3 线性方程组（高斯消元）。 */
function solve3(matrix, vector) {
    const a = matrix.map((row, i) => [...row, vector[i]]);
    for (let col = 0; col < 3; col++) {
        let pivot = col;
        for (let row = col + 1; row < 3; row++) {
            if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        }
        if (Math.abs(a[pivot][col]) < 1e-12) return [0, 0, 0];
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let row = 0; row < 3; row++) {
            if (row === col) continue;
            const factor = a[row][col] / a[col][col];
            for (let k = col; k < 4; k++) a[row][k] -= factor * a[col][k];
        }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * 对单个音色的逐键响度做稳健二次拟合，得到它自己的音区趋势。
 * 不与其他音色比较，也不强制统一曲线；异常键就是偏离自身趋势的键。
 */
function robustTrend(xs, ys) {
    const min = xs[0];
    const span = xs[xs.length - 1] - min || 1;
    const norm = xs.map((x) => (2 * (x - min)) / span - 1);
    const evalAt = (coef, x) => coef[0] + coef[1] * x + coef[2] * x * x;
    let weights = norm.map(() => 1);
    let coefficients = [0, 0, 0];
    for (let iteration = 0; iteration < 8; iteration++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
        for (let i = 0; i < norm.length; i++) {
            const w = weights[i];
            const x = norm[i];
            const y = ys[i];
            s0 += w; s1 += w * x; s2 += w * x * x; s3 += w * x ** 3; s4 += w * x ** 4;
            t0 += w * y; t1 += w * x * y; t2 += w * x * x * y;
        }
        coefficients = solve3([[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2]);
        const residuals = ys.map((y, i) => y - evalAt(coefficients, norm[i]));
        const mad = median(residuals.map(Math.abs)) || 1e-6;
        const scale = 1.4826 * mad;
        weights = residuals.map((r) => 1 / Math.max(Math.abs(r) / scale, 0.3));
    }
    return ys.map((y, i) => y - evalAt(coefficients, norm[i]));
}

/**
 * 保守校准：
 * 1. 音域不足的键先用最近采样变调补齐（SF2 音域之外原本是静音）；
 * 2. 整体增益：把该音色逐键响度的中位数对齐到统一目标，保留音区之间的自然强弱；
 * 3. 异常键修复：对每个音色单独做稳健趋势拟合，只修正偏离自身趋势超过阈值的部分，
 *    且最多 6 dB。缓慢的音区走向不会被压平。
 */
async function analyzeTimbre(timbreId, sources) {
    const rows = [];
    for (const note of BASE_NOTES) {
        const source = sources.get(note);
        rows.push({
            note,
            file: source.file,
            transpose: source.transpose,
            lufs: await integratedLoudnessDb(source.file, ANALYSIS_SECONDS, source.transpose ?? 0),
            peak: await maxVolumeDb(source.file),
        });
    }
    // 邻域/趋势必须按音高排序；BASE_NOTES 是按音名分组（A0…A7、C1…），直接取下标会串到别的音区。
    rows.sort((a, b) => noteToMidi(a.note) - noteToMidi(b.note));

    const valid = rows.filter((row) => row.lufs > MIN_VALID_LUFS);
    if (!valid.length) throw new Error(`${timbreId} 没有可用采样`);
    for (const row of rows) {
        if (row.lufs > MIN_VALID_LUFS) continue;
        const target = noteToMidi(row.note);
        const nearest = valid.reduce((best, candidate) =>
            Math.abs(noteToMidi(candidate.note) - target) < Math.abs(noteToMidi(best.note) - target)
                ? candidate : best);
        row.repairedFrom = nearest.note;
        row.file = nearest.file;
        row.transpose = (nearest.transpose ?? 0) + (target - noteToMidi(nearest.note));
        row.lufs = nearest.lufs;
        row.peak = nearest.peak;
    }

    const globalGain = TIMBRE_TARGET_LUFS - median(rows.map((row) => row.lufs));
    const residuals = robustTrend(rows.map((row) => noteToMidi(row.note)), rows.map((row) => row.lufs));
    rows.forEach((row, index) => {
        row.reference = row.lufs - residuals[index];
        row.residual = residuals[index];
        let correction = 0;
        if (Math.abs(row.residual) > OUTLIER_THRESHOLD_DB) {
            const excess = Math.min(
                Math.abs(row.residual) - OUTLIER_THRESHOLD_DB,
                OUTLIER_MAX_CORRECTION_DB,
            );
            correction = -Math.sign(row.residual) * excess;
        }
        row.correction = correction;
        row.gain = globalGain + correction;
        row.calibratedLufs = row.lufs + row.gain;
        row.calibratedPeak = row.peak + row.gain;
    });

    // 变调补齐的键必须与它的来源键使用同一个修正，否则同一个采样会被改成不同响度。
    for (const row of rows) {
        if (!row.repairedFrom) continue;
        const source = rows.find((candidate) => candidate.note === row.repairedFrom);
        if (!source) continue;
        row.correction = source.correction;
        row.gain = globalGain + row.correction;
        row.calibratedLufs = row.lufs + row.gain;
        row.calibratedPeak = row.peak + row.gain;
    }

    return { timbreId, globalGain, shift: 0, rows };
}

async function convertTimbre(timbreId, analysis) {
    const timbre = PIANO_TIMBRES.find((t) => t.id === timbreId);
    if (!timbre) throw new Error(`@piano/core 中缺少音色定义: ${timbreId}`);
    for (const layer of LAYERS) {
        const dir = join(SOUNDS, pianoSoundId(timbre.value, layer));
        await rm(dir, { recursive: true, force: true });
        for (const row of analysis.rows) {
            await convertTier(row.file, join(dir, `${row.note}.ogg`), layer, row.gain, row.transpose);
        }
        console.log(`  ${layer} → ${dir}`);
    }
}

function fmt(value, digits = 1) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

async function writeCalibrationReport(analyses, mode, peakShift) {
    const ordered = PIANO_TIMBRES
        .map((timbre) => analyses.find((analysis) => analysis.timbreId === timbre.id))
        .filter(Boolean);
    const jsonTarget = join(CACHE, "calibration.json");
    await writeFile(jsonTarget, `${JSON.stringify({
        mode,
        targetLufs: TIMBRE_TARGET_LUFS,
        analysisSeconds: ANALYSIS_SECONDS,
        outlierThresholdDb: OUTLIER_THRESHOLD_DB,
        outlierMaxCorrectionDb: OUTLIER_MAX_CORRECTION_DB,
        peakShiftDb: peakShift,
        timbres: ordered,
    }, null, 1)}\n`);

    const lines = [
        "# 钢琴音色响度校准报告",
        "",
        `- 生成时间：${new Date().toISOString()}`,
        `- 模式：${mode}（整体响度目标 ${TIMBRE_TARGET_LUFS} LUFS，异常键阈值 ${OUTLIER_THRESHOLD_DB} dB，单键修正上限 ${OUTLIER_MAX_CORRECTION_DB} dB）`,
        `- 分析窗口：每键固定 ${ANALYSIS_SECONDS}s（音头 + 早期延音），三档音长共用同一键增益`,
        `- 全局峰值余量调整：${fmt(peakShift)} dB（所有音色等量平移，保持相互响度关系）`,
        "",
        "## 总览",
        "",
        "| 音色 | 整体增益 | 修正键数 | 校准前中位 | 校准后中位 | 原始最差偏差 | 预计最大峰值 |",
        "|---|---|---|---|---|---|---|",
    ];
    for (const analysis of ordered) {
        const corrected = analysis.rows.filter((row) => Math.abs(row.correction) > 0.05);
        const before = median(analysis.rows.map((row) => row.lufs));
        const after = median(analysis.rows.map((row) => row.calibratedLufs));
        const worst = Math.max(...analysis.rows.map((row) => Math.abs(row.residual)));
        const peak = Math.max(...analysis.rows.map((row) => row.calibratedPeak));
        const label = PIANO_TIMBRES.find((timbre) => timbre.id === analysis.timbreId)?.label ?? analysis.timbreId;
        lines.push(`| ${label} | ${fmt(analysis.globalGain)} dB | ${corrected.length} | ${before.toFixed(1)} LUFS | ${after.toFixed(1)} LUFS | ${worst.toFixed(1)} dB | ${peak.toFixed(1)} dBFS |`);
    }
    lines.push("");
    for (const analysis of ordered) {
        const label = PIANO_TIMBRES.find((timbre) => timbre.id === analysis.timbreId)?.label ?? analysis.timbreId;
        lines.push(`## ${label}（${analysis.timbreId}）`, "");
        lines.push("| 键 | 源响度 | 邻域参考 | 偏差 | 异常修正 | 实际增益 | 校准后响度 | 校准后峰值 |");
        lines.push("|---|---|---|---|---|---|---|---|");
        for (const row of analysis.rows) {
            const flag = Math.abs(row.correction) > 0.05 ? "**" : "";
            const note = row.repairedFrom ? `${flag}${row.note}${flag} †` : `${flag}${row.note}${flag}`;
            lines.push(`| ${note} | ${row.lufs.toFixed(1)} | ${row.reference.toFixed(1)} | ${fmt(row.residual)} | ${fmt(row.correction)} | ${fmt(row.gain)} | ${row.calibratedLufs.toFixed(1)} | ${row.calibratedPeak.toFixed(1)} |`);
        }
        if (analysis.rows.some((row) => row.repairedFrom)) {
            lines.push("", "† = 源音色在该键没有采样，使用最近键变调补齐（与来源键共用同一增益）。");
        }
        lines.push("");
    }
    const mdTarget = join(ROOT, "tools", "loudness-report.md");
    await writeFile(mdTarget, `${lines.join("\n")}\n`);
    console.log(`\n校准报告：${mdTarget}`);
    console.log(`校准数据：${jsonTarget}`);
}

async function convertTier(source, target, layer, gainDb, transpose = 0) {
    await mkdir(dirname(target), { recursive: true });
    const { duration, fadeStart, fade } = LAYER_OPTIONS[layer];
    const filters = [];
    if (transpose) {
        // 构建期把源音变调到目标键（VCSL 全音采样 → 本项目的每 3 半音基准键）。
        const ratio = Math.pow(2, transpose / 12).toFixed(6);
        filters.push("aformat=sample_rates=48000", `asetrate=48000*${ratio}`, "aresample=48000");
    }
    filters.push(
        `volume=${gainDb.toFixed(2)}dB`,
        `afade=t=out:st=${Math.min(fadeStart, duration - 0.01)}:d=${fade}`,
    );
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

/** web 试听页只内嵌默认音色（标准钢琴），保持副本与资源包一致（文件名 # → sharp）。 */
async function syncWebPreview() {
    for (const layer of LAYERS) {
        const dir = pianoSoundId(0, layer);
        const targetDir = join(WEB_PUBLIC, dir);
        await mkdir(targetDir, { recursive: true });
        for (const note of BASE_NOTES) {
            await copyFile(join(SOUNDS, dir, `${note}.ogg`), join(targetDir, `${note.replace("#", "sharp")}.ogg`));
        }
    }
    console.log(`\nWeb 试听采样已同步 ${WEB_PUBLIC}`);
}

async function writeSoundDefinitions() {
    const definitions = {};
    for (const timbre of PIANO_TIMBRES) {
        for (const layer of LAYERS) {
            const dir = pianoSoundId(timbre.value, layer);
            if (!existsSync(join(SOUNDS, dir))) {
                throw new Error(`缺少采样目录 ${dir}，请先完整生成该音色（不带参数运行本脚本）`);
            }
            const stereoDir = pianoSoundId(timbre.value, layer, true);
            for (const note of BASE_NOTES) {
                const sound = `sounds/${dir}/${note}`;
                // 3D：单声道，保留定位与距离衰减。
                definitions[`${dir}.${note}`] = {
                    category: "record",
                    sounds: [{ name: sound, is3D: true }],
                    min_distance: 8,
                    max_distance: 32,
                };
                // 立体声：保留立体声采样，交给游戏做普通 2D 播放。
                definitions[`${stereoDir}.${note}`] = {
                    category: "record",
                    sounds: [{ name: sound, is3D: false }],
                };
            }
        }
    }
    const target = join(SOUNDS, "sound_definitions.json");
    // Bedrock 要求 min_distance / max_distance 是浮点数；JSON.stringify 会把 8.0 写成 8，
    // 整数会被静默忽略，所以在文本层补上小数点。
    const json = JSON.stringify({ format_version: "1.26.0", sound_definitions: definitions }, null, 4)
        .replace(/"min_distance": (-?\d+)(?![\d.])/g, '"min_distance": $1.0')
        .replace(/"max_distance": (-?\d+)(?![\d.])/g, '"max_distance": $1.0');
    await writeFile(target, `${json}\n`);
    console.log(`\n音效定义已写入 ${target}（${Object.keys(definitions).length} 条：3D + 立体声各一套）`);
}

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const definitionsOnly = args.includes("--definitions-only");
const analyzeOnly = args.includes("--analyze");
const selected = args.filter((arg) => !arg.startsWith("--"));
let timbreIds = selected.length ? selected : Object.keys(TIMBRES);

if (timbreIds.some((id) => !TIMBRES[id])) {
    console.error(`未知音色: ${timbreIds.filter((id) => !TIMBRES[id]).join(", ")}`);
    process.exit(1);
}

// 防止 @piano/core 与生成脚本的音色清单漂移。
const configured = new Set(Object.keys(TIMBRES));
for (const timbre of PIANO_TIMBRES) {
    if (!configured.has(timbre.id)) {
        throw new Error(`@piano/core 中的音色 ${timbre.id} 缺少采样生成配置`);
    }
}
for (const id of configured) {
    if (!PIANO_TIMBRES.some((timbre) => timbre.id === id)) {
        throw new Error(`采样生成配置中的音色 ${id} 未在 @piano/core 中注册`);
    }
}

// 默认构建时，Salamander 母带不在仓库里就跳过；显式点名时仍会报错提示。
if (!selected.length) {
    timbreIds = timbreIds.filter((id) => {
        const definition = TIMBRES[id];
        if (!definition.source) return true;
        const first = definition.source("A0");
        if (!first.local) return true;
        const missing = BASE_NOTES.filter((note) => !existsSync(definition.source(note).local));
        if (missing.length) {
            console.warn(`\n跳过 ${id}：缺少 ${missing.length} 个本地母带（tools/piano_source/）`);
        }
        return missing.length === 0;
    });
}

// 只重建音效定义时不需要采样源、ffmpeg 或 fluidsynth，直接复用现有目录。
if (definitionsOnly) {
    await writeSoundDefinitions();
    process.exit(0);
}

await mkdir(CACHE, { recursive: true });
const sf2Keys = [...new Set(timbreIds.map((id) => TIMBRES[id].sf2).filter(Boolean))];
const sf2Paths = {};
for (const key of sf2Keys) sf2Paths[key] = await prepareSf2(key, refresh);

// 先解析全部采样源，再统一分析：只有拿到全部音色的测量值，才能决定等量的峰值余量平移。
const sourcesByTimbre = new Map();
for (const timbreId of timbreIds) {
    console.log(`\n[${timbreId}] ${TIMBRES[timbreId].label}`);
    const sources = new Map();
    for (const note of BASE_NOTES) {
        sources.set(note, await sourcePath(timbreId, note, refresh, sf2Paths));
    }
    sourcesByTimbre.set(timbreId, sources);
}

const calibrationMode = process.env.CALIBRATION === "off" ? "off" : "auto";
const analyses = [];
for (const [timbreId, sources] of sourcesByTimbre) {
    const analysis = await analyzeTimbre(timbreId, sources);
    if (calibrationMode === "off") {
        for (const row of analysis.rows) {
            row.correction = 0;
            row.gain = 0;
            row.calibratedLufs = row.lufs;
            row.calibratedPeak = row.peak;
        }
        analysis.globalGain = 0;
    }
    analyses.push(analysis);
    console.log(`  分析完成：整体增益 ${fmt(analysis.globalGain)} dB，修正 ${analysis.rows.filter((row) => Math.abs(row.correction) > 0.05).length} 个键`);
}

// 峰值保护只做全局等量平移，避免再次引入逐键响度失真。
let peakShift = 0;
if (calibrationMode !== "off") {
    const excess = Math.max(0, ...analyses.flatMap((analysis) =>
        analysis.rows.map((row) => row.peak + row.gain - MAX_PEAK_DB)));
    if (excess > 0) {
        peakShift = -excess;
        for (const analysis of analyses) {
            analysis.shift = peakShift;
            for (const row of analysis.rows) {
                row.gain += peakShift;
                row.calibratedLufs += peakShift;
                row.calibratedPeak += peakShift;
            }
        }
        console.log(`\n峰值保护：全部音色等量平移 ${fmt(peakShift)} dB`);
    }
}

await writeCalibrationReport(analyses, calibrationMode, peakShift);
if (analyzeOnly) {
    console.log("\n仅分析模式，未写入采样。");
    process.exit(0);
}

for (const analysis of analyses) {
    console.log(`\n[${analysis.timbreId}] ${TIMBRES[analysis.timbreId].label}`);
    await convertTimbre(analysis.timbreId, analysis);
}
if (timbreIds.includes("piano")) await syncWebPreview();

// 清掉已下线的音色目录（旧版本的 meta_piano / upright_kw / ydp_grand 等）。
const expectedDirs = new Set(LAYERS.flatMap((layer) =>
    PIANO_TIMBRES.map((timbre) => pianoSoundId(timbre.value, layer))));
for (const entry of await readdir(SOUNDS, { withFileTypes: true })) {
    if (entry.isDirectory() && !expectedDirs.has(entry.name)) {
        await rm(join(SOUNDS, entry.name), { recursive: true, force: true });
        console.log(`移除旧音色目录 ${entry.name}`);
    }
}

await writeSoundDefinitions();

const totalFiles = (await Promise.all(timbreIds.map(async (id) => {
    const value = PIANO_TIMBRES.find((t) => t.id === id).value;
    const counts = await Promise.all(LAYERS.map(async (layer) =>
        (await readdir(join(SOUNDS, pianoSoundId(value, layer)))).length));
    return counts.reduce((a, b) => a + b, 0);
}))).reduce((a, b) => a + b, 0);
console.log(`\n完成：${timbreIds.length} 个音色，${totalFiles} 个采样文件。`);
