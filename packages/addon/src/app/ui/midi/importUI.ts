import { DDUI } from "sapi-pro";
import { Player } from "@minecraft/server";
import {
    estimatePbe3VoiceLoad,
    formatBytes,
    formatVoiceLoadWarning,
    ImportAssembler,
    parseImportChunk,
    type ImportProgress,
} from "@piano/core";
import { canImportMidi, isPbeAdmin } from "@app/permissions";
import type { PianoRuntime } from "@app/PianoRuntime";
import { midiManager } from "@app/midi";
import { worldLibrary } from "@platform/storage/worldLibrary";
import { createLogger } from "@runtime/log";

const log = createLogger("ui.import");

/** 同一玩家两次成功入库之间的最小间隔（毫秒） */
const SUBMIT_COOLDOWN_MS = 5_000;
/** 频率窗口：每 60 秒最多成功入库次数 */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;

const lastSubmit = new Map<string, number>();
const submitHistory = new Map<string, number[]>();

function checkRate(player: Player): string | undefined {
    const now = Date.now();
    const last = lastSubmit.get(player.id) ?? 0;
    if (now - last < SUBMIT_COOLDOWN_MS) {
        return `导入过于频繁，请 ${Math.ceil((SUBMIT_COOLDOWN_MS - (now - last)) / 1000)} 秒后再试`;
    }
    const history = (submitHistory.get(player.id) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    if (history.length >= RATE_LIMIT) return "本分钟导入次数已达上限，请稍后再试";
    return undefined;
}

function recordSubmit(playerId: string) {
    const now = Date.now();
    lastSubmit.set(playerId, now);
    submitHistory.set(
        playerId,
        [...(submitHistory.get(playerId) ?? []).filter((time) => now - time < RATE_WINDOW_MS), now]
    );
}

/** 跨表单保留的导入进度：关闭表单后重新打开仍可继续粘贴剩余分段。 */
interface ImportSession {
    assembler: ImportAssembler;
    /** 当前正在导入的曲目（songId:checksum）；切换曲目时丢弃上一首未完成分片 */
    activeTaskId?: string;
    /** 已完整接收但暂时无法入库的数据（权限/频率/容量失败后可重试） */
    pendingPayload?: Uint8Array;
}

const sessions = new Map<string, ImportSession>();

function sessionOf(playerId: string): ImportSession {
    let session = sessions.get(playerId);
    if (!session) {
        session = { assembler: new ImportAssembler() };
        sessions.set(playerId, session);
    }
    return session;
}

/** 玩家离开时清空导入进度与频率记录。 */
export function invalidateMidiImport(playerId: string) {
    sessions.delete(playerId);
    lastSubmit.delete(playerId);
    submitHistory.delete(playerId);
}

function progressText(progress: ImportProgress): string {
    if (progress.total === 0) return "尚未接收任何分段";
    const missing = progress.missing.length
        ? `\n§e缺少分段: ${progress.missing.slice(0, 12).join(", ")}${progress.missing.length > 12 ? "…" : ""}`
        : "";
    return `§7已接收 §a${progress.received}§7/§f${progress.total}§7 段${missing}`;
}

export interface MidiImportArgs {
    piano?: PianoRuntime;
    /** 默认写入当前存储卡；管理员管理页可显式导入世界全局曲库。 */
    target?: "card" | "world";
}

/**
 * DDUI MIDI 导入：
 * - 普通玩家只写入当前卡槽内的存储卡；管理员可显式写入世界全局曲库；
 * - 每段一次粘贴（单段建议 ≤4800 字符）；
 * - ImportAssembler 自动识别任务、支持乱序/重复/中断续传。
 *
 * 打开页面时绑定当时的 CardAccess；导入过程中换卡/拔卡会被其 UID 校验拒绝。
 */
export const MidiImportPage = DDUI.page<MidiImportArgs>("导入 MIDI", (ui, args) => {
    const player = ui.player;
    const target = args.target === "world" ? "world" : "card";
    if (target === "world" ? !isPbeAdmin(player) : !canImportMidi(player)) {
        player.sendMessage(target === "world"
            ? "§c只有管理员可以导入全局曲库。"
            : "§e管理员未开放玩家导入 MIDI。");
        ui.close();
        return;
    }

    const session = sessionOf(player.id);
    const status = ui.string("§7请粘贴第一段导入码", { clientWritable: false });
    const progress = ui.string("", { clientWritable: false });
    const input = ui.string("");

    // 存储卡导入在打开时检查并绑定卡片；全局曲库只允许管理员，无需插卡。
    const access = target === "card" ? args.piano?.cardAccess : undefined;
    if (target === "card" && (!args.piano || !access)) {
        status.setData("§c卡槽为空，请先插入音乐存储卡");
        ui.label(status);
        if (session.pendingPayload) ui.label("§e未保存的曲目已保留，插卡后重试");
        ui.closeButton();
        return;
    }
    const cardStorage = access?.storage();
    const targetLabel = target === "world"
        ? `${worldLibrary.label}（管理员）`
        : `${cardStorage!.label}（当前卡槽）`;

    const clearInput = () => ui.timeout(() => ui.set(input, ""), 1);

    const commit = (payload: Uint8Array) => {
        // 提交环节再次校验权限：关闭玩家导入后，未完成的任务也不能继续入库。
        if (target === "world" ? !isPbeAdmin(player) : !canImportMidi(player)) {
            status.setData("§c权限已变化，本次数据不会保存（可恢复后重试）");
            return;
        }
        if (target === "card" && !args.piano?.isAlive()) {
            status.setData("§c钢琴已不可用，本次数据不会保存");
            return;
        }
        if (target === "card") {
            const rate = checkRate(player);
            if (rate) {
                status.setData(`§c${rate}（数据已保留，可稍后重试保存）`);
                return;
            }
        }

        try {
            const entry = target === "world" ? worldLibrary.save(payload) : cardStorage!.save(payload);
            if (target === "world") {
                midiManager.refreshPublicIndex();
            } else {
                access!.refreshLore();
            }
            const usedBytes = target === "world" ? worldLibrary.usage().usedBytes : cardStorage!.usage().usedBytes;
            let message = target === "world"
                ? `§a已保存到全局曲库：§f${entry.name}` +
                    `\n§7占用 §f${formatBytes(entry.bytes)}§7（含编码）· 曲库已用 §f${formatBytes(usedBytes)}`
                : `§a已保存到存储卡 §f${targetLabel}§a：§f${entry.name}` +
                    `\n§7占用 §f${formatBytes(entry.bytes)}§7（含编码）· 存储已用 §f${formatBytes(usedBytes)}`;
            // 导入时顺带用离线模型估算同时发声峰值，超过引擎上限就提示（不阻止导入）。
            try {
                const warning = formatVoiceLoadWarning(estimatePbe3VoiceLoad(payload));
                if (warning) message += `\n§e${warning}`;
            } catch {
                // 负载估算失败不影响已完成的保存
            }
            session.pendingPayload = undefined;
            session.activeTaskId = undefined;
            recordSubmit(player.id);
            status.setData(message);
            progress.setData("");
            player.sendMessage(`§a[MIDI] 导入成功：${message.replace(/§./g, "").split("\n")[0]}`);
        } catch (error) {
            status.setData(`§c保存失败：${(error as Error).message ?? error}`);
            log.warn("保存导入曲目失败", error, { player: player.id });
        }
    };

    const onInput = (value: string) => {
        if (!value.trim() || !player.isValid) return;

        if (!canImportMidi(player)) {
            status.setData("§c管理员已关闭玩家导入");
            clearInput();
            return;
        }

        const chunk = parseImportChunk(value);
        const nextTaskId = chunk ? `${chunk.songId}:${chunk.checksum}` : undefined;
        let switched = false;
        if (nextTaskId && session.activeTaskId && nextTaskId !== session.activeTaskId) {
            session.assembler.reset();
            session.pendingPayload = undefined;
            switched = true;
        }
        if (nextTaskId) session.activeTaskId = nextTaskId;

        const result = session.assembler.add(value);
        switch (result.status) {
            case "complete":
                status.setData("§a分段接收完成，正在校验并保存…");
                progress.setData(progressText(result));
                session.pendingPayload = result.payload;
                commit(result.payload!);
                break;
            case "error":
                status.setData(`§c${result.error ?? "导入码无效"}`);
                progress.setData(progressText(result));
                break;
            case "duplicate":
                status.setData("§e该分段已经接收，已自动忽略");
                progress.setData(progressText(result));
                break;
            case "ignored":
                status.setData("§e无法识别的文本，请确认粘贴的是完整分段");
                break;
            default:
                status.setData("§a已接收分段");
                progress.setData(progressText(result));
                break;
        }
        if (switched) {
            status.setData(`§e已切换到新曲目，上一首未完成的分段已丢弃\n${status.getData()}`);
        }
        clearInput();
    };

    // 恢复上次未完成的进度
    const received = session.assembler.progress();
    if (session.pendingPayload) {
        status.setData("§e有已接收但未保存的曲目，可点击重试保存");
    } else if (received.received > 0) {
        status.setData("§e已恢复上次未完成的分段，请继续粘贴");
    } else if (isPbeAdmin(player)) {
        status.setData("§7管理员导入：粘贴分段即可");
    }
    progress.setData(progressText(received));

    ui.onChange(input, onInput);

    ui.label(`§7目标：§f${targetLabel}`);
    ui.label(status)
        .label(progress)
        .label("§7粘贴生成器导出的分段（可乱序）")
        .textField("导入码", input)
        .button("重试保存已接收的曲目", () => {
            if (session.pendingPayload) commit(session.pendingPayload);
            else status.setData("§7没有待保存的数据");
        })
        .button("清空本次导入进度", () => {
            session.assembler.reset();
            session.pendingPayload = undefined;
            session.activeTaskId = undefined;
            status.setData("§7已清空未完成的分段");
            progress.setData("尚未接收任何分段");
        });
    ui.closeButton();
});
