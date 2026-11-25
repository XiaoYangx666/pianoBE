import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    encodeBase64Url,
    encodeSong,
    planImportChunks,
    readPbe3Header,
    type MidiSongMeta,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import type { SqliteSongPort } from "../drivers/sqlitePorts.js";
import type { TokenInfo } from "../auth.js";
import type { ServerConfig } from "../config.js";
import {
    AmtAbortedError,
    AmtBusyError,
    AmtTimeoutError,
    AmtUnavailableError,
    type AmtService,
} from "./amt.js";
import { BiliError, downloadBiliAudio, resolveBiliVideo } from "./bilibili.js";

/**
 * 音频转 MIDI 任务：转录结果先留在临时任务里（原音频 + MIDI），
 * 由用户在管理页试听、改名、生成导入码后再显式保存进曲目库。
 * 任务默认 30 分钟后清理。
 */

export type TranscribeJobStage =
    | "queued"
    | "downloading"
    | "analyzing"
    | "transcribing"
    | "finalizing"
    | "done"
    | "error";

export type TranscribeJobSource =
    | { kind: "upload"; fileName?: string }
    | {
          kind: "bilibili";
          bvid: string;
          cid: number;
          title: string;
          page: number;
          pageCount: number;
          quality: string;
          codecs: string;
          bandwidth: number;
      };

export interface TranscribeJobSnapshot {
    id: string;
    stage: TranscribeJobStage;
    message: string;
    /** 0-100；-1 表示无法估算（前端显示不确定进度） */
    percent: number;
    /** 已解码到的音频时间（秒） */
    audioTime?: number;
    /** 音频总时长（秒）；未知时缺省 */
    durationSec?: number;
    noteCount: number;
    /** 转录结果时长（已按 TIME_SCALE 缩放） */
    midiDuration?: number;
    /** 转录结果 .mid 字节数 */
    dataSize?: number;
    elapsedMs: number;
    name: string;
    source: TranscribeJobSource;
    createdAt: number;
    updatedAt: number;
    audioReady: boolean;
    midiReady: boolean;
    error?: string;
    savedSong?: MidiSongMeta & { noteCount?: number; dataSize?: number };
}

interface TranscribeJob extends TranscribeJobSnapshot {
    /** 发起任务的令牌 id；任务接口按 owner 或 admin 校验 */
    ownerId?: number;
    dir: string;
    audioPath?: string;
    audioMime?: string;
    midi?: Uint8Array<ArrayBuffer>;
    transcribeMs?: number;
    finishedAt?: number;
    listeners: Set<(snapshot: TranscribeJobSnapshot) => void>;
    codeCache?: { name: string; chunks: string[]; bytes: number };
}

export interface TranscribeJobDeps {
    songPort: SqliteSongPort;
    config: ServerConfig;
    amt?: AmtService;
}

const JOB_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TEMP_PREFIXES = ["pianobe-job-", "pianobe-amt-"] as const;

/** 清理进程崩溃/重启留下的临时目录；只删超过 maxAgeMs 的，避免误删并发实例。 */
export function sweepTranscribeTempDirs(maxAgeMs: number): void {
    const root = tmpdir();
    const cutoff = Date.now() - maxAgeMs;
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (!TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
            const path = join(root, entry.name);
            try {
                if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
            } catch {
                // 目录已被删除/无权限时忽略
            }
        }
    } catch {
        // tmpdir 不可读时忽略
    }
}

/** 上传：音频已在任务目录里，转录从 10% 起算 */
const UPLOAD_BASE_PERCENT = 10;
/** B 站：解析/下载占前 20% */
const BILI_BASE_PERCENT = 20;

function percentFor(base: number, audioTime: number, durationSec: number | undefined): number {
    if (!durationSec || durationSec <= 0) return -1;
    const ratio = Math.max(0, Math.min(1, audioTime / durationSec));
    return Math.round(base + ratio * (96 - base));
}

function sanitizeName(raw: string): string {
    const value = raw.replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim().slice(0, 200);
    return value || "B站转录";
}

