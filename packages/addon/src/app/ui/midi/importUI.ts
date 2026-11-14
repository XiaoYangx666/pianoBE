import { DDUI } from "sapi-pro";
import { Player } from "@minecraft/server";
import { formatBytes, ImportAssembler, parseImportChunk, type ImportProgress } from "@piano/core";
import type { MusicStorage } from "@domain/music/storage";
import { canImportMidi, isPbeAdmin } from "@app/permissions";
import { midiManager, importedMidiManager, importedSongs } from "@app/midi";
import type { PianoRuntime } from "@app/PianoRuntime";
import { CardAccess, isMusicCard, mainhandItemSlot } from "@platform/storage/cardItem";
import { backButton } from "../ddui";

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

type ImportTarget = "piano" | "card" | "held" | "legacy";

const TARGETS: { key: ImportTarget; label: string }[] = [
    { key: "piano", label: "当前钢琴内置存储" },
    { key: "card", label: "已插入的存储卡" },
    { key: "held", label: "手中的存储卡" },
    { key: "legacy", label: "旧世界导入曲库" },
];

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
    target?: ImportTarget;
}

/**
 * DDUI MIDI 导入：
 * - 每段一次粘贴（单段建议 ≤4800 字符）；
 * - ImportAssembler 自动识别任务、支持乱序/重复/中断续传；
 * - 提交时按选择的真实存储写入（钢琴 / 卡槽卡 / 手持卡 / 旧导入曲库）。
 */
export const MidiImportPage = DDUI.page<MidiImportArgs>("导入 MIDI", (ui, args) => {
    const player = ui.player;
    if (!canImportMidi(player)) {
        player.sendMessage("§e管理员未开放玩家导入 MIDI。");
        ui.close();
        return;
    }

    const session = sessionOf(player.id);
    const status = ui.string("§7请粘贴第一段导入码", { clientWritable: false });
    const progress = ui.string("", { clientWritable: false });
    const input = ui.string("");
    const target = ui.number(Math.max(0, TARGETS.findIndex(item => item.key === (args.target ?? "piano"))));

    const currentTarget = () => TARGETS[target.getData()]?.key ?? "piano";

    /** 解析目标存储；返回存储或可直接展示的错误。 */
    const resolveStorage = (): { storage?: MusicStorage; label: string; refresh?: () => void } => {
        const kind = currentTarget();
        if (kind === "legacy") return { storage: undefined, label: "旧导入曲库" };
        if (kind === "piano") {
            const storage = args.piano?.storage;
            return storage ? { storage, label: storage.label } : { label: "", };
        }
        if (kind === "card") {
            const card = args.piano?.cardAccess;
            const storage = card?.storage();
            return storage ? { storage, label: `存储卡 ${storage.label}`, refresh: () => card?.refreshLore() } : { label: "" };
        }
        const slot = mainhandItemSlot(player);
        const card = slot ? CardAccess.open(slot) : undefined;
        if (!card || !isMusicCard(card.item)) return { label: "" };
        return { storage: card.storage(), label: "手持存储卡", refresh: () => card.refreshLore() };
    };

    const clearInput = () => ui.timeout(() => ui.set(input, ""), 1);

    const commit = (payload: Uint8Array) => {
        // 提交环节再次校验权限：关闭玩家导入后，未完成的任务也不能继续入库。
        if (!canImportMidi(player)) {
            status.setData("§c管理员已关闭玩家导入，本次数据不会保存（可开启后重试）");
            return;
        }
        const rate = checkRate(player);
        if (rate) {
            status.setData(`§c${rate}（数据已保留，可稍后重试保存）`);
            return;
        }

        const kind = currentTarget();
        try {
            let message: string;
            if (kind === "legacy") {
                const record = importedSongs.save(payload);
                midiManager.addSource(importedSongs);
                void importedMidiManager.refresh();
                message = `§a已存入旧导入曲库：§f${record.name}` +
                    `\n§7大小 §f${formatBytes(record.bytes)}`;
            } else {
                const resolved = resolveStorage();
                if (!resolved.storage) {
                    status.setData(kind === "held"
                        ? "§c手里没有音乐存储卡"
                        : kind === "card"
                            ? "§c卡槽为空，请先插入存储卡"
                            : "§c钢琴存储暂不可用");
                    return;
                }
                const entry = resolved.storage.save(payload);
                resolved.refresh?.();
                message = `§a已保存到 §f${resolved.label}§a：§f${entry.name}` +
                    `\n§7占用 §f${formatBytes(entry.bytes)}§7（含编码）· 存储已用 §f${formatBytes(resolved.storage.usage().usedBytes)}`;
            }
            session.pendingPayload = undefined;
            session.activeTaskId = undefined;
            recordSubmit(player.id);
            status.setData(message);
            progress.setData("");
            player.sendMessage(`§a[MIDI] 导入成功：${message.replace(/§./g, "").split("\n")[0]}`);
        } catch (error) {
            status.setData(`§c保存失败：${(error as Error).message ?? error}`);
            console.warn("[midiImport] 保存失败", error);
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

    const targetLabel = ui.computed([target], () => {
        const kind = currentTarget();
        if (kind === "piano") return args.piano?.storage
            ? `§7目标：§f${args.piano.storage.label}`
            : "§e目标：钢琴存储不可用";
        if (kind === "card") return args.piano?.cardStorage ? "§7目标：§f已插入的存储卡" : "§e目标：卡槽为空";
        if (kind === "held") return isMusicCard(mainhandItemSlot(player)?.read()) ? "§7目标：§f手中的存储卡" : "§e目标：手里没有存储卡";
        return "§7目标：§f旧世界导入曲库（兼容入口）";
    });

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

    ui.dropdown("保存到", target, TARGETS.map((item, index) => ({ label: item.label, value: index })));
    ui.label(targetLabel);
    ui.label(status)
        .label(progress)
        .label("§7把生成器导出的分段逐段粘贴到下面（可乱序，重复段会自动忽略）")
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
    backButton(ui);
    ui.closeButton();
});
