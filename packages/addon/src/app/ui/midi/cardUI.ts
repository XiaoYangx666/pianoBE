import { DDUI } from "sapi-pro";
import { formatBytes, type MusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { consumeHeldCard } from "@app/components/musicCard";
import { cardName, isMusicCard, mainhandItemSlot } from "@platform/storage/cardItem";
import { MidiImportPage } from "./importUI";
import { MusicLibraryPage } from "./libraryUI";
import { TrackActionsPage } from "./trackActions";
import { PAGE_SIZE, pageCount, sourceMark } from "./shared";

export interface MusicCardArgs {
    piano: PianoRuntime;
}

/**
 * 存储卡管理：状态完全来自卡槽里的真实 ItemStack，不使用独立布尔状态。
 * 所有修改都可能被“玩家移走/替换卡片”打断，CardAccess 会拒绝写入错误物品。
 */
export const MusicCardPage = DDUI.page<MusicCardArgs>("音乐存储卡", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const state = { page: 1, refs: [] as MusicRef[], maxPage: 1 };
    const title = ui.string("");
    const status = ui.string("");
    const usage = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(false, { clientWritable: false }));
    const rename = ui.string("");
    const existing = piano.cardAccess?.item;
    if (existing) ui.set(rename, cardName(existing));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        const access = piano.cardAccess;
        const item = access?.item;
        if (!access || !item) {
            title.setData("§7卡槽：§e未插卡");
            usage.setData("§7手持音乐存储卡右键钢琴即可插入。");
            status.setData("");
            state.refs = [];
            for (let index = 0; index < PAGE_SIZE; index++) visible[index].setData(false);
            pageText.setData("");
            prevVisible.setData(false);
            nextVisible.setData(false);
            return;
        }
        const storage = access.storage();
        const stat = storage.usage();
        const over = stat.usedBytes > stat.limitBytes ? " §c（已超出上限，仅可读取/删除）" : "";
        title.setData(`§b${cardName(item)}`);
        usage.setData(`§7已存 §f${stat.songs} §7首 · §f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}${over}`);
        const entries = storage.list();
        state.maxPage = pageCount(entries.length);
        if (state.page > state.maxPage) state.page = state.maxPage;
        state.refs = entries
            .slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE)
            .map(entry => ({ id: entry.id, name: entry.name, duration: entry.duration, noteCount: entry.noteCount, bytes: entry.bytes, checksum: entry.checksum, source: "card" as const }));
        for (let index = 0; index < PAGE_SIZE; index++) {
            const ref = state.refs[index];
            visible[index].setData(Boolean(ref));
            labels[index].setData(ref ? `${sourceMark(ref)} ${ref.name}` : "");
        }
        pageText.setData(entries.length ? `§7第 §f${state.page}§7 / §f${state.maxPage} §7页` : "§7这张卡还是空的");
        prevVisible.setData(state.page > 1);
        nextVisible.setData(state.page < state.maxPage);
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

    ui.button("插入手中的卡", () => {
        const slot = mainhandItemSlot(player);
        const hand = slot?.read();
        if (!isMusicCard(hand)) return status.setData("§e请把音乐存储卡拿在主手");
        const cardSlot = piano.cardSlot;
        if (!cardSlot) return status.setData("§c卡槽暂不可用");
        const result = cardSlot.insert(hand);
        if (!result.ok) return status.setData(`§c${result.message}`);
        consumeHeldCard(player);
        afterChange("§a存储卡已插入");
    });

    ui.button("弹出存储卡", () => {
        const ejected = piano.cardSlot?.ejectTo(player);
        if (!ejected) return status.setData("§e卡槽里没有存储卡");
        afterChange(ejected.delivered ? "§a已取回存储卡" : "§e背包已满，卡片掉在脚下");
    });

    ui.button("导入 MIDI 到这张卡", () => ui.push(MidiImportPage, { piano, target: "card" }));
    ui.button("在曲库中浏览这张卡", () => ui.push(MusicLibraryPage, { piano, tab: "card" }));

    ui.label(pageText);
    for (let index = 0; index < PAGE_SIZE; index++) {
        ui.button(labels[index], () => {
            const ref = state.refs[index];
            if (!ref) return;
            ui.push(TrackActionsPage, { piano, ref });
        }, { visible: visible[index] });
    }
    ui.button("◀ 上一页", () => { if (state.page > 1) { state.page--; refresh(); } }, { visible: prevVisible });
    ui.button("下一页 ▶", () => { if (state.page < state.maxPage) { state.page++; refresh(); } }, { visible: nextVisible });
    ui.button("刷新", refresh);
    ui.closeButton();

    refresh();
});
