import { Player } from "@minecraft/server";
import { DDUI } from "sapi-pro";
import { canImportMidi, isPbeAdmin } from "@app/permissions";
import { midiManager, importedMidiManager, importedSongs } from "@app/midi";
import { ImportAssembler, parseImportChunk, type ImportProgress } from "@piano/core";

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

/**
 * DDUI MIDI 导入：
 * - 每段一次粘贴（单段建议 ≤4800 字符）；
 * - ImportAssembler 自动识别任务、支持乱序/重复/中断续传；
 * - 提交前再次校验权限、频率、PBE2 完整性与世界容量。
 *
 * 输入框订阅、清空定时器随页面自动释放；跨表单进度保存在模块级 sessions 里。
 */
export const MidiImportPage = DDUI.page("导入 MIDI", (ui) => {
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

    const assembler = () => session.assembler;
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

        try {
            const record = importedSongs.save(payload);
            session.pendingPayload = undefined;
            session.activeTaskId = undefined;
            recordSubmit(player.id);
            // 刷新元信息注册表，让本地导入列表立即可见。
            midiManager.addSource(importedSongs);
            void importedMidiManager.refresh();
            status.setData(`§a导入成功：§f${record.name}`);
            progress.setData(
                `§7曲目 id §f${record.id}  §7音符 §f${record.noteCount}  §7大小 §f${(record.bytes / 1024).toFixed(1)}KB`
            );
            player.sendMessage(`§a[MIDI] 已导入本地曲库：${record.name}`);
        } catch (error) {
            status.setData(`§c保存失败：${(error as Error).message}`);
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

        // 同一时间只保留一首曲目的导入任务：检测到不同曲目时丢弃上一首未完成分片。
        const chunk = parseImportChunk(value);
        const nextTaskId = chunk ? `${chunk.songId}:${chunk.checksum}` : undefined;
        let switched = false;
        if (nextTaskId && session.activeTaskId && nextTaskId !== session.activeTaskId) {
            assembler().reset();
            session.pendingPayload = undefined;
            switched = true;
        }
        if (nextTaskId) session.activeTaskId = nextTaskId;

        const result = assembler().add(value);
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
    const received = assembler().progress();
    if (session.pendingPayload) {
        status.setData("§e有已接收但未保存的曲目，可点击重试保存");
    } else if (received.received > 0) {
        status.setData("§e已恢复上次未完成的分段，请继续粘贴");
    } else if (isPbeAdmin(player)) {
        status.setData("§7管理员导入：粘贴分段即可");
    }
    progress.setData(progressText(received));

    ui.onChange(input, onInput);

    ui.label(status)
        .label(progress)
        .label("§7把生成器导出的分段逐段粘贴到下面（可乱序，重复段会自动忽略）")
        .textField("导入码", input)
        .button("重试保存已接收的曲目", () => {
            if (session.pendingPayload) commit(session.pendingPayload);
            else status.setData("§7没有待保存的数据");
        })
        .button("清空本次导入进度", () => {
            assembler().reset();
            session.pendingPayload = undefined;
            session.activeTaskId = undefined;
            status.setData("§7已清空未完成的分段");
            progress.setData("尚未接收任何分段");
        })
        .closeButton();
});

/** 打开导入页面；权限、会话进度与频率限制继续由本模块负责。 */
export function openMidiImport(player: Player) {
    if (!player.isValid) return;
    if (!canImportMidi(player)) {
        player.sendMessage("§e管理员未开放玩家导入 MIDI。");
        return;
    }
    DDUI.open(player, MidiImportPage);
}
