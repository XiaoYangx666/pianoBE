import { DDUI } from "sapi-pro";
import { formatBytes } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { cardName } from "@platform/storage/cardItem";

export interface MusicCardArgs {
    piano: PianoRuntime;
}

/**
 * 存储卡管理：只处理卡片自身属性与设备操作。
 *
 * 歌曲浏览、删除和复制统一在音乐曲库；MIDI 导入统一在导入页面。
 * 状态完全来自卡槽里的真实 ItemStack，不使用独立布尔状态。
 */
export const MusicCardPage = DDUI.page<MusicCardArgs>("音乐存储卡", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const title = ui.string("");
    const status = ui.string("");
    const usage = ui.string("");
    const rename = ui.string("");
    const existing = piano.cardAccess?.item;
    if (existing) ui.set(rename, cardName(existing));

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        const access = piano.cardAccess;
        const item = access?.item;
        if (!access || !item) {
            title.setData("§7卡槽：§e未插卡");
            usage.setData("§7手持音乐存储卡右键钢琴即可插入。");
            status.setData("");
            return;
        }
        const stat = access.storage().usage();
        const over = stat.usedBytes > stat.limitBytes ? " §c（已超出上限，仅可读取/删除）" : "";
        title.setData(`§b${cardName(item)}`);
        usage.setData(`§7歌曲 §f${stat.songs} §7首 · §f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}${over}`);
    };

    const afterChange = (message: string) => {
        piano.refreshCardIndicator();
        status.setData(message);
        refresh();
    };

    ui.label(title).label(usage).label("§8卡槽与物品栏中的实体卡实时同步").label(status);
    ui.textField("重命名（输入后点保存）", rename);

    ui.button("保存名称", () => {
        const access = piano.cardAccess;
        if (!access) return status.setData("§c卡槽为空");
        try {
            access.rename(rename.getData());
            afterChange("§a卡片已重命名");
        } catch (error) {
            status.setData(`§c${(error as Error)?.message ?? error}`);
        }
    });

    ui.button("弹出存储卡", () => {
        const ejected = piano.cardSlot?.ejectTo(player);
        if (!ejected) return status.setData("§e卡槽里没有存储卡");
        afterChange(ejected.delivered ? "§a已取回存储卡" : "§e背包已满，卡片掉在脚下");
    });

    ui.button("刷新", refresh);
    ui.closeButton();

    refresh();
});