/**
 * 简单的 FIFO 并发队列。转录会拉起 amt-cli 子进程（默认 4 线程、数百 MB 内存），
 * 多个任务同时跑容易打满 CPU/内存，所以默认串行（AMT_CONCURRENCY=1）。
 */
interface QueueTask {
    id: string;
    run: (signal: AbortSignal) => Promise<void>;
}

export class TaskQueue {
    private readonly pending: QueueTask[] = [];
    private readonly running = new Map<string, AbortController>();

    constructor(private readonly concurrency: number) {}

    add(id: string, run: (signal: AbortSignal) => Promise<void>): void {
        this.pending.push({ id, run });
        this.pump();
    }

    /** 取消排队或执行中的任务；返回是否找到。执行中的任务会收到 AbortSignal。 */
    cancel(id: string): boolean {
        const index = this.pending.findIndex((task) => task.id === id);
        if (index >= 0) {
            this.pending.splice(index, 1);
            return true;
        }
        const running = this.running.get(id);
        if (running) {
            running.abort();
            return true;
        }
        return false;
    }

    get pendingCount(): number {
        return this.pending.length;
    }

    get activeCount(): number {
        return this.running.size;
    }

    private pump(): void {
        while (this.running.size < this.concurrency && this.pending.length > 0) {
            const task = this.pending.shift()!;
            const controller = new AbortController();
            this.running.set(task.id, controller);
            void (async () => {
                try {
                    await task.run(controller.signal);
                } catch (error) {
                    // 单个任务异常不能卡死队列
                    console.error("转录队列任务异常", error);
                } finally {
                    this.running.delete(task.id);
                    this.pump();
                }
            })();
        }
    }
}

export class TranscribeJobStore {
    private readonly jobs = new Map<string, TranscribeJob>();
    private readonly timer: ReturnType<typeof setInterval>;
    private readonly queue: TaskQueue;

    constructor(private readonly deps: TranscribeJobDeps) {
        this.queue = new TaskQueue(Math.max(1, deps.config.amtConcurrency || 1));
        // 崩溃/强杀会留下 pianobe-* 临时目录；启动时清掉旧残留。
        sweepTranscribeTempDirs(JOB_TTL_MS);
        this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
        // 不阻止进程退出（bun 的定时器句柄）
        (this.timer as unknown as { unref?: () => void }).unref?.();
    }

    dispose(): void {
        clearInterval(this.timer);
        for (const job of [...this.jobs.values()]) this.remove(job.id);
    }

    /** 队列里还没开始的任务数 */
    get pendingCount(): number {
        return this.queue.pendingCount;
    }

    /** 正在执行的任务数 */
    get activeCount(): number {
        return this.queue.activeCount;
    }

    /** 队列是否已满：满了拒绝新任务，避免上传占满临时空间 */
    get isQueueFull(): boolean {
        return this.queue.pendingCount >= this.deps.config.amtMaxQueue;
    }

    get(id: string): TranscribeJobSnapshot | undefined {
        const job = this.jobs.get(id);
        return job ? this.snapshot(job) : undefined;
    }

    /** 原始音频（用于管理页试听） */
    audio(id: string): { path: string; mime: string } | undefined {
        const job = this.jobs.get(id);
        if (!job?.audioPath) return undefined;
        return { path: job.audioPath, mime: job.audioMime ?? "application/octet-stream" };
    }

    /** 转录出的原始 MIDI（用于管理页试听） */
    midi(id: string): Uint8Array<ArrayBuffer> | undefined {
        return this.jobs.get(id)?.midi;
    }

