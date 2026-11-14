import type { MusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { musicSourceLabel } from "@piano/core";
import { appPage } from "../ddui";

export interface TrackActionArgs {
    piano: PianoRuntime;
    ref: MusicRef;
}

export const TrackActionsPage = appPage<TrackActionArgs>("歌曲操作", (ui, args) => {
    const { piano, ref } = args;
    const player = ui.player;
    const status = ui.string("");
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const alive = () => piano.isAlive() && player.isValid;
    const fail = (error: unknown) => status.setData(`§c${(error as Error)?.message ?? error}`);

    ui.label(`§b${ref.name}`);
    ui.label(`§7来源：§f${musicSourceLabel(ref.source)}　§7时长：§f${Math.floor(ref.duration / 40 / 60)}:${String(Math.floor(ref.duration / 40) % 60).padStart(2, "0")}`);
    ui.label(status);

    ui.button("▶ 立即播放", () => {
        if (!alive()) return ui.close();
        const midi = piano.getMidiPlayer();
        midi.queue.clear();
        midi.queue.insertBack(ref);
        void midi.play().catch(fail);
        status.setData("§a开始播放");
    });

    ui.button("＋ 加入播放队列", () => {
        if (!alive()) return ui.close();
        const queue = piano.getMidiPlayer().queue;
        const existing = queue.indexOf(ref);
        if (existing >= 0) {
            status.setData("§e队列中已有这首歌");
            return;
        }
        queue.enqueue(ref);
        status.setData("§a已加入队列");
    });

    ui.button("复制到钢琴", () => {
        if (!alive()) return ui.close();
        if (ref.source === "piano") {
            status.setData("§7这首歌已经在钢琴里");
            return;
        }
        const storage = piano.storage;
        if (!storage) {
            status.setData("§c钢琴存储暂不可用");
            return;
        }
        void Promise.resolve(piano.readBytes(ref)).then(bytes => {
            if (!bytes) throw new Error("源曲目已不可用（存储卡可能已被取走）");
            const entry = storage.save(bytes);
            status.setData(`§a已复制到钢琴：${entry.name}`);
        }).catch(fail);
    });

    ui.button("复制到存储卡", () => {
        if (!alive()) return ui.close();
        if (ref.source === "card") {
            status.setData("§7这首歌已经在存储卡里");
            return;
        }
        const card = piano.cardAccess;
        const storage = card?.storage();
        if (!card || !storage) {
            status.setData("§c卡槽为空，先插入一张音乐存储卡");
            return;
        }
        void Promise.resolve(piano.readBytes(ref)).then(bytes => {
            if (!bytes) throw new Error("源曲目已不可用");
            const entry = storage.save(bytes);
            card.refreshLore();
            status.setData(`§a已复制到存储卡：${entry.name}`);
        }).catch(fail);
    });

    ui.button("§c删除", () => {
        if (!alive()) return ui.close();
        if (ref.source === "library") {
            status.setData("§7曲库中的曲目不能在这里删除");
            return;
        }
        ui.push(ConfirmDeletePage, { piano, ref });
    });

    ui.button("返回", () => ui.back());
});

const ConfirmDeletePage = appPage<TrackActionArgs>("确认删除", (ui, args) => {
    const { piano, ref } = args;
    const status = ui.string("");
    ui.label(`§e确定从${ref.source === "card" ? "存储卡" : "钢琴"}删除：`);
    ui.label(`§f${ref.name}`);
    ui.label(status);
    ui.button("§c确认删除", () => {
        const storage = ref.source === "card" ? piano.cardStorage : piano.storage;
        if (!storage) return status.setData("§c存储已不可用");
        const removed = storage.remove(ref.id);
        status.setData(removed ? "§a已删除" : "§e曲目已不存在");
        const card = ref.source === "card" ? piano.cardAccess : undefined;
        if (removed) card?.refreshLore();
        ui.back();
    });
    ui.button("取消", () => ui.back());
});
