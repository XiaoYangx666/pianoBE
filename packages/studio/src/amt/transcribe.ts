import * as ort from "onnxruntime-web-external";
import { computeCqt, type CqtMeta } from "./cqt";
import { decodeNotes, notesToMidi, type AmtNote } from "./notes";

/**
 * 浏览器端音频转 MIDI：与 AMT 参考实现的推理链路一致（CQT → ONNX → 音符解码）。
 * 音频解码 / CQT / ONNX / 音符解码全部在本地完成，音频不会上传。
 */

export type TranscribeStage = "decode" | "model" | "cqt" | "infer" | "notes" | "done";

export interface TranscribeProgress {
    stage: TranscribeStage;
    message: string;
    /** 0..100 */
    percent: number;
}

export interface TranscribeOptions {
    /** 低负载：限制线程数并在推理分块之间让出主线程 */
    lowLoad?: boolean;
    /** 推理分块帧数；默认低负载 1024，全速 2048 */
    chunk?: number;
    /** 取消信号；在 CQT 八度和推理分块之间检查 */
    signal?: AbortSignal;
    onProgress?: (progress: TranscribeProgress) => void;
}

export interface TranscribeOutput {
    midi: Uint8Array;
    notes: AmtNote[];
    /** 音频时长（秒） */
    duration: number;
    /** 实际使用的后端（浏览器端使用多线程 WASM） */
    backend: "wasm";
}

const TARGET_SAMPLE_RATE = 16_000;
const AMT_BASE_URL = new URL("amt/", document.baseURI).href;
declare const __PIANOBE_AMT_ASSETS__: Record<string, { hash: string; size: number }>;

const CACHE_NAME = "piano-amt-v2";

export class AssetsNotReadyError extends Error {}

export interface AssetDownloadProgress {
    message: string;
    loaded: number;
    total: number;
    percent: number;
}

function asset(name: string, label: string, contentType: string) {
    const { hash, size } = __PIANOBE_AMT_ASSETS__[name];
    return {
        url: new URL(`v/${hash}/${name}`, AMT_BASE_URL).href,
        legacyUrl: new URL(name, AMT_BASE_URL).href,
        label,
        contentType,
        hash,
        size,
    };
}

const META = asset("cqt_meta.json", "频谱参数", "application/json");
const MODEL = asset("run4_int8.onnx", "转录模型", "application/octet-stream");
const WASM = asset("ort-wasm-simd-threaded.wasm", "推理运行时", "application/wasm");
const MJS = asset("ort-wasm-simd-threaded.mjs", "运行时加载器", "text/javascript");
const ASSET_FILES = [META, MODEL, WASM, MJS];

function report(
    options: TranscribeOptions,
    stage: TranscribeStage,
    message: string,
    percent: number
) {
    options.onProgress?.({ stage, message, percent: Math.max(0, Math.min(100, percent)) });
}

async function openAssetCache(): Promise<Cache> {
    if (!globalThis.caches) {
        throw new Error("当前环境不支持浏览器缓存，请使用 HTTPS 或 localhost 访问");
    }
    return caches.open(CACHE_NAME);
}

async function readCached(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
        const cache = await openAssetCache();
        const response = await cache.match(url);
        if (!response) return null;
        return new Uint8Array(await response.arrayBuffer());
    } catch {
        return null;
    }
}

async function requireCached(url: string, label: string): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = await readCached(url);
    if (!bytes) {
        throw new AssetsNotReadyError(`尚未下载${label}，请先点击「下载模型」`);
    }
    return bytes;
}

/** 模型/运行时是否已完整下载到浏览器缓存（不会触发网络请求） */
export async function isModelDownloaded(): Promise<boolean> {
    try {
        const cache = await openAssetCache();
        const hits = await Promise.all(ASSET_FILES.map((file) => cache.match(file.url)));
        return hits.every(Boolean);
    } catch {
        return false;
    }
}

