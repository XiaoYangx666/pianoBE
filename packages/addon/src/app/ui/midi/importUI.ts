import { Player, system } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableString } from "@minecraft/server-ui";
import { DDUIManager } from "@app/ui/ddui";
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
 */
class MidiImportForm {
    private readonly form: CustomForm;
    private readonly status = new ObservableString("§7请粘贴第一段导入码");
    private readonly progress = new ObservableString("尚未接收任何分段");
    private readonly input: ObservableString;
    private readonly assembler = new ImportAssembler();
    /** 当前正在导入的曲目（songId:checksum）；切换曲目时丢弃上一首未完成分片 */
    private activeTaskId?: string;
    /** 已完整接收但暂时无法入库的数据（权限/频率/容量失败后可重试） */
    private pendingPayload?: Uint8Array;
    private opening = false;
    private clearing = false;

    constructor(private readonly player: Player) {
        const writable = { clientWritable: true };
        this.input = new ObservableString("", writable);

        this.form = new CustomForm(player, "导入 MIDI")
            .label(this.status)
            .label(this.progress)
            .label("§7把生成器导出的分段逐段粘贴到下面（可乱序，重复段会自动忽略）")
            .textField("导入码", this.input)
            .button("重试保存已接收的曲目", () => {
                if (this.pendingPayload) this.commit(this.pendingPayload);
                else this.status.setData("§7没有待保存的数据");
            })
            .button("清空本次导入进度", () => {
                this.assembler.reset();
                this.pendingPayload = undefined;
                this.activeTaskId = undefined;
                this.status.setData("§7已清空未完成的分段");
                this.progress.setData("尚未接收任何分段");
            })
            .closeButton();

        this.input.subscribe((value) => this.onInput(value));
    }

    private onInput(value: string) {
        if (this.clearing || !value.trim()) return;
        if (!this.player.isValid) return;

        if (!canImportMidi(this.player)) {
            this.status.setData("§c管理员已关闭玩家导入");
            this.clearInput();
            return;
        }

        // 同一时间只保留一首曲目的导入任务：检测到不同曲目时丢弃上一首未完成分片。
        const chunk = parseImportChunk(value);
        const nextTaskId = chunk ? `${chunk.songId}:${chunk.checksum}` : undefined;
        let switched = false;
        if (nextTaskId && this.activeTaskId && nextTaskId !== this.activeTaskId) {
            this.assembler.reset();
            this.pendingPayload = undefined;
            switched = true;
        }
        if (nextTaskId) this.activeTaskId = nextTaskId;

        const result = this.assembler.add(value);
        switch (result.status) {
            case "complete":
                this.status.setData("§a分段接收完成，正在校验并保存…");
                this.progress.setData(progressText(result));
                this.pendingPayload = result.payload;
                this.commit(result.payload!);
                break;
            case "error":
                this.status.setData(`§c${result.error ?? "导入码无效"}`);
                this.progress.setData(progressText(result));
                break;
            case "duplicate":
                this.status.setData("§e该分段已经接收，已自动忽略");
                this.progress.setData(progressText(result));
                break;
            case "ignored":
                this.status.setData("§e无法识别的文本，请确认粘贴的是完整分段");
                break;
            default:
                this.status.setData("§a已接收分段");
                this.progress.setData(progressText(result));
                break;
        }
        if (switched) {
            this.status.setData(
                `§e已切换到新曲目，上一首未完成的分段已丢弃\n${this.status.getData()}`
            );
        }
        this.clearInput();
    }

    private commit(payload: Uint8Array) {
        // 提交环节再次校验权限：关闭玩家导入后，未完成的任务也不能继续入库。
        if (!canImportMidi(this.player)) {
            this.status.setData("§c管理员已关闭玩家导入，本次数据不会保存（可开启后重试）");
            return;
        }
        const rate = checkRate(this.player);
        if (rate) {
            this.status.setData(`§c${rate}（数据已保留，可稍后重试保存）`);
            return;
        }

        try {
            const record = importedSongs.save(payload);
            this.pendingPayload = undefined;
            this.activeTaskId = undefined;
            recordSubmit(this.player.id);
            // 刷新元信息注册表，让本地导入列表立即可见。
            midiManager.addSource(importedSongs);
            void importedMidiManager.refresh();
            this.status.setData(`§a导入成功：§f${record.name}`);
            this.progress.setData(
                `§7曲目 id §f${record.id}  §7音符 §f${record.noteCount}  §7大小 §f${(record.bytes / 1024).toFixed(1)}KB`
            );
            this.player.sendMessage(`§a[MIDI] 已导入本地曲库：${record.name}`);
        } catch (error) {
            this.status.setData(`§c保存失败：${(error as Error).message}`);
            console.warn("[midiImport] 保存失败", error);
        }
    }

    private clearInput() {
        this.clearing = true;
        system.runTimeout(() => {
            if (this.player.isValid) this.input.setData("");
            this.clearing = false;
        }, 1);
    }

    async show() {
        if (this.opening || this.form.isShowing()) return;
        this.opening = true;
        try {
            if (!canImportMidi(this.player)) {
                this.player.sendMessage("§e管理员未开放玩家导入 MIDI。");
                return;
            }
            if (isPbeAdmin(this.player)) {
                this.status.setData("§7管理员导入：粘贴分段即可");
            } else {
                this.status.setData("§7请粘贴第一段导入码");
            }
            this.progress.setData(progressText(this.assembler.progress()));
            for (let attempt = 0; attempt < 4 && this.player.isValid; attempt++) {
                if ((await this.form.show()) !== DataDrivenScreenClosedReason.UserBusy) return;
                await system.waitTicks(2);
            }
        } finally {
            this.opening = false;
        }
    }

    close() {
        if (this.player.isValid && this.form.isShowing()) this.form.close();
    }
}

class MidiImportManager extends DDUIManager<MidiImportForm> {
    protected create(player: Player) {
        return new MidiImportForm(player);
    }
    protected discard(form: MidiImportForm) {
        form.close();
    }
}

export const midiImportManager = new MidiImportManager();

export async function openMidiImport(player: Player) {
    if (!player.isValid) return;
    if (!canImportMidi(player)) {
        player.sendMessage("§e管理员未开放玩家导入 MIDI。");
        return;
    }
    try {
        await midiImportManager.get(player).show();
    } catch (error) {
        console.warn("[midiImport] 打开导入界面失败", error);
        if (player.isValid) player.sendMessage("§e无法打开 MIDI 导入界面。");
    }
}
