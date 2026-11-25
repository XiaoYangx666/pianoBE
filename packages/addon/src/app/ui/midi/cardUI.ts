import { DDUI } from "sapi-pro";
import { formatBytes } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { storageRef } from "@domain/music/storage";
import { cardName } from "@platform/storage/cardItem";
import { PAGE_SIZE, pageCount } from "./shared";

export interface MusicCardArgs {
    piano: PianoRuntime;
}

/**
 * 存储卡管理：卡片属性、整卡播放与播放顺序。
 *
 * 单曲浏览、删除和复制仍在音乐曲库；这里只处理“整张卡”和卡片自身操作。
 */
export const MusicCardPage = DDUI.page<MusicCardArgs>("音乐存储卡", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const title = ui.string("");
    const status = ui.string("");
    const usage = ui.string("");
    const rename = ui.string("");
    const hasSongs = ui.boolean(false, { clientWritable: false });
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
            hasSongs.setData(false);
            return;
        }
        const storage = access.storage();
        const stat = storage.usage();
        const over = stat.usedBytes > stat.limitBytes ? " §c（已超出上限，仅可读取/删除）" : "";
        title.setData(`§b${cardName(item)}`);
        usage.setData(`§7歌曲 §f${stat.songs} §7首 · §f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}${over}`);
        hasSongs.setData(storage.list().length > 0);
    };

    const afterChange = (message: string) => {
        piano.refreshCardIndicator();
        status.setData(message);
        refresh();
    };

    const cardRefs = () => {
        const access = piano.cardAccess;
        const storage = access?.storage();
        if (!access || !storage) return undefined;
        const entries = storage.list();
        if (!entries.length) return undefined;
        return entries.map(entry => storageRef(entry, access.uid));
    };

    ui.label(title).label(usage).label("§8与物品栏实体卡同步").label(status);
    ui.textField("重命名", rename);

    ui.button("▶ 播放整张存储卡", () => {
        if (!piano.isAlive()) return ui.close();
        const refs = cardRefs();
        if (!refs) return status.setData("§e存储卡里还没有歌曲");
        void piano.getMidiPlayer().playCollection(refs)
            .then(result => status.setData(`§a按存储卡顺序播放（新增 ${result?.added ?? 0} 首）`))
            .catch(error => status.setData(`§c播放失败：${(error as Error)?.message ?? error}`));
    }, { visible: hasSongs });

    ui.button("＋ 整卡加入播放队列", () => {
        if (!piano.isAlive()) return ui.close();
        const refs = cardRefs();
        if (!refs) return status.setData("§e存储卡里还没有歌曲");
        const result = piano.getMidiPlayer().addCollectionToQueue(refs);
        status.setData(`§a已加入 §f${result.added} §a首，队列中已有 §f${result.exists} §a首`);
    }, { visible: hasSongs });

    ui.button("调整歌曲顺序", () => {
        if (!piano.isAlive()) return ui.close();
        ui.push(CardOrderPage, { piano });
    }, { visible: hasSongs });

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

    ui.closeButton();

    refresh();
});

interface CardOrderArgs {
    piano: PianoRuntime;
    page?: number;
}

/** 存储卡播放顺序管理：只调整顺序，不提供第二套歌曲浏览/播放页面。 */
const CardOrderPage = DDUI.page<CardOrderArgs>("存储卡顺序", (ui, args) => {
    const piano = args.piano;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const openedUid = piano.cardAccess?.uid;
    const matchesOpenedCard = () => !!openedUid && piano.cardAccess?.uid === openedUid;
    const state = { page: Math.max(1, args.page ?? 1), maxPage: 1 };
    const persist = () => { args.page = state.page; };
    persist();
    const head = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(false, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });
    const entries = () => matchesOpenedCard() ? piano.cardStorage?.list() ?? [] : [];

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        persist();
        const list = entries();
        state.maxPage = pageCount(list.length);
        if (state.page > state.maxPage) {
            state.page = state.maxPage;
            persist();
        }
        head.setData(!matchesOpenedCard() ? "§e存储卡已被取出或替换，请重新打开此页面" : list.length ? "§7点击歌曲后调整上移/下移；顺序会保存到存储卡" : "§e存储卡里没有歌曲");
        const start = (state.page - 1) * PAGE_SIZE;
        for (let slot = 0; slot < PAGE_SIZE; slot++) {
            const index = start + slot;
            const entry = list[index];
            visible[slot].setData(Boolean(entry));
            labels[slot].setData(entry ? `${index + 1}. ${entry.name}` : "");
        }
        pageText.setData(list.length ? `§7第 §f${state.page}§7 / §f${state.maxPage} §7页` : "");
        prevVisible.setData(state.page > 1);
        nextVisible.setData(state.page < state.maxPage);
    };

    ui.label(head).label(pageText);
    for (let slot = 0; slot < PAGE_SIZE; slot++) {
        ui.button(labels[slot], () => {
            const entry = entries()[(state.page - 1) * PAGE_SIZE + slot];
            if (!entry || !piano.isAlive() || !matchesOpenedCard()) return;
            ui.push(CardOrderItemPage, { piano, id: entry.id, cardUid: openedUid! });
        }, { visible: visible[slot] });
    }
    ui.button("◀ 上一页", () => { if (state.page > 1) { state.page--; refresh(); } }, { visible: prevVisible });
    ui.button("下一页 ▶", () => { if (state.page < state.maxPage) { state.page++; refresh(); } }, { visible: nextVisible });
    ui.button("返回", () => ui.back());
    ui.closeButton();

    refresh();
});

interface CardOrderItemArgs {
    piano: PianoRuntime;
    id: string;
    cardUid: string;
}

const CardOrderItemPage = DDUI.page<CardOrderItemArgs>("调整顺序", (ui, args) => {
    const { piano, id } = args;
    const matchesOpenedCard = () => piano.cardAccess?.uid === args.cardUid;
    const status = ui.string("");
    ui.subscribe(piano.disposedSignal, () => ui.close());
    const name = ui.string("");
    const position = ui.string("");

    const sync = () => {
        if (!piano.isAlive() || ui.closed) return;
        if (!matchesOpenedCard()) {
            name.setData("§e存储卡已被替换，请重新打开顺序管理");
            position.setData("");
            return;
        }
        const list = piano.cardStorage?.list() ?? [];
        const index = list.findIndex(entry => entry.id === id);
        if (index < 0) {
            name.setData("§7歌曲已不在存储卡中");
            position.setData("");
            return;
        }
        name.setData(`§b${list[index].name}`);
        position.setData(`§7位置：§f${index + 1} §7/ §f${list.length}`);
    };

    const move = (delta: number) => {
        if (!matchesOpenedCard()) return status.setData("§c存储卡已被替换，操作已取消");
        const storage = piano.cardStorage;
        if (!storage) return status.setData("§c存储卡已不在卡槽中");
        try {
            status.setData(storage.move?.(id, delta) ? (delta < 0 ? "§a已上移" : "§a已下移") : "§e已经到边界了");
            sync();
        } catch (error) {
            status.setData(`§c${(error as Error)?.message ?? error}`);
        }
    };

    ui.label(name).label(position).label(status);
    ui.button("上移", () => move(-1));
    ui.button("下移", () => move(1));
    ui.button("完成", () => ui.back());
    ui.closeButton();

    sync();
});