/** 手动下载模型与推理运行时到 Cache Storage；已缓存的文件会跳过 */
export async function downloadModelAssets(
    onProgress?: (progress: AssetDownloadProgress) => void
): Promise<void> {
    const cache = await openAssetCache();

    const total = ASSET_FILES.reduce((sum, file) => sum + file.size, 0);
    const received = ASSET_FILES.map(() => 0);
    const update = (message: string, finished = false) => {
        const loaded = received.reduce((sum, size) => sum + size, 0);
        onProgress?.({
            message,
            loaded,
            total,
            percent: finished ? 100 : Math.min(99, (loaded / total) * 100),
        });
    };

    update("正在准备转录资源…");
    const results = await Promise.allSettled(ASSET_FILES.map(async (file, index) => {
        if (!(await cache.match(file.url))) {
            const legacy = await cache.match(file.legacyUrl);
            let bytes = legacy && new Uint8Array(await legacy.arrayBuffer());
            if (bytes?.byteLength === file.size) {
                const digest = await crypto.subtle.digest("SHA-256", bytes);
                const hash = Array.from(new Uint8Array(digest), (value) =>
                    value.toString(16).padStart(2, "0"),
                ).join("");
                if (hash !== file.hash) bytes = undefined;
            } else {
                bytes = undefined;
            }

            if (!bytes) {
                const response = await fetch(file.url);
                if (!response.ok) {
                    throw new Error(`下载${file.label}失败（HTTP ${response.status}）`);
                }
                if (!response.body) {
                    bytes = new Uint8Array(await response.arrayBuffer());
                } else {
                    const reader = response.body.getReader();
                    bytes = new Uint8Array(file.size);
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (received[index] + value.byteLength > file.size) {
                            await reader.cancel();
                            throw new Error(`${file.label}大小与发布清单不符`);
                        }
                        bytes.set(value, received[index]);
                        received[index] += value.byteLength;
                        update("正在并行下载转录资源…");
                    }
                    if (received[index] !== file.size) {
                        throw new Error(`${file.label}下载不完整`);
                    }
                }
            }
            if (bytes.byteLength !== file.size) {
                throw new Error(`${file.label}大小与发布清单不符`);
            }
            await cache.put(
                file.url,
                new Response(bytes, { headers: { "content-type": file.contentType } }),
            );
            if (legacy) await cache.delete(file.legacyUrl);
        }
        received[index] = file.size;
        update("正在准备转录资源…");
    }));
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    update("转录资源下载完成", true);
}

/** 清除已下载的模型与运行时，并释放当前推理 session */
export async function clearModelAssets(): Promise<void> {
    try {
        const cache = await openAssetCache();
        for (const request of await cache.keys()) {
            if (request.url.startsWith(AMT_BASE_URL)) await cache.delete(request);
        }
    } catch {
        // 缓存不可用时无需处理
    }
    releaseAmtSession();
}

let disposeTimer: number | null = null;
let activeJobs = 0;

/** 释放内存中的 ONNX session / WASM / 加载器（保留 Cache Storage，下次可直接重新创建） */
export function releaseAmtSession(): void {
    if (activeJobs > 0) return;
    if (disposeTimer) {
        clearTimeout(disposeTimer);
        disposeTimer = null;
    }
    if (sessionPromise) {
        const previous = sessionPromise;
        sessionPromise = null;
        sessionKey = "";
        void previous
            .then(({ session }) => session.release())
            .catch(() => {});
    }
    ort.env.wasm.wasmBinary = undefined;
    if (mjsBlobUrl) {
        URL.revokeObjectURL(mjsBlobUrl);
        mjsBlobUrl = null;
    }
}

/** 离开页面后延迟卸载模型；缓存仍在，回来时重新初始化即可 */
export function scheduleAmtSessionDispose(delayMs = 60_000): void {
    if (typeof window === "undefined") return;
    if (disposeTimer) clearTimeout(disposeTimer);
    disposeTimer = window.setTimeout(() => {
        disposeTimer = null;
        releaseAmtSession();
    }, delayMs);
}

export function cancelAmtSessionDispose(): void {
    if (!disposeTimer) return;
    clearTimeout(disposeTimer);
    disposeTimer = null;
}

/** 解码为 16 kHz 单声道 Float32（与 web_demo 一致：多声道求平均） */
async function decodeAudio(file: File): Promise<Float32Array> {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("当前浏览器不支持 Web Audio");

    const context = new AudioContextCtor();
    try {
        let decoded: AudioBuffer;
        try {
            decoded = await context.decodeAudioData(arrayBuffer);
        } catch {
            throw new Error("无法解码音频，请确认文件格式正确且未损坏");
        }
        const channels = decoded.numberOfChannels;
        const length = decoded.length;
        const mono = new Float32Array(length);
        for (let channel = 0; channel < channels; channel++) {
            const data = decoded.getChannelData(channel);
            for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
        }
        if (decoded.sampleRate === TARGET_SAMPLE_RATE) return mono;

        const outputLength = Math.ceil((length * TARGET_SAMPLE_RATE) / decoded.sampleRate);
        const offline = new OfflineAudioContext(1, outputLength, TARGET_SAMPLE_RATE);
        const source = offline.createBufferSource();
        const buffer = offline.createBuffer(1, length, decoded.sampleRate);
        buffer.copyToChannel(mono, 0);
        source.buffer = buffer;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        return rendered.getChannelData(0).slice();
    } finally {
        await context.close().catch(() => {});
    }
}

async function loadCqtMeta(): Promise<CqtMeta> {
    const bytes = await requireCached(META.url, "频谱参数");
    return JSON.parse(new TextDecoder().decode(bytes)) as CqtMeta;
}

let mjsBlobUrl: string | null = null;

async function getRuntimeLoaderUrl(): Promise<string> {
    if (mjsBlobUrl) return mjsBlobUrl;
    const bytes = await requireCached(MJS.url, "推理运行时");
    mjsBlobUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "text/javascript" }));
    return mjsBlobUrl;
}

