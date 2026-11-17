/**
 * Audio Lab 实验素材构建（不属于正式音色包）。
 *
 * 目标：为浏览器 Audio Lab 准备一套真实多力度采样（VCSL Steinway B，CC0）。
 * 现有正式音色 classic_grand 只取 vl3；VCSL 源实际提供 vl2/vl3/vl4 三层力度。
 *
 * 用法（仓库根目录）：
 *   node tools/build-audio-lab-assets.mjs            # 下载 + 转码 + 生成清单
 *   node tools/build-audio-lab-assets.mjs --refresh  # 忽略缓存重新下载
 *
 * 输出：
 *   packages/web/public/lab/vcsl/<层>/<基础键>.ogg   （30 键 × 3 层）
 *   packages/web/public/lab/vcsl/manifest.json
 *
 * 原始 WAV 缓存在 tools/audio_lab_source/（gitignore），构建后可删除。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FFMPEG = process.env.FFMPEG || "D:\\ffmpeg\\bin\\ffmpeg.exe";
const CALIBRATION = join(ROOT, "tools", "piano_timbres_source", "calibration.json");
const CACHE = join(ROOT, "tools", "audio_lab_source", "vcsl");
const OUT = join(ROOT, "packages", "web", "public", "lab", "vcsl");
const VCSL_BASE =
    "https://raw.githubusercontent.com/sgossner/VCSL/master/Chordophones/Zithers/Grand%20Piano,%20Steinway%20B/Sus";
const LAYERS = [
    { id: "vl2", label: "弱力度", description: "VCSL vl2 · 轻触键" },
    { id: "vl3", label: "中力度", description: "VCSL vl3 · 正式音色使用的层" },
    { id: "vl4", label: "强力度", description: "VCSL vl4 · 重击键" },
];
const SAMPLE_SECONDS = 4.0;
const FADE_START = 3.5;
const FADE_SECONDS = 0.5;
const SAMPLE_RATE = 44100;

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

function run(command, args, quiet = true) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
        let stderr = "";
        child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
            if (!quiet) process.stderr.write(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolvePromise(stderr);
            else reject(new Error(`${command} 退出码 ${code}\n${stderr.slice(-3000)}`));
        });
    });
}

async function download(url, target, refresh) {
    if (!refresh && existsSync(target)) return;
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.part`;
    await run("curl", ["-L", "--fail", "--retry", "6", "--retry-delay", "2", "--retry-all-errors", "-o", temp, url]);
    await rm(target, { force: true });
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            await rename(temp, target);
            return;
        } catch (error) {
            if (attempt === 5) throw error;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        }
    }
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (true) {
                const index = next++;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        })
    );
    return results;
}

async function measure(file, seconds = 1.2) {
    const stderr = await run(FFMPEG, [
        "-hide_banner", "-nostats", "-i", file,
        "-t", String(seconds),
        "-af", "ebur128=peak=true",
        "-f", "null", "-",
    ]);
    const integrated = [...stderr.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].map((m) => Number(m[1]));
    const peaks = [...stderr.matchAll(/Peak:\s*(-?[\d.]+) dBFS/g)].map((m) => Number(m[1]));
    return {
        lufs: integrated.at(-1) ?? null,
        peak: peaks.at(-1) ?? null,
    };
}

async function transcode(source, target, transpose = 0) {
    await mkdir(dirname(target), { recursive: true });
    const filters = [];
    if (transpose) {
        // VCSL 是全音采样；先按目标基础键变调，否则 A0/D#1 这类键会整体高/低一个半音。
        const ratio = Math.pow(2, transpose / 12).toFixed(6);
        filters.push("aformat=sample_rates=48000", `asetrate=48000*${ratio}`, "aresample=48000");
    }
    filters.push(`afade=t=out:st=${FADE_START}:d=${FADE_SECONDS}`);
    await run(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", source,
        "-t", String(SAMPLE_SECONDS),
        "-af", filters.join(","),
        "-ar", String(SAMPLE_RATE), "-ac", "2",
        "-c:a", "libvorbis", "-q:a", "4",
        "-map_metadata", "-1",
        target,
    ]);
}

async function main() {
    const refresh = process.argv.includes("--refresh");
    const calibration = JSON.parse(await readFile(CALIBRATION, "utf8"));
    const timbre = calibration.timbres.find((entry) => entry.timbreId === "classic_grand");
    if (!timbre) throw new Error("calibration.json 缺少 classic_grand");
    const rows = timbre.rows;

    const jobs = [];
    for (const row of rows) {
        const key = row.note;
        const keyMidi = noteToMidi(key);
        const sourceMidi = keyMidi - (row.transpose ?? 0);
        const sourceNote = midiToNoteName(sourceMidi);
        for (const layer of LAYERS) {
            const url = `${VCSL_BASE}/JHPiano_Sus_Close_${sourceNote.replace("#", "%23")}_${layer.id}_rr1.wav`;
            const cacheName = `VCSL_${sourceNote.replace("#", "s")}_${layer.id}.wav`;
            jobs.push({
                key,
                layer: layer.id,
                sourceNote,
                transpose: row.transpose ?? 0,
                baseGain: row.gain,
                url,
                cacheFile: join(CACHE, cacheName),
                outFile: join(OUT, layer.id, `${key.replace("#", "sharp")}.ogg`),
            });
        }
    }

    console.log(`准备 ${jobs.length} 个采样（${rows.length} 键 × ${LAYERS.length} 层）…`);
    let done = 0;
    await mapLimit(jobs, 4, async (job) => {
        await download(job.url, job.cacheFile, refresh);
        await transcode(job.cacheFile, job.outFile, job.transpose);
        done++;
        if (done % 10 === 0 || done === jobs.length) console.log(`  转码 ${done}/${jobs.length}`);
    });

    console.log("测量响度…");
    const manifest = {
        generatedAt: new Date().toISOString(),
        source: "VCSL — Grand Piano, Steinway B (Close, Sus, CC0)",
        sourceUrl: "https://github.com/sgossner/VCSL",
        sampleSeconds: SAMPLE_SECONDS,
        sampleRate: SAMPLE_RATE,
        referenceVelocity: 90,
        layers: LAYERS,
        keys: {},
        totals: { files: 0, bytes: 0 },
    };

    const files = await readdir(OUT, { withFileTypes: true });
    manifest.totals.files = 0;
    for (const dirent of files) {
        if (!dirent.isDirectory()) continue;
        manifest.totals.files += (await readdir(join(OUT, dirent.name))).length;
    }

    for (const row of rows) {
        const key = row.note;
        const entry = { sourceNote: null, transpose: row.transpose ?? 0, baseGain: row.gain, layers: {} };
        for (const job of jobs.filter((item) => item.key === key)) {
            entry.sourceNote = job.sourceNote;
            const measured = await measure(job.outFile);
            entry.layers[job.layer] = {
                file: `${job.layer}/${key.replace("#", "sharp")}.ogg`,
                lufs: measured.lufs,
                peak: measured.peak,
            };
            manifest.totals.bytes += (await readFile(job.outFile)).byteLength;
        }
        const mid = Number(entry.layers.vl3?.lufs);
        for (const layer of LAYERS) {
            const value = Number(entry.layers[layer.id]?.lufs);
            if (Number.isFinite(mid) && Number.isFinite(value)) {
                // 让三层的整体响度一致，切换力度层时只剩音色/音头差异。
                entry.layers[layer.id].levelOffset = Number((mid - value).toFixed(3));
            }
        }
        manifest.keys[key] = entry;
    }

    manifest.totals.bytes = Number((manifest.totals.bytes / 1024 / 1024).toFixed(2));
    await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const digest = createHash("sha1").update(JSON.stringify(manifest.keys)).digest("hex").slice(0, 10);
    console.log(`完成：${manifest.totals.files} 个文件，${manifest.totals.bytes} MB，清单指纹 ${digest}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