    /** 保存原始音频到任务目录并开始转录（上传入口） */
    startUpload(input: {
        buffer: Uint8Array;
        ext: string;
        mime: string;
        name: string;
        durationSec?: number;
        fileName?: string;
        ownerId?: number;
    }): TranscribeJobSnapshot {
        const job = this.createJob(
            { kind: "upload", fileName: input.fileName },
            input.name,
            input.durationSec,
            input.ownerId
        );
        const audioPath = join(job.dir, `audio${input.ext}`);
        writeFileSync(audioPath, input.buffer);
        job.audioPath = audioPath;
        job.audioMime = input.mime;
        this.update(job, {
            message: "音频已上传，等待转录",
            percent: UPLOAD_BASE_PERCENT,
            audioReady: true,
        });
        // Bun.spawn 在 Windows 上可能阻塞数秒（杀软扫描 CLI）：交给队列在下一轮事件循环执行，
        // 让创建任务的 HTTP 响应先返回，前端才能立即进入进度界面。
        this.queue.add(job.id, async (signal) => {
            if (!this.jobs.has(job.id)) return;
            await this.transcribe(job, UPLOAD_BASE_PERCENT, signal);
        });
        return this.snapshot(job);
    }

    /** 解析 B 站视频并下载音频（下载与转录在后台进行） */
    startBilibili(input: {
        url: string;
        page: number;
        name?: string;
        ownerId?: number;
    }): TranscribeJobSnapshot {
        const job = this.createJob(
            {
                kind: "bilibili",
                bvid: "",
                cid: 0,
                title: "",
                page: input.page,
                pageCount: 0,
                quality: "",
                codecs: "",
                bandwidth: 0,
            },
            input.name ?? "B站转录",
            undefined,
            input.ownerId
        );
        this.update(job, {
            stage: "queued",
            message: "已加入队列，等待处理…",
            percent: 0,
        });
        this.queue.add(job.id, async (signal) => {
            if (!this.jobs.has(job.id)) return;
            this.update(job, {
                stage: "downloading",
                message: "解析视频并下载音频…",
                percent: 2,
            });
            await this.downloadAndTranscribe(job, input.url, input.page, signal);
        });
        return this.snapshot(job);
    }

    /** 改任务名（保存/生成导入码时使用新名字） */
    rename(id: string, name: string): TranscribeJobSnapshot | undefined {
        const job = this.jobs.get(id);
        if (!job) return undefined;
        const clean = name.trim().slice(0, 200);
        if (!clean) return undefined;
        job.codeCache = undefined;
        this.update(job, { name: clean });
        return this.snapshot(job);
    }

    /** 显式保存到曲目库（幂等：已保存则直接返回） */
    save(id: string, name?: string): TranscribeJobSnapshot | undefined {
        const job = this.jobs.get(id);
        if (!job) return undefined;
        if (name !== undefined) {
            const clean = name.trim().slice(0, 200);
            if (!clean) return undefined;
            if (clean !== job.name) {
                job.name = clean;
                job.codeCache = undefined;
            }
        }
        if (!job.midi) return undefined;
        if (!job.savedSong) {
            const meta = this.deps.songPort.saveMidiFile(job.midi, job.name);
            const withStats =
                this.deps.songPort.listMetasWithStats().find((item) => item.id === meta.id) ?? meta;
            job.savedSong = withStats;
            this.update(job, { message: "已保存到曲目库" });
        }
        return this.snapshot(job);
    }

    /** 游戏内导入码（按当前名字即时编码 PBE3） */
    code(id: string): { name: string; chunks: string[]; bytes: number } | undefined {
        const job = this.jobs.get(id);
        if (!job?.midi) return undefined;
        if (job.codeCache?.name === job.name) return job.codeCache;
        const song = midiBufferToSong(job.midi, job.name);
        const pbe3 = encodeSong(song);
        const cache = { name: job.name, chunks: planImportChunks(pbe3), bytes: pbe3.byteLength };
        job.codeCache = cache;
        return cache;
    }

    /**
     * 转录结果转成游戏可直接播放/导入的 PBE3（与 /api/songs/:id 同形）。
     * BDS 用它在游戏内把结果写入存储卡，不经过曲目库。
     */
    song(id: string):
        | {
              id: string;
              name: string;
              duration: number;
              noteCount: number;
              bytes: number;
              expiresAt: number;
              data: string;
          }
        | undefined {
        const job = this.jobs.get(id);
        if (!job?.midi) return undefined;
        const pbe3 = encodeSong(midiBufferToSong(job.midi, job.name));
        const header = readPbe3Header(pbe3);
        return {
            id: header.id,
            name: header.name,
            duration: header.duration,
            noteCount: header.noteCount,
            bytes: pbe3.byteLength,
            expiresAt: job.updatedAt + JOB_TTL_MS,
            data: encodeBase64Url(pbe3),
        };
    }

