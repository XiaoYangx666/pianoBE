import { DDUI } from "sapi-pro";
import { formatBytes } from "@piano/core";
import { canImportMidi } from "@app/permissions";
import type { PianoRuntime } from "@app/PianoRuntime";
import type { TranscriptionManager, TranscriptionStage, TranscriptionTask } from "./manager";

/**
 * 在线转录页面（BDS 专用）。
 *
 * 页面只做三件事：提交、展示管理器状态、触发导入/取消。
 * 不持有任务 ID、不启动轮询、不在关闭时取消任务。
 */

export interface TranscribePageArgs {
    piano: PianoRuntime;
    manager: TranscriptionManager;
}

const STAGE_LABEL: Record<TranscriptionStage, string> = {
    submitting: "提交中",
    queued: "排队中",
    downloading: "解析并下载音频",
    analyzing: "分析音频",
    transcribing: "转录中",
    finalizing: "收尾",
    done: "转录完成",
    failed: "转录失败",
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function resultInfo(task: TranscriptionTask): string {
    const ticks = task.midiDuration ?? (task.durationSec !== undefined ? task.durationSec * 40 : undefined);
    const seconds = ticks !== undefined ? Math.max(0, Math.floor(ticks / 40)) : undefined;
    const duration = seconds !== undefined
        ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
        : "未知";
    return [
        `§b${task.name || "未命名曲目"}`,
        `§7时长：§f${duration}` +
            ` §7音符：§f${task.noteCount ?? "未知"}` +
            ` §7大小：§f${task.dataSize !== undefined ? formatBytes(task.dataSize) : "未知"}`,
    ].join("\n");
}

function progressInfo(task: TranscriptionTask): string {
    const stage = STAGE_LABEL[task.stage] ?? task.stage;
    const percent = task.percent >= 0 ? `${task.percent}%` : "处理中…";
    const message = task.message ? `\n§7${task.message}` : "";
    const title = task.name ? `§b${task.name}\n` : "";
    return `${title}§7状态：§f${stage} §7· §f${percent}${message}`;
}

export const TranscribePage = DDUI.page<TranscribePageArgs>("在线转录", (ui, args) => {
    const { piano, manager } = args;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const input = ui.string("");
    const status = ui.string("");
    const progress = ui.string("");
    const result = ui.string("");
    const target = ui.string("");

    const formVisible = ui.boolean(true, { clientWritable: false });
    const runningVisible = ui.boolean(false, { clientWritable: false });
    const doneVisible = ui.boolean(false, { clientWritable: false });
    const failedVisible = ui.boolean(false, { clientWritable: false });
    let submitting = false;

    const syncTarget = () => {
        const access = piano.cardAccess;
        if (!access) {
            target.setData("§7导入目标：§e当前未插入存储卡（转录不要求插卡，导入时再插入即可）");
            return;
        }
        const usage = access.storage().usage();
        target.setData(
            `§7导入目标：§f${access.storage().label}` +
                ` §7· §f${formatBytes(usage.usedBytes)}§7 / §f${formatBytes(usage.limitBytes)}`
        );
    };

    const render = (task?: TranscriptionTask) => {
        if (ui.closed || !player.isValid) return;
        syncTarget();
        const done = task?.stage === "done";
        const failed = task?.stage === "failed";
        formVisible.setData(!task);
        runningVisible.setData(Boolean(task) && !done && !failed);
        doneVisible.setData(done);
        failedVisible.setData(failed);

        if (!task || done || failed) {
            progress.setData(failed ? `§c${task!.error ?? "转录失败"}` : "");
            result.setData(done ? resultInfo(task!) : "");
            return;
        }
        progress.setData(progressInfo(task));
        result.setData("");
    };

    ui.subscribe(manager.changeSignal, ({ playerId, task }) => {
        if (playerId === player.id) render(task);
    });

    const submit = async () => {
        if (submitting) return;
        const value = input.getData().trim();
        if (!value) {
            status.setData("§e请先输入 BV 号或视频链接。");
            return;
        }
        if (!canImportMidi(player)) {
            status.setData("§c管理员未开放玩家转录/导入。");
            return;
        }
        submitting = true;
        status.setData("§7正在提交转录任务…");
        try {
            const result = await manager.submit(player.id, value);
            if (ui.closed || !player.isValid) return;
            status.setData(result.ok ? "§a已提交，可关闭页面继续游戏。" : `§c${result.reason}`);
        } finally {
            submitting = false;
        }
    };

    const importResult = async () => {
        const task = manager.get(player.id);
        if (!task || task.stage !== "done") return;
        if (!canImportMidi(player)) {
            status.setData("§c管理员已关闭玩家导入。");
            return;
        }
        if (!piano.isAlive()) {
            status.setData("§c钢琴已不可用，无法写入存储卡。");
            return;
        }
        const access = piano.cardAccess;
        if (!access) {
            status.setData("§c请先把音乐存储卡插入当前钢琴。");
            return;
        }
        const cardUid = access.uid;
        status.setData("§7正在获取转录结果并写入存储卡…");
        try {
            const { entry } = await manager.importToCard(player.id, {
                isUsable: () => player.isValid && piano.isAlive() && canImportMidi(player),
                cardUid: () => piano.cardAccess?.uid,
                save: (pbe3) => {
                    const current = piano.cardAccess;
                    if (!current) throw new Error("存储卡已不在卡槽中");
                    if (cardUid !== undefined && current.uid !== cardUid) {
                        throw new Error("存储卡已被替换，请重试导入");
                    }
                    const saved = current.storage().save(pbe3);
                    current.refreshLore();
                    piano.refreshCardIndicator();
                    return saved;
                },
                refresh: () => {},
            });
            if (ui.closed || !player.isValid) return;
            input.setData("");
            status.setData(`§a已存入存储卡：${entry.name}`);
        } catch (error) {
            if (!ui.closed && player.isValid) {
                status.setData(`§c${errorMessage(error)}；转录结果已保留，可换卡后重试。`);
            }
        }
    };

    const cancel = () => {
        if (manager.cancel(player.id)) status.setData("§7已取消转录任务。");
    };

    ui.label("§b在线转录");
    ui.label("§7输入 BV 号或视频链接，转录由服务器后台完成；关闭页面不会中断任务。");
    ui.label(target).label(status);
    ui.textField("BV 号 / 视频链接", input, { visible: formVisible });
    ui.button("开始转录", () => void submit(), { visible: formVisible });
    ui.label(progress, { visible: runningVisible });
    ui.label("§7可以关闭本页面继续游戏，稍后重新打开查看进度。", { visible: runningVisible });
    ui.button("取消任务", cancel, { visible: runningVisible });
    ui.label(result, { visible: doneVisible });
    ui.button("导入存储卡", () => void importResult(), { visible: doneVisible });
    ui.button("丢弃结果", () => {
        if (manager.cancel(player.id)) status.setData("§7已丢弃转录结果。");
    }, { visible: doneVisible });
    ui.label("§7失败结果保留在当前任务中；清除后可重新提交，不会自动重试。", { visible: failedVisible });
    ui.button("清除失败任务", cancel, { visible: failedVisible });
    ui.closeButton();

    render(manager.get(player.id));
});
