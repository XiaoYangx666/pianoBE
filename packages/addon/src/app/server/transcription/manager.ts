import type { StoredMusicEntry } from "@piano/core";
import { Signal } from "@domain/util/signal";
import {
    OnlineTranscribeError,
    type TranscribeJob,
    type TranscribeSong,
    type TranscribeStage,
} from "@platform/server/admin/transcribeClient";

/**
 * 在线转录任务管理器（BDS 专用）。
 *
 * 任务所有权在玩家，不在 UI、钢琴或存储卡：
 * - 每个玩家最多一个任务（已完成但未导入的结果同样占用名额）；
 * - 轮询由管理器统一驱动，页面只读状态；
 * - 不持久化、不跨会话恢复，玩家退出或服务关闭时尽力取消远程任务。
 *
 * 本模块不依赖 @minecraft/server，便于在 bun 测试里用假客户端验证生命周期。
 */

/** 本地提交阶段 + 服务端协议阶段；`error` 统一收敛为 `failed`，避免两套失败语义。 */
export type TranscriptionStage = "submitting" | Exclude<TranscribeStage, "error"> | "failed";

export interface TranscriptionTask {
    readonly playerId: string;
    readonly createdAt: number;
    /** 未完成任务的等待上限（毫秒） */
    readonly deadline: number;
    stage: TranscriptionStage;
    /** 服务端任务 ID；提交尚未返回时为空。 */
    jobId?: string;
    name: string;
    message?: string;
    /** 0-100；-1 表示无法估算 */
    percent: number;
    noteCount?: number;
    durationSec?: number;
    midiDuration?: number;
    dataSize?: number;
    error?: string;
    completedAt?: number;
    /** 本地结果过期时间（服务端 TTL 的保守镜像） */
    expiresAt?: number;
    /** 完成通知只发一次 */
    notified: boolean;
    /** 防止同一个结果被重复导入 */
    importing: boolean;
    /** 防止同一个任务并发发起多次状态查询 */
    polling: boolean;
    pollFailures: number;
    nextPollAt: number;
}

export interface TranscriptionChange {
    playerId: string;
    /** 任务已释放时为 undefined */
    task?: TranscriptionTask;
}

/** 导入目标由 UI 在玩家点击时构造，管理器只负责在异步前后重新校验。 */
export interface TranscriptionImportTarget {
    /** 玩家有效、钢琴可用且仍有操作权限 */
    isUsable(): boolean;
    /** 当前存储卡身份；拔卡/换卡后必须变化或返回 undefined */
    cardUid(): string | undefined;
    /** 复用现有存储卡写入；容量不足等错误直接抛出 */
    save(pbe3: Uint8Array): StoredMusicEntry;
    /** 写入后的展示刷新（Lore、卡槽指示灯等），允许失败 */
    refresh(): void;
}

export interface TranscriptionClient {
    startBilibili(input: string, name?: string): Promise<{ id: string }>;
    getJob(id: string): Promise<TranscribeJob>;
    getSong(id: string): Promise<TranscribeSong>;
    cancel(id: string): Promise<unknown>;
}

export interface TranscriptionManagerOptions {
    client: TranscriptionClient;
    /** 向在线玩家发一条游戏内消息；玩家已离线时应自行忽略。 */
    notify(playerId: string, message: string): void;
    /** 注册周期调度；返回停止函数。管理器销毁时调用。 */
    schedule(callback: () => void): () => void;
    now?(): number;
    report?(error: unknown): void;
}

export type SubmitResult = { ok: true } | { ok: false; reason: string };
export type ImportResult = { entry: StoredMusicEntry };

/** 轮询节拍由外部调度器决定，这里只决定每个任务的下一次查询时间。 */
export const POLL_INTERVAL_MS = 2_000;
/** 已完成任务只低频检查服务端 TTL，不再拉取高频进度。 */
export const COMPLETED_CHECK_MS = 60_000;
/** 未完成任务的等待上限（与旧页面行为一致）。 */
export const WAIT_TIMEOUT_MS = 15 * 60_000;
/** 服务端结果 TTL 30 分钟；本地保守按完成时间计时。 */
export const RESULT_TTL_MS = 30 * 60_000;
/** 连续状态查询失败多少次后结束任务，避免无限重试。 */
export const MAX_POLL_FAILURES = 5;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
    return error instanceof OnlineTranscribeError && error.status === 404;
}

const FAILED_STAGES: ReadonlySet<TranscriptionStage> = new Set(["failed"]);
const COMPLETED_STAGES: ReadonlySet<TranscriptionStage> = new Set(["done"]);

export class TranscriptionManager {
    private readonly tasks = new Map<string, TranscriptionTask>();
    private readonly changes = new Signal<TranscriptionChange>();
    private readonly stopSchedule: () => void;
    private readonly now: () => number;
    private readonly report: (error: unknown) => void;
    private isDisposed = false;