    /** 任务对查看者是否可见：管理员全部可见，普通令牌只能看自己发起的。 */
    visible(id: string, viewer?: TokenInfo): boolean {
        const job = this.jobs.get(id);
        if (!job || !viewer) return false;
        return viewer.role === "admin" || job.ownerId === undefined || job.ownerId === viewer.id;
    }

    remove(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        // 先取消排队/终止 amt-cli，避免删掉记录后进程还在跑、并发槽不释放。
        this.queue.cancel(id);
        const cancelled: TranscribeJobSnapshot = {
            ...this.snapshot(job),
            stage: "error",
            message: "任务已取消",
            error: "任务已取消",
        };
        this.jobs.delete(id);
        for (const listener of [...job.listeners]) {
            try {
                listener(cancelled);
            } catch {
                // 单个订阅者异常不影响清理
            }
        }
        job.listeners.clear();
        rmSync(job.dir, { recursive: true, force: true });
        return true;
    }

    subscribe(id: string, listener: (snapshot: TranscribeJobSnapshot) => void): () => void {
        const job = this.jobs.get(id);
        if (!job) return () => {};
        job.listeners.add(listener);
        return () => {
            job.listeners.delete(listener);
        };
    }

    private createJob(
        source: TranscribeJobSource,
        name: string,
        durationSec?: number,
        ownerId?: number
    ): TranscribeJob {
        const now = Date.now();
        const job: TranscribeJob = {
            id: crypto.randomUUID(),
            ownerId,
            stage: "queued",
            message: "排队中…",
            percent: 0,
            noteCount: 0,
            elapsedMs: 0,
            name: name.trim().slice(0, 200) || "未命名转录",
            source,
            createdAt: now,
            updatedAt: now,
            audioReady: false,
            midiReady: false,
            durationSec,
            dir: mkdtempSync(join(tmpdir(), "pianobe-job-")),
            listeners: new Set(),
        };
        this.jobs.set(job.id, job);
        return job;
    }

    private async downloadAndTranscribe(
        job: TranscribeJob,
        url: string,
        page: number,
        signal?: AbortSignal
    ) {
        try {
            if (!this.deps.amt) throw new AmtUnavailableError("服务端未启用 AMT");
            if (signal?.aborted) return;
            const video = await resolveBiliVideo(url, page, this.deps.config.biliSessdata);
            if (signal?.aborted || !this.jobs.has(job.id)) return;
            const audioPath = join(job.dir, "audio.m4s");
            await downloadBiliAudio(video, audioPath, this.deps.config.biliSessdata);
            if (signal?.aborted || !this.jobs.has(job.id)) return;
            job.audioPath = audioPath;
            job.audioMime = "audio/mp4";
            if (job.name === "B站转录") job.name = sanitizeName(video.title);
            job.source = {
                kind: "bilibili",
                bvid: video.bvid,
                cid: video.cid,
                title: video.title,
                page: video.page,
                pageCount: video.pageCount,
                quality: video.quality,
                codecs: video.codecs,
                bandwidth: video.bandwidth,
            };
            this.update(job, {
                stage: "analyzing",
                message: "音频下载完成，准备转录…",
                percent: BILI_BASE_PERCENT,
                audioReady: true,
                durationSec: video.durationSec ?? job.durationSec,
            });
            await this.transcribe(job, BILI_BASE_PERCENT, signal);
        } catch (error) {
            if (!this.jobs.has(job.id) || error instanceof AmtAbortedError) return;
            this.fail(job, error);
        }
    }

