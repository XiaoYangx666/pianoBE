import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    encodeBase64Url,
    encodeSong,
    planImportChunks,
    readPbe3Header,
    validateSong,
    type MidiSongMeta,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import type { SqliteSongPort } from "../drivers/sqlitePorts.js";
import type { TokenInfo } from "../auth.js";
import type { ServerConfig } from "../config.js";
import { NOOP_LOGGER, type Logger } from "../logger.js";
import {
    AmtAbortedError,
    AmtTimeoutError,
    AmtUnavailableError,
    type AmtService,
} from "./amt.js";
import { BiliError, downloadBiliAudio, resolveBiliVideo, type BiliVideo } from "./bilibili.js";

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
    /** 完成时已编码并校验过的 PBE3；改名后失效，下次按需重编码 */
    pbe3?: Uint8Array;
    transcribeMs?: number;
    finishedAt?: number;
    listeners: Set<(snapshot: TranscribeJobSnapshot) => void>;
    codeCache?: { name: string; chunks: string[]; bytes: number };
}

/** 队列已满：路由层提前拒绝只是优化，最终以入队时的容量检查为准。 */
export class TranscribeQueueFullError extends Error {
    constructor() {
        super("转录队列已满，请稍后再试");
        this.name = "TranscribeQueueFullError";
    }
}

export interface TranscribeJobDeps {
    songPort: SqliteSongPort;
    config: ServerConfig;
    amt?: AmtService;
    logger?: Logger;
}

const JOB_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TEMP_PREFIXES = ["pianobe-job-", "pianobe-amt-"] as const;
/** 目录名里的 PID 已退出时，给子进程留出的最后收尾时间 */
const DEAD_OWNER_GRACE_MS = 60_000;