    constructor(private readonly opts: TranscriptionManagerOptions) {
        this.now = opts.now ?? (() => Date.now());
        this.report = opts.report ?? (() => {});
        this.stopSchedule = opts.schedule(() => this.tick());
    }

    /** 状态变化（含任务释放）。UI 按 playerId 过滤，只订阅不改写。 */
    get changeSignal() {
        return this.changes;
    }

    get disposed(): boolean {
        return this.isDisposed;
    }

    /** 当前玩家持有的任务；没有返回 undefined。 */
    get(playerId: string): TranscriptionTask | undefined {
        return this.tasks.get(playerId);
    }

    async submit(playerId: string, input: string): Promise<SubmitResult> {
        if (this.isDisposed) return { ok: false, reason: "转录服务已停止" };
        const existing = this.tasks.get(playerId);
        if (existing) {
            return { ok: false, reason: this.busyReason(existing) };
        }
        const value = input.trim();
        if (!value) return { ok: false, reason: "请先输入 BV 号或视频链接" };

        const now = this.now();
        const task: TranscriptionTask = {
            playerId,
            createdAt: now,
            deadline: now + WAIT_TIMEOUT_MS,
            stage: "submitting",
            name: "",
            percent: -1,
            notified: false,
            importing: false,
            polling: false,
            pollFailures: 0,
            nextPollAt: 0,
        };
        // 先占位再 await：并发提交不能绕过“每个玩家一个任务”。
        this.tasks.set(playerId, task);
        this.publish(task);

        let created: { id: string };
        try {
            created = await this.opts.client.startBilibili(value);
        } catch (error) {
            if (this.isCurrent(task)) {
                task.stage = "failed";
                task.error = `提交失败：${errorMessage(error)}`;
                task.message = undefined;
                this.publish(task);
            }
            return { ok: false, reason: `提交失败：${errorMessage(error)}` };
        }

        // 提交期间被取消/替换/管理器销毁：尽力清理刚返回的远程任务。
        if (!this.isCurrent(task)) {
            this.cancelRemote(created.id);
            return { ok: false, reason: "任务已取消" };
        }

        task.jobId = created.id;
        task.stage = "queued";
        task.message = "等待服务器处理…";
        task.percent = -1;
        task.nextPollAt = 0;
        this.publish(task);
        return { ok: true };
    }

    /** 主动取消/清除当前任务；远程清理失败交给服务端 TTL。 */
    cancel(playerId: string): boolean {
        const task = this.tasks.get(playerId);
        if (!task) return false;
        this.tasks.delete(playerId);
        this.publish(undefined, playerId);
        if (task.jobId) this.cancelRemote(task.jobId);
        return true;
    }

    /** 玩家退出：释放本地任务并尽力取消远程任务。 */
    releasePlayer(playerId: string): boolean {
        return this.cancel(playerId);
    }

    /**
     * 把已完成的结果写入玩家此时操作的存储卡。
     *
     * 只有在写入成功后才释放任务和远程结果；失败时保留结果，允许换卡后重试。
     */
    async importToCard(playerId: string, target: TranscriptionImportTarget): Promise<ImportResult> {
        const task = this.tasks.get(playerId);
        if (!task || !task.jobId || !COMPLETED_STAGES.has(task.stage)) {
            throw new Error("没有可导入的转录结果");
        }
        if (task.importing) throw new Error("正在导入，请稍候");
        if (!target.isUsable()) throw new Error("当前无法写入存储卡");
        const expectedUid = target.cardUid();
        if (!expectedUid) throw new Error("请先插入音乐存储卡");

        const jobId = task.jobId;
        task.importing = true;
        this.publish(task);
        let saved = false;
        try {
            const song = await this.opts.client.getSong(jobId);
            if (!this.isCurrent(task) || task.jobId !== jobId || !COMPLETED_STAGES.has(task.stage)) {
                throw new Error("转录任务已结束");
            }
            if (!target.isUsable()) throw new Error("当前无法写入存储卡");
            // 异步获取结果期间可能拔卡/换卡：写入前重新确认目标身份。
            if (target.cardUid() !== expectedUid) {
                throw new Error("存储卡已被取出或替换，请重试导入");
            }

            let entry: StoredMusicEntry;
            try {
                entry = target.save(song.pbe3);
            } catch (error) {
                throw new Error(`保存失败：${errorMessage(error)}`);
            }
            saved = true;
            try {
                target.refresh();
            } catch (error) {
                this.report(error);
            }

            this.tasks.delete(playerId);
            this.publish(undefined, playerId);
            // 本地导入成功后才清理远程结果；失败时远程 TTL 兜底。
            this.cancelRemote(jobId);
            return { entry };
        } finally {
            task.importing = false;
            if (!saved && this.isCurrent(task)) this.publish(task);
        }
    }