    private async transcribe(job: TranscribeJob, basePercent: number, signal?: AbortSignal) {
        try {
            if (!this.deps.amt) throw new AmtUnavailableError("服务端未启用 AMT");
            if (!job.audioPath) throw new Error("音频文件缺失");
            if (signal?.aborted) return;
            this.update(job, {
                stage: "analyzing",
                message: "分析音频…",
                percent: basePercent + 2,
            });
            const result = await this.deps.amt.transcribe(job.audioPath, {
                signal,
                onProgress: ({ audioTime, noteCount }) => {
                    if (!this.jobs.has(job.id) || signal?.aborted) return;
                    this.update(job, {
                        stage: "transcribing",
                        message: "转录音符…",
                        percent: percentFor(basePercent + 4, audioTime, job.durationSec),
                        audioTime,
                        noteCount,
                    });
                },
            });
            if (!this.jobs.has(job.id) || signal?.aborted) return;
            this.update(job, {
                stage: "finalizing",
                message: "生成 MIDI…",
                percent: 97,
            });
            const song = midiBufferToSong(result.midi, job.name);
            const noteCount = song.tracks.reduce(
                (sum, track) => sum + Math.floor((track.notes?.length ?? 0) / 4),
                0
            );
            // 0 音符的 MIDI 存进存储卡必然被校验拒绝，直接按失败处理，避免“完成但存不进”。
            if (noteCount === 0) throw new Error("未识别到音符，请换一段音频或检查音质");
            job.midi = result.midi;
            job.transcribeMs = result.elapsedMs;
            this.update(job, {
                stage: "done",
                message: "转录完成",
                percent: 100,
                noteCount,
                midiDuration: song.duration,
                dataSize: result.midi.byteLength,
                midiReady: true,
            });
        } catch (error) {
            if (!this.jobs.has(job.id) || error instanceof AmtAbortedError) return;
            this.fail(job, error);
        }
    }

    private fail(job: TranscribeJob, error: unknown) {
        const message =
            error instanceof AmtUnavailableError ||
            error instanceof AmtBusyError ||
            error instanceof AmtTimeoutError ||
            error instanceof BiliError
                ? error.message
                : `转录失败：${error instanceof Error ? error.message : String(error)}`;
        console.error("[transcribe]", job.id, error);
        this.update(job, {
            stage: "error",
            message,
            error: message,
        });
    }

    private update(job: TranscribeJob, patch: Partial<TranscribeJobSnapshot>) {
        Object.assign(job, patch);
        job.updatedAt = Date.now();
        if ((job.stage === "done" || job.stage === "error") && job.finishedAt === undefined) {
            job.finishedAt = job.updatedAt;
        }
        // 预览阶段的改名/保存不应把「耗时」越拖越长：完成后冻结
        job.elapsedMs = (job.finishedAt ?? job.updatedAt) - job.createdAt;
        const snapshot = this.snapshot(job);
        for (const listener of [...job.listeners]) {
            try {
                listener(snapshot);
            } catch {
                // 订阅端异常不应影响任务本身
            }
        }
    }

    private snapshot(job: TranscribeJob): TranscribeJobSnapshot {
        return {
            id: job.id,
            stage: job.stage,
            message: job.message,
            percent: job.percent,
            audioTime: job.audioTime,
            durationSec: job.durationSec,
            noteCount: job.noteCount,
            midiDuration: job.midiDuration,
            dataSize: job.dataSize,
            elapsedMs: job.elapsedMs,
            name: job.name,
            source: job.source,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            audioReady: job.audioReady,
            midiReady: job.midiReady,
            error: job.error,
            savedSong: job.savedSong,
        };
    }

    private cleanup() {
        const now = Date.now();
        const cutoff = now - JOB_TTL_MS;
        // 执行中的任务给足「排队 + 单任务超时」的余量；只有远超上限的僵尸任务才强制清理。
        const activeCutoff = JOB_TTL_MS + this.deps.config.amtTimeoutMs + 5 * 60_000;
        for (const job of [...this.jobs.values()]) {
            if (job.stage === "done" || job.stage === "error") {
                if (job.updatedAt < cutoff) this.remove(job.id);
                continue;
            }
            if (now - job.createdAt > activeCutoff) this.remove(job.id);
        }
    }
}
