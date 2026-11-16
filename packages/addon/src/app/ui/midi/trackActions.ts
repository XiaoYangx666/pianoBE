import { DDUI } from "sapi-pro";
import { formatBytes, musicSourceLabel, type MusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";

export interface TrackActionArgs {
    piano: PianoRuntime;
    ref: MusicRef;
}

function formatDuration(duration: number): string {
    const seconds = Math.max(0, Math.floor(duration / 40));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 歌曲详情：展示元信息，并按来源动态提供有效操作。 */
export const TrackActionsPage = DDUI.page<TrackActionArgs>("歌曲详情", (ui, args) => {
    const { piano, ref } = args;
    const player = ui.player;
    const status = ui.string("");
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const alive = () => piano.isAlive() && player.isValid;
    const fail = (error: unknown) => status.setData(`§c${(error as Error)?.message ?? error}`);

    const canCopy = ui.boolean(ref.source === "library" && Boolean(piano.cardAccess), { clientWritable: false });
    const canDelete = ui.boolean(ref.source === "card", { clientWritable: false });

    ui.label(`§b${ref.name}`);
    ui.label(`§7来源：§f${musicSourceLabel(ref.source)}`);
    ui.label(`§7时长：§f${formatDuration(ref.duration)}`);
    ui.label(`§7音符：§f${ref.noteCount !== undefined ? ref.noteCount : "未知"}`);
    ui.label(`§7大小：§f${ref.bytes !== undefined ? formatBytes(ref.bytes) : "未知"}`);
    ui.label(status);

    ui.button("▶ 立即播放", () => {
        if (!alive()) return ui.close();
        void piano.getMidiPlayer().playNow(ref)
            .then(() => status.setData("§a开始播放"))
            .catch(fail);
    });

    ui.button("＋ 加入播放队列", () => {
        if (!alive()) return ui.close();
        const result = piano.getMidiPlayer().addToQueue(ref);
        status.setData(result === "added" ? "§a已加入播放队列" : "§e队列中已有这首歌");
    });

    ui.button("复制到存储卡", () => {
        if (!alive()) return ui.close();
        const card = piano.cardAccess;
        if (!card) {
            status.setData("§c卡槽为空，先插入一张音乐存储卡");
            return;
        }
        void Promise.resolve(piano.readBytes(ref)).then(bytes => {
            if (!bytes) throw new Error("源曲目已不可用");
            const storage = card.storage();
            const entry = storage.save(bytes);
            card.refreshLore();
            status.setData(`§a已复制到存储卡：${entry.name}`);
        }).catch(fail);
    }, { visible: canCopy });

    ui.button("删除歌曲", () => {
        if (!alive()) return ui.close();
        ui.push(ConfirmDeletePage, { piano, ref });
    }, { visible: canDelete });

    ui.closeButton();
});

const ConfirmDeletePage = DDUI.page<TrackActionArgs>("确认删除", (ui, args) => {
    const { piano, ref } = args;
    const status = ui.string("");
    ui.label("§e确定从存储卡删除：");
    ui.label(`§f${ref.name}`);
    ui.label(status);
    ui.button("确认删除", () => {
        const card = piano.cardAccess;
        if (!card) return status.setData("§c存储卡已不在卡槽中");
        if (ref.cardUid && card.uid && ref.cardUid !== card.uid) {
            return status.setData("§c存储卡已被替换，已取消删除");
        }
        const removed = card.storage().remove(ref.id);
        if (removed) {
            card.refreshLore();
            status.setData("§a已删除");
            ui.back();
            return;
        }
        status.setData("§e曲目已不存在");
    });
    ui.button("取消", () => ui.back());
});
