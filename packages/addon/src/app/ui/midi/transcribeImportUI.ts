import { DDUI } from "sapi-pro";
import {
    estimatePbe3VoiceLoad,
    formatBytes,
    formatVoiceLoadWarning,
    type MusicRef,
} from "@piano/core";
import { canImportMidi } from "@app/permissions";
import { getOnlineTranscribe } from "@app/serverAdmin";
import { storageRef } from "@domain/music/storage";
import type { PianoRuntime } from "@app/PianoRuntime";
import type { TranscribeJob } from "@platform/server/admin/transcribeClient";

/** 打开页面时绑定当前卡；换卡后不再写入。 */
export interface TranscribeImportArgs {
    piano: PianoRuntime;
}

/** 轮询间隔：40 tick = 2 秒 */
const POLL_TICKS = 40;
/** 单次等待上限：超时直接放弃并取消服务端任务，不做跨页面恢复。 */
const JOB_WAIT_MS = 15 * 60 * 1000;

const STAGE_LABEL: Record<string, string> = {
    queued: "排队中",
    downloading: "解析并下载音频",
    analyzing: "分析音频",
    transcribing: "转录中",
    finalizing: "收尾",
    done: "转录完成",
    error: "转录失败",
};

function jobProgressText(job: TranscribeJob): string {
    const stage = STAGE_LABEL[job.stage] ?? job.stage;
    const percent = job.percent >= 0 ? `${job.percent}%` : "处理中…";
    const message = job.message ? `\n§7${job.message}` : "";
    return `§7状态：§f${stage} §7· §f${percent}${message}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface TranscribeDoneArgs {
    piano: PianoRuntime;
    ref: MusicRef;
    warning?: string;
}

/** 转录并写入存储卡成功后的完成页。 */
export const TranscribeDonePage = DDUI.page<TranscribeDoneArgs>("转录完成", (ui, args) => {
    const { piano, ref } = args;
    const player = ui.player;
    const status = ui.string("");
    const access = piano.cardAccess;
    const usage = access?.storage().usage();
    const seconds = Math.max(0, Math.floor(ref.duration / 40));

    ui.label("§a转录完成，已写入存储卡。");
    ui.label(`§b${ref.name}`);
    ui.label(
        `§7时长：§f${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` +
            ` §7音符：§f${ref.noteCount ?? "未知"}` +
            ` §7大小：§f${ref.bytes !== undefined ? formatBytes(ref.bytes) : "未知"}`
    );
    if (usage) {
        ui.label(
            `§7存储卡已用 §f${formatBytes(usage.usedBytes)}§7 / §f${formatBytes(usage.limitBytes)}` +
                ` §7（§f${usage.songs}§7 首）`
        );
    } else {
        ui.label("§e存储卡已不在卡槽中，可稍后插回再播放。");
    }
    if (args.warning) ui.label(`§e${args.warning}`);
    ui.label(status);

    ui.button("立即播放", () => {
        if (!piano.isAlive()) return;
        void piano
            .getMidiPlayer()
            .playNow(ref)
            .catch((error) => status.setData(`§c播放失败：${errorMessage(error)}`));
    });
    ui.button("返回存储卡", () => ui.back());
    ui.button("再导一首", () => ui.replace(TranscribeImportPage, { piano }));
    ui.closeButton();
});

/**
 * B 站转录 → 直接写入当前存储卡。
 *
 * 保守生命周期：页面关闭/取消/超时/轮询失败都会停止定时器并尽力取消服务端任务；
 * 不做跨页面恢复，不保留可能过期的任务号。
 */
export const TranscribeImportPage = DDUI.page<TranscribeImportArgs>("从转录导入", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const access = piano.cardAccess;
    const cardUid = access?.uid;
    if (!access) {
        player.sendMessage("§c卡槽为空，请先插入音乐存储卡。");
        ui.close();
        return;
    }
    if (!canImportMidi(player)) {
        player.sendMessage("§e管理员未开放玩家导入。");
        ui.close();
        return;
    }

    const storage = access.storage();
    const initialUsage = storage.usage();
    const input = ui.string("");
    const status = ui.string("§7输入 BV 号或完整视频链接后开始转录。");
    const progress = ui.string("");
    const formVisible = ui.boolean(true, { clientWritable: false });
    const cancelVisible = ui.boolean(false, { clientWritable: false });

    let jobId: string | undefined;
    let deadline = 0;
    let disposed = false;
    let submitting = false;
    let polling = false;
    let stopPolling: (() => void) | undefined;

    const clearPolling = () => {
        stopPolling?.();
        stopPolling = undefined;
    };

    /** 放弃当前任务：停止轮询、清空任务号，并尽力让服务端也取消。 */
    const abandon = (message: string) => {
        const id = jobId;
        jobId = undefined;
        clearPolling();
        formVisible.setData(true);
        cancelVisible.setData(false);
        progress.setData("");
        status.setData(message);
        if (id) {
            void getOnlineTranscribe()?.cancel(id).catch(() => {
                // 网络失败时服务端仍会按 TTL 清理，不在客户端重试
            });
        }
    };

    const saveResult = async (id: string) => {
        const client = getOnlineTranscribe();
        if (!client) return abandon("§c后端未配置，无法获取转录结果。");
        try {
            const song = await client.getSong(id);
            // 页面关闭或已被取消/替换：直接丢弃，不写卡。
            if (disposed || ui.closed || jobId !== id) return;
            const current = piano.cardAccess;
            if (!current || (cardUid !== undefined && current.uid !== cardUid)) {
                return abandon("§c存储卡已取出或被替换，结果已丢弃。");
            }
            if (!canImportMidi(player)) return abandon("§c管理员已关闭玩家导入，结果已丢弃。");
            if (!piano.isAlive()) return abandon("§c钢琴已不可用，结果已丢弃。");

            const entry = current.storage().save(song.pbe3);
            current.refreshLore();
            piano.refreshCardIndicator();
            let warning: string | undefined;
            try {
                warning = formatVoiceLoadWarning(estimatePbe3VoiceLoad(song.pbe3));
            } catch {
                // 负载估算失败不影响已保存的结果
            }
            jobId = undefined;
            clearPolling();
            player.sendMessage(`§a[转录导入] 已存入存储卡：${entry.name}`);
            ui.replace(TranscribeDonePage, {
                piano,
                ref: storageRef(entry, current.uid),
                warning,
            });
        } catch (error) {
            abandon(`§c获取或保存失败：${errorMessage(error)}`);
        }
    };

    const poll = async () => {
        if (!jobId || polling || disposed || ui.closed) return;
        const client = getOnlineTranscribe();
        if (!client) return abandon("§c后端未配置，任务已放弃。");
        if (Date.now() > deadline) return abandon("§c等待转录超时，任务已放弃。");
        polling = true;
        const id = jobId;
        try {
            const job = await client.getJob(id);
            if (disposed || ui.closed || jobId !== id) return;
            progress.setData(jobProgressText(job));
            if (job.stage === "error") {
                abandon(`§c转录失败：${job.error ?? "未知错误"}`);
                return;
            }
            if (job.stage === "done") {
                clearPolling();
                await saveResult(id);
            }
        } catch (error) {
            // 保守处理：网络/任务异常不重试，直接放弃并清理服务端任务。
            abandon(`§c状态查询失败：${errorMessage(error)}，任务已放弃。`);
        } finally {
            polling = false;
        }
    };

    const startPolling = () => {
        clearPolling();
        stopPolling = ui.interval(() => {
            void poll();
        }, POLL_TICKS);
        void poll();
    };

    const submit = async () => {
        if (submitting || disposed) return;
        const value = input.getData().trim();
        if (!value) {
            status.setData("§e请先输入 BV 号或视频链接。");
            return;
        }
        const client = getOnlineTranscribe();
        if (!client) {
            status.setData("§c后端未配置（variables/secrets），无法转录。");
            return;
        }
        if (!canImportMidi(player)) {
            status.setData("§c管理员已关闭玩家导入。");
            return;
        }
        if (!piano.isAlive()) {
            status.setData("§c钢琴已不可用。");
            return;
        }
        submitting = true;
        formVisible.setData(false);
        status.setData("§7正在提交转录任务…");
        progress.setData("");
        try {
            const created = await client.startBilibili(value);
            // 提交过程中页面已关闭：取消刚创建的任务，避免后台残留。
            if (disposed || ui.closed) {
                void client.cancel(created.id).catch(() => {});
                return;
            }
            jobId = created.id;
            deadline = Date.now() + JOB_WAIT_MS;
            cancelVisible.setData(true);
            status.setData("§a已提交，等待后端队列处理。");
            startPolling();
        } catch (error) {
            if (!disposed && !ui.closed) {
                status.setData(`§c提交失败：${errorMessage(error)}`);
                formVisible.setData(true);
            }
        } finally {
            submitting = false;
        }
    };

    ui.label("§b从 B 站转录导入存储卡");
    ui.label("§7输入 BV 号或完整视频链接；转录完成后直接写入当前存储卡。");
    ui.label(
        `§7目标：§f${storage.label} §7· §f${formatBytes(initialUsage.usedBytes)}§7 / §f${formatBytes(initialUsage.limitBytes)}`
    );
    ui.textField("BV 号 / 视频链接", input).label(status).label(progress);
    ui.button("开始转录", () => void submit(), { visible: formVisible });
    ui.button("取消等待", () => abandon("§7已取消，任务已放弃。"), { visible: cancelVisible });
    ui.closeButton();

    ui.onClose(() => {
        disposed = true;
        clearPolling();
        const id = jobId;
        jobId = undefined;
        // 页面关闭就丢弃结果，并尽力取消服务端任务；取消失败交给服务端 TTL 清理。
        if (id) void getOnlineTranscribe()?.cancel(id).catch(() => {});
    });
});