function tempOwnerPid(name: string): number | undefined {
    const match = /^pianobe-(?:job|amt)-(\d{1,10})-/.exec(name);
    if (!match) return undefined;
    const pid = Number(match[1]);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM 说明进程存在但当前用户无权发信号，按存活处理
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * 清理进程崩溃/重启留下的临时目录。
 *
 * 目录名带创建者 PID：只要该进程还活着就绝不删除，避免同一台机器上的多个实例互相误删。
 * 只有确认 PID 已退出（或旧版本没有 PID 的目录超过 maxAgeMs）才清理。
 */
export function sweepTranscribeTempDirs(maxAgeMs: number): void {
    const root = tmpdir();
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (!TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
            const path = join(root, entry.name);
            try {
                const mtime = statSync(path).mtimeMs;
                const owner = tempOwnerPid(entry.name);
                if (owner !== undefined) {
                    if (owner === process.pid || isProcessAlive(owner)) continue;
                    if (mtime < now - DEAD_OWNER_GRACE_MS) rmSync(path, { recursive: true, force: true });
                    continue;
                }
                if (mtime < cutoff) rmSync(path, { recursive: true, force: true });
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

export function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
    private readonly tasks = new Set<Promise<void>>();

    constructor(
        private readonly concurrency: number,
        private readonly maxPending = Number.POSITIVE_INFINITY,
        private readonly log: Logger = NOOP_LOGGER
    ) {}

    /** 入队；队列已满时返回 false，调用方负责清理刚创建的任务。 */
    add(id: string, run: (signal: AbortSignal) => Promise<void>): boolean {
        if (this.pending.length >= this.maxPending) return false;
        this.pending.push({ id, run });
        this.pump();
        return true;
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

    /** 取消全部排队任务并终止执行中的任务（服务端关闭时使用）。 */
    cancelAll(): void {
        this.pending.length = 0;
        for (const controller of this.running.values()) controller.abort();
    }

    /** 等待执行中的任务真正退出；超时返回 false，调用方仍可继续强制清理。 */
    async whenIdle(timeoutMs: number): Promise<boolean> {
        if (this.running.size === 0) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
            (timer as unknown as { unref?: () => void }).unref?.();
        });
        const idle = Promise.all([...this.tasks]).then(() => true);
        const result = await Promise.race([idle, timeout]);
        if (timer) clearTimeout(timer);
        return result;
    }

    get pendingCount(): number {
        return this.pending.length;
    }

    get activeCount(): number {
        return this.running.size;
    }

    get isFull(): boolean {
        return this.pending.length >= this.maxPending;
    }

    private pump(): void {
        while (this.running.size < this.concurrency && this.pending.length > 0) {
            const task = this.pending.shift()!;
            const controller = new AbortController();
            this.running.set(task.id, controller);
            const runningTask = (async () => {
                try {
                    await task.run(controller.signal);
                } catch (error) {
                    // 单个任务异常不能卡死队列
                    this.log.error("转录队列任务异常", error, { job: task.id });
                } finally {
                    this.running.delete(task.id);
                    this.pump();
                }
            })();
            this.tasks.add(runningTask);
            void runningTask.finally(() => this.tasks.delete(runningTask));
        }
    }
}

export class TranscribeJobStore {
    private readonly jobs = new Map<string, TranscribeJob>();
    private readonly timer: ReturnType<typeof setInterval>;
    private readonly queue: TaskQueue;
    private readonly log: Logger;

    constructor(private readonly deps: TranscribeJobDeps) {
        this.log = deps.logger ?? NOOP_LOGGER;
        this.queue = new TaskQueue(
            Math.max(1, deps.config.amtConcurrency || 1),
            Math.max(1, deps.config.amtMaxQueue || 1),
            this.log
        );
        // 崩溃/强杀会留下 pianobe-* 临时目录；启动时只清掉足够久、肯定已结束的残留，
        // 避免误删另一个实例正在排队/执行的任务目录（排队上限 × 单任务超时 + 任务 TTL）。
        const staleAfterMs =
            JOB_TTL_MS +
            Math.max(1, deps.config.amtMaxQueue || 1) * Math.max(1, deps.config.amtTimeoutMs || 1) +
            5 * 60_000;
        sweepTranscribeTempDirs(staleAfterMs);
        this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
        // 不阻止进程退出（bun 的定时器句柄）
        (this.timer as unknown as { unref?: () => void }).unref?.();
    }

    async dispose(timeoutMs = 5000): Promise<void> {
        clearInterval(this.timer);
        // 先断开队列：排队任务不会再启动，执行中的任务收到 AbortSignal 并终止子进程。
        this.queue.cancelAll();
        try {
            // 等待子进程/下载真正退出后再删目录，避免运行中的任务仍在读被删文件。
            await this.queue.whenIdle(timeoutMs);
        } finally {
            for (const job of [...this.jobs.values()]) this.remove(job.id);
        }
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
        return this.queue.isFull;
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
        this.enqueue(job, async (signal) => {
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
        /** 路由层已解析并校验过的视频信息，避免重复请求 B 站 */
        video?: BiliVideo;
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
        this.enqueue(job, async (signal) => {
            if (!this.jobs.has(job.id)) return;
            this.update(job, {
                stage: "downloading",
                message: "解析视频并下载音频…",
                percent: 2,
            });
            await this.downloadAndTranscribe(job, input.url, input.page, input.video, signal);
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
        // PBE3 文件头里也带曲名：改名后必须重编码，避免导入码/下载仍显示旧名字。
        job.pbe3 = undefined;
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
                job.pbe3 = undefined;
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
        const pbe3 = this.pbe3For(job);
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
        const pbe3 = this.pbe3For(job);
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
            dir: mkdtempSync(join(tmpdir(), `pianobe-job-${process.pid}-`)),
            listeners: new Set(),
        };
        this.jobs.set(job.id, job);
        this.log.debug("转录任务已创建", {
            job: job.id,
            source: source.kind,
            name: job.name,
            owner: ownerId,
        });
        return job;
    }

    /**
     * 真正入队的位置同时承担最终容量检查：路由层的提前拒绝只省掉无用的下载/上传，
     * 并发请求都通过预检时仍会在这里被挡住。
     */
    private enqueue(job: TranscribeJob, run: (signal: AbortSignal) => Promise<void>): void {
        // queue.add() 会立即 pump，可能在返回前就打出「开始转录」。先检查容量并记录入队，
        // 保证日志顺序是「已入队」→「开始转录」。
        if (this.queue.isFull) {
            this.jobs.delete(job.id);
            rmSync(job.dir, { recursive: true, force: true });
            this.log.warn("转录队列已满，任务被拒绝", undefined, {
                job: job.id,
                pending: this.queue.pendingCount,
                active: this.queue.activeCount,
            });
            throw new TranscribeQueueFullError();
        }
        this.log.info("转录任务已入队", {
            job: job.id,
            source: job.source.kind,
            name: job.name,
            pending: this.queue.pendingCount + 1,
            active: this.queue.activeCount,
        });
        if (!this.queue.add(job.id, run)) {
            // 预检查与 add 之间没有 await，正常不会走到这里；保留兜底清理。
            this.jobs.delete(job.id);
            rmSync(job.dir, { recursive: true, force: true });
            this.log.warn("转录队列已满，任务被拒绝", undefined, {
                job: job.id,
                pending: this.queue.pendingCount,
                active: this.queue.activeCount,
            });
            throw new TranscribeQueueFullError();
        }
    }

    private pbe3For(job: TranscribeJob): Uint8Array {
        if (job.pbe3) return job.pbe3;
        if (!job.midi) throw new Error("转录结果缺失");
        const pbe3 = encodeSong(midiBufferToSong(job.midi, job.name));
        validateSong(pbe3);
        job.pbe3 = pbe3;
        return pbe3;
    }

    private async downloadAndTranscribe(
        job: TranscribeJob,
        url: string,
        page: number,
        prepared: BiliVideo | undefined,
        signal?: AbortSignal
    ) {
        try {
            if (!this.deps.amt) throw new AmtUnavailableError("服务端未启用 AMT");
            if (signal?.aborted) return;
            const video = prepared ?? (await resolveBiliVideo(url, page, this.deps.config.biliSessdata));
            if (video.durationSec && video.durationSec > this.deps.config.amtMaxAudioSeconds) {
                throw new BiliError(
                    `视频时长超过上限（${formatDuration(video.durationSec)} > ${formatDuration(
                        this.deps.config.amtMaxAudioSeconds
                    )}）`
                );
            }
            if (signal?.aborted || !this.jobs.has(job.id)) return;
            const audioPath = join(job.dir, "audio.m4s");
            const audioBytes = await downloadBiliAudio(video, audioPath, this.deps.config.biliSessdata, {
                signal,
                maxBytes: this.deps.config.amtMaxDownloadBytes,
                logger: this.log,
            });
            this.log.info("B站音频已下载", {
                job: job.id,
                bvid: video.bvid,
                bytes: audioBytes,
                quality: video.quality,
                duration: video.durationSec,
            });
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
            this.log.info("开始转录", {
                job: job.id,
                name: job.name,
                source: job.source.kind,
                duration: job.durationSec,
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
            // 完成时就编码并完整校验一次：后续导入码/下载直接复用，避免“转录成功但导入失败”。
            const pbe3 = encodeSong(song);
            validateSong(pbe3);
            job.midi = result.midi;
            job.pbe3 = pbe3;
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
            this.log.info("转录完成", {
                job: job.id,
                name: job.name,
                notes: noteCount,
                bytes: result.midi.byteLength,
                ms: result.elapsedMs,
            });
        } catch (error) {
            if (!this.jobs.has(job.id) || error instanceof AmtAbortedError) return;
            this.fail(job, error);
        }
    }

    private fail(job: TranscribeJob, error: unknown) {
        const message =
            error instanceof AmtUnavailableError ||
            error instanceof AmtTimeoutError ||
            error instanceof BiliError
                ? error.message
                : `转录失败：${error instanceof Error ? error.message : String(error)}`;
        this.log.error("转录任务失败", error, {
            job: job.id,
            name: job.name,
            stage: job.stage,
            source: job.source.kind,
        });
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