let sessionPromise: Promise<{ session: ort.InferenceSession; backend: "wasm" }> | null = null;
let sessionKey = "";

async function getSession(
    threads: number,
    options: TranscribeOptions
): Promise<{ session: ort.InferenceSession; backend: "wasm" }> {
    const key = `${threads}`;
    if (sessionPromise && sessionKey === key) {
        report(options, "model", "模型已就绪", 15);
        return sessionPromise;
    }
    // 线程配置变化（切换低负载）时释放旧 session，避免重复占用内存
    if (sessionPromise) {
        const previous = sessionPromise;
        void previous
            .then(({ session }) => session.release())
            .catch(() => {});
    }

    sessionKey = key;
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.proxy = false;

    report(options, "model", "加载本地模型…", 5);
    const model = await requireCached(MODEL.url, "转录模型");
    const wasm = await requireCached(WASM.url, "推理运行时");
    const mjs = await getRuntimeLoaderUrl();
    // wasm 直接来自 Cache Storage；mjs 用 blob URL，避免运行时再次联网
    ort.env.wasm.wasmBinary = wasm;
    ort.env.wasm.wasmPaths = { mjs };

    sessionPromise = (async () => {
        report(options, "model", "初始化推理引擎…", 12);
        const session = await ort.InferenceSession.create(model, {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
        });
        return { session, backend: "wasm" as const };
    })();

    try {
        return await sessionPromise;
    } catch (error) {
        sessionPromise = null;
        sessionKey = "";
        throw error;
    }
}

function sigmoid(value: number): number {
    return 1 / (1 + Math.exp(-value));
}

export async function transcribeAudio(
    file: File,
    options: TranscribeOptions = {}
): Promise<TranscribeOutput> {
    activeJobs++;
    try {
        const lowLoad = options.lowLoad ?? true;
        const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        const chunk = Math.max(128, options.chunk ?? (lowLoad ? 1024 : mobile ? 512 : 2048));
        const context = chunk >= 2048 ? 64 : 256;
        const threads = lowLoad
            ? 2
            : Math.max(1, Math.min(8, navigator.hardwareConcurrency || 1));
        const effectiveThreads = globalThis.crossOriginIsolated ? threads : 1;
        const throwIfAborted = () => {
            if (options.signal?.aborted) throw new DOMException("转换已取消", "AbortError");
        };

        throwIfAborted();
        report(options, "decode", "解码音频…", 2);
        const audio = await decodeAudio(file);
        const duration = audio.length / TARGET_SAMPLE_RATE;
        if (audio.length === 0) throw new Error("音频为空或无法解码");

        throwIfAborted();
        const meta = await loadCqtMeta();
        const { session, backend } = await getSession(effectiveThreads, options);
        throwIfAborted();

        report(options, "cqt", "计算频谱（CQT）…", 15);
        const { cqt, frames } = computeCqt(
            audio,
            meta,
            (done, total) => {
                report(options, "cqt", `计算频谱（CQT）… ${done}/${total}`, 15 + (done / total) * 25);
            },
            () => Boolean(options.signal?.aborted)
        );
        throwIfAborted();

        report(options, "infer", "转录音符…", 40);
        const nBins = meta.n_bins;
        const frame = new Float32Array(nBins * frames);
        const onset = new Float32Array(nBins * frames);
        let backendReported = false;

        for (let start = 0; start < frames; start += chunk) {
            throwIfAborted();
            const end = Math.min(frames, start + chunk);
            const from = Math.max(0, start - context);
            const to = Math.min(frames, end + context);
            const length = to - from;
            const input = new Float32Array(nBins * length);
            for (let row = 0; row < nBins; row++) {
                input.set(cqt.subarray(row * frames + from, row * frames + from + length), row * length);
            }
            const output = await session.run({
                cqt: new ort.Tensor("float32", input, [1, nBins, length]),
            });
            const frameLogits = output.frame_logits.data as Float32Array;
            const onsetLogits = output.onset_logits.data as Float32Array;
            for (let row = 0; row < nBins; row++) {
                const dst = row * frames;
                const src = row * length;
                for (let column = start; column < end; column++) {
                    const index = src + (column - from);
                    frame[dst + column] = sigmoid(frameLogits[index]);
                    onset[dst + column] = sigmoid(onsetLogits[index]);
                }
            }
            if (!backendReported) {
                report(options, "infer", "转录音符（多线程 WASM）…", 40 + (end / frames) * 55);
                backendReported = true;
            } else {
                report(options, "infer", "转录音符…", 40 + (end / frames) * 55);
            }
            if (lowLoad) await new Promise((resolve) => setTimeout(resolve, 20));
        }

        throwIfAborted();
        report(options, "notes", "整理音符与 MIDI…", 97);
        const notes = decodeNotes(frame, onset, meta, frames);
        const midi = notesToMidi(notes);
        report(options, "done", `转换完成：${notes.length.toLocaleString()} 个音符`, 100);
        return { midi, notes, duration, backend };
    } finally {
        activeJobs--;
    }
}
