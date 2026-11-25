import { DDUI } from "sapi-pro";
import { system } from "@minecraft/server";
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
/** 本地等待上限：后端单任务超时是 10 分钟，再留出下载/排队余量 */
const JOB_WAIT_MS = 15 * 60 * 1000;

interface Session {
    jobId: string;
    input: string;
    startedAt: number;
    /** 发起任务时的卡身份，防止换卡后把结果写到另一张卡 */
    cardUid?: string;
}

/** 关闭页面后保留任务号，重新打开可继续等待；玩家离开时清理。 */
const sessions = new Map<string, Session>();

export function invalidateTranscribeImport(playerId: string) {
    sessions.delete(playerId);
}

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

/**
 * B 站转录 → 直接写入当前存储卡。
 *
 * 不引入临时曲目/新播放来源：成功后就是一张普通存储卡歌曲，后续播放、
 * 队列、演出、快照全部走现有 card 路径。
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
    const input = ui.string("");
    const status = ui.string("§7输入 BV 号或完整视频链接后开始转录。");
    const progress = ui.string("");
    const formVisible = ui.boolean(true, { clientWritable: false });
    const cancelVisible = ui.boolean(false, { clientWritable: false });
    const retryVisible = ui.boolean(false, { clientWritable: false });
    const playVisible = ui.boolean(false, { clientWritable: false });

    let jobId: string | undefined;
    let payload: Uint8Array | undefined;
    let savedRef: MusicRef | undefined;
    let startedAt = 0;
    let timer: number | undefined;
    let polling = false;
    let submitting = false;

    const stopPolling = () => {
        if (timer !== undefined) {
            system.clearRun(timer);
            timer = undefined;
        }
    };

    const resetForm = (message: string) => {
        stopPolling();
        if (jobId) sessions.delete(player.id);
        jobId = undefined;
        payload = undefined;
        formVisible.setData(true);
        cancelVisible.setData(false);
        retryVisible.setData(false);
        progress.setData("");
        status.setData(message);
    };

    const save = () => {
        if (!payload) return;
        if (!piano.isAlive() || !player.isValid) {
            status.setData("§c钢琴或玩家已不可用，数据未保存。");
            retryVisible.setData(true);
            return;
        }
        if (!canImportMidi(player)) {
            status.setData("§c管理员已关闭玩家导入，数据未保存。");
            retryVisible.setData(true);
            return;
        }
        const current = piano.cardAccess;
        if (!current || (cardUid !== undefined && current.uid !== cardUid)) {
            status.setData("§c存储卡已取出或被替换，数据未保存。");
            retryVisible.setData(true);
            return;
        }
        try {
            const entry = current.storage().save(payload);
            current.refreshLore();
            savedRef = storageRef(entry, current.uid);
            const usage = current.storage().usage();
            let message =
                `§a已存入存储卡：§f${entry.name}\n` +
                `§7占用 §f${formatBytes(entry.bytes)}§7 · 已用 §f${formatBytes(usage.usedBytes)}` +
                `§7 / §f${formatBytes(usage.limitBytes)}`;
            try {
                const warning = formatVoiceLoadWarning(estimatePbe3VoiceLoad(payload));
                if (warning) message += `\n§e${warning}`;
            } catch {
                // 负载估算失败不影响已保存的结果
            }
            if (jobId) sessions.delete(player.id);
            jobId = undefined;
            payload = undefined;
            stopPolling();
            formVisible.setData(true);
            cancelVisible.setData(false);
            retryVisible.setData(false);
            playVisible.setData(true);
            progress.setData("");
            status.setData(message);
            player.sendMessage(`§a[转录导入] 已存入存储卡：${entry.name}`);
        } catch (error) {
            status.setData(`§c保存失败：${errorMessage(error)}`);
            retryVisible.setData(true);
        }
    };

    const complete = async () => {
        if (!jobId) return;
        const client = getOnlineTranscribe();
        if (!client) {
            status.setData("§c后端未配置，无法获取转录结果。");
            resetForm("§c后端未配置。");
            return;
        }
        try {
            status.setData("§7转录完成，正在获取 PBE3…");
            const song = await client.getSong(jobId);
            if (!player.isValid) return;
            payload = song.pbe3;
            save();
        } catch (error) {
            status.setData(`§c获取转录结果失败：${errorMessage(error)}`);
            retryVisible.setData(true);
        }
    };

    const poll = async () => {
        if (!jobId || polling || ui.closed || !player.isValid) return;
        const client = getOnlineTranscribe();
        if (!client) {
            resetForm("§c后端未配置。");
            return;
        }
        if (Date.now() - startedAt > JOB_WAIT_MS) {
            resetForm("§c等待转录超时，请稍后重试。");
            return;
        }
        polling = true;
        try {
            const job = await client.getJob(jobId);
            if (ui.closed || !player.isValid) return;
            progress.setData(jobProgressText(job));
            if (job.stage === "error") {
                resetForm(`§c转录失败：${job.error ?? "未知错误"}`);
                return;
            }
            if (job.stage === "done") {
                stopPolling();
                await complete();
            }
        } catch (error) {
            if (!ui.closed) status.setData(`§e状态查询失败：${errorMessage(error)}（继续重试）`);
        } finally {
            polling = false;
        }
    };

    const startPolling = () => {
        stopPolling();
        timer = system.runInterval(() => {
            void poll();
        }, POLL_TICKS);
        void poll();
    };

    const submit = async () => {
        if (submitting) return;
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
        retryVisible.setData(false);
        playVisible.setData(false);
        status.setData("§7正在提交转录任务…");
        progress.setData("");
        try {
            const created = await client.startBilibili(value);
            if (!player.isValid) return;
            jobId = created.id;
            startedAt = Date.now();
            sessions.set(player.id, { jobId, input: value, startedAt, cardUid });
            cancelVisible.setData(true);
            status.setData("§a已提交，等待后端队列处理。");
            startPolling();
        } catch (error) {
            status.setData(`§c提交失败：${errorMessage(error)}`);
            formVisible.setData(true);
        } finally {
            submitting = false;
        }
    };

    const cancel = () => {
        const id = jobId;
        resetForm("§7已停止等待。服务端任务可能仍在运行，结果不会自动写入。");
        if (id) {
            void getOnlineTranscribe()?.cancel(id).catch(() => {
                // read 令牌通常无删除权限，忽略
            });
        }
    };

    // 恢复关闭页面前的任务
    const saved = sessions.get(player.id);
    if (saved && saved.cardUid !== cardUid) {
        sessions.delete(player.id);
        status.setData("§e上次转录发起后存储卡已更换，已取消恢复。");
    } else if (saved && Date.now() - saved.startedAt <= JOB_WAIT_MS) {
        jobId = saved.jobId;
        startedAt = saved.startedAt;
        formVisible.setData(false);
        cancelVisible.setData(true);
        status.setData(`§e正在继续上次的转录：§f${saved.input}`);
        startPolling();
    } else if (saved) {
        sessions.delete(player.id);
    }

    const usage = storage.usage();
    ui.label("§b从 B 站转录导入存储卡");
    ui.label("§7输入 BV 号或完整视频链接；转录完成后直接写入当前存储卡。");
    ui.label(
        `§7目标：§f${storage.label} §7· §f${formatBytes(usage.usedBytes)}§7 / §f${formatBytes(usage.limitBytes)}`
    );
    ui.textField("BV 号 / 视频链接", input).label(status).label(progress);
    ui.button("开始转录", () => void submit(), { visible: formVisible });
    ui.button("取消等待", cancel, { visible: cancelVisible });
    ui.button(
        "重试保存",
        () => {
            if (payload) save();
            else void complete();
        },
        { visible: retryVisible }
    );
    ui.button(
        "立即播放",
        () => {
            if (!savedRef || !piano.isAlive()) return;
            void piano
                .getMidiPlayer()
                .playNow(savedRef)
                .catch((error) => status.setData(`§c播放失败：${errorMessage(error)}`));
        },
        { visible: playVisible }
    );
    ui.closeButton();

    ui.onClose(() => {
        // 任务号保留在 sessions 里，重新打开本页可继续等待。
        stopPolling();
    });
});