    /** 停止轮询并释放全部任务；异步请求返回后会被对象身份校验拦截。 */
    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        try {
            this.stopSchedule();
        } catch (error) {
            this.report(error);
        }
        for (const task of [...this.tasks.values()]) {
            if (task.jobId) this.cancelRemote(task.jobId);
        }
        this.tasks.clear();
        this.changes.dispose();
    }

    private busyReason(task: TranscriptionTask): string {
        if (COMPLETED_STAGES.has(task.stage)) return "已有转录结果，请先导入或丢弃";
        if (FAILED_STAGES.has(task.stage)) return "上次转录失败，请先清除";
        return "已有转录任务正在进行";
    }

    private tick(): void {
        if (this.isDisposed) return;
        const now = this.now();
        for (const task of [...this.tasks.values()]) {
            if (task.polling || !task.jobId || FAILED_STAGES.has(task.stage)) continue;

            if (!COMPLETED_STAGES.has(task.stage)) {
                if (now >= task.deadline) {
                    this.fail(task, "等待转录超时，任务已结束");
                    continue;
                }
            }
            if (COMPLETED_STAGES.has(task.stage) && task.expiresAt !== undefined && now >= task.expiresAt) {
                this.expire(task);
                continue;
            }
            if (now < task.nextPollAt) continue;
            void this.poll(task, now);
        }
    }

    private async poll(task: TranscriptionTask, startedAt: number): Promise<void> {
        const jobId = task.jobId;
        if (!jobId) return;
        task.polling = true;
        task.nextPollAt = startedAt + POLL_INTERVAL_MS;
        try {
            const job = await this.opts.client.getJob(jobId);
            if (!this.isCurrent(task) || task.jobId !== jobId) return;
            this.apply(task, job);
        } catch (error) {
            if (!this.isCurrent(task) || task.jobId !== jobId) return;
            if (isNotFound(error)) {
                if (COMPLETED_STAGES.has(task.stage)) this.expire(task);
                else this.fail(task, "转录任务已失效或过期");
                return;
            }
            task.pollFailures++;
            if (task.pollFailures >= MAX_POLL_FAILURES) {
                this.fail(task, `状态查询失败：${errorMessage(error)}`);
            } else {
                task.message = `状态查询失败，正在重试（${task.pollFailures}/${MAX_POLL_FAILURES}）`;
                this.publish(task);
            }
        } finally {
            task.polling = false;
            if (this.isCurrent(task)) {
                task.nextPollAt = FAILED_STAGES.has(task.stage)
                    ? Number.POSITIVE_INFINITY
                    : this.now() + (COMPLETED_STAGES.has(task.stage)
                        ? COMPLETED_CHECK_MS
                        : POLL_INTERVAL_MS);
            }
        }
    }

    private apply(task: TranscriptionTask, job: TranscribeJob): void {
        const now = this.now();
        task.pollFailures = 0;
        task.percent = job.percent;
        task.name = job.name || task.name;
        task.message = job.message;
        task.noteCount = job.noteCount;
        task.durationSec = job.durationSec;
        task.midiDuration = job.midiDuration;
        task.dataSize = job.dataSize;

        if (job.stage === "error") {
            task.stage = "failed";
            task.error = job.error ?? job.message ?? "转录失败";
            task.nextPollAt = Number.POSITIVE_INFINITY;
        } else if (job.stage === "done") {
            const firstCompletion = !COMPLETED_STAGES.has(task.stage);
            task.stage = "done";
            task.error = undefined;
            task.completedAt ??= now;
            task.expiresAt = task.completedAt + RESULT_TTL_MS;
            if (firstCompletion && !task.notified) {
                task.notified = true;
                this.send(
                    task.playerId,
                    `§a[转录] 完成：${task.name || "未命名曲目"}。打开“在线转录”即可导入存储卡。`,
                );
            }
            task.nextPollAt = now + COMPLETED_CHECK_MS;
        } else {
            task.stage = job.stage;
            task.error = undefined;
            task.nextPollAt = now + POLL_INTERVAL_MS;
        }
        this.publish(task);
    }

    private fail(task: TranscriptionTask, message: string): void {
        if (!this.isCurrent(task)) return;
        task.stage = "failed";
        task.error = message;
        task.message = undefined;
        task.nextPollAt = Number.POSITIVE_INFINITY;
        this.publish(task);
        if (task.jobId) this.cancelRemote(task.jobId);
    }

    private expire(task: TranscriptionTask): void {
        if (!this.isCurrent(task)) return;
        this.tasks.delete(task.playerId);
        this.publish(undefined, task.playerId);
        this.send(task.playerId, "§e[转录] 结果已过期，需要重新提交转录任务。");
    }

    private send(playerId: string, message: string): void {
        try {
            this.opts.notify(playerId, message);
        } catch (error) {
            this.report(error);
        }
    }

    private isCurrent(task: TranscriptionTask): boolean {
        return !this.isDisposed && this.tasks.get(task.playerId) === task;
    }

    private cancelRemote(jobId: string): void {
        void this.opts.client.cancel(jobId).catch((error) => this.report(error));
    }

    private publish(task?: TranscriptionTask, playerId = task?.playerId): void {
        if (this.isDisposed || !playerId) return;
        this.changes.publish({ playerId, task });
    }
}
