import { DDUI } from "sapi-pro";
import { formatBytes, type MusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { TrackActionsPage } from "./trackActions";
import { LegacyPlaylistPage } from "./legacyPlaylistUI";
import { backButton } from "../ddui";
import {
    PAGE_SIZE,
    TAB_LABELS,
    TAB_ORDER,
    clampPage,
    listTab,
    pageCount,
    sourceMark,
    type LibraryTab,
} from "./shared";

export interface LibraryArgs {
    piano: PianoRuntime;
    /** 打开时聚焦的来源 */
    tab?: LibraryTab;
    /** 打开时带入的搜索词 */
    query?: string;
}

/**
 * 统一音乐曲库：钢琴内置 / 存储卡 / 内置或远程曲库 / 旧导入曲库。
 *
 * DDUI 不支持动态增删控件，因此固定 8 个槽位用 Observable 更新文本与可见性；
 * 换页、搜索、切换来源都只刷新数据，不重建页面。
 */
export const MusicLibraryPage = DDUI.page<LibraryArgs>("音乐曲库", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const state = {
        tab: (args.tab ?? "piano") as LibraryTab,
        page: 1,
        query: args.query ?? "",
        request: 0,
        refs: [] as MusicRef[],
        total: 0,
        maxPage: 1,
    };

    const source = ui.number(TAB_ORDER.indexOf(state.tab));
    const search = ui.string(state.query);
    const status = ui.string("§7正在读取…");
    const usage = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(true, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        const request = ++state.request;
        const page = state.page;
        status.setData("§7正在读取…");
        void listTab(piano, state.tab, page, state.query).then((result) => {
            if (request !== state.request || ui.closed || !player.isValid) return;
            state.total = result.total;
            state.maxPage = pageCount(result.total);
            // 数据源收缩（删除/换卡/筛选变化）时回到最后一页并重新取。
            if (page > state.maxPage && state.maxPage >= 1 && result.refs.length === 0) {
                state.page = state.maxPage;
                refresh();
                return;
            }
            state.refs = result.refs;
            for (let index = 0; index < PAGE_SIZE; index++) {
                const ref = result.refs[index];
                visible[index].setData(Boolean(ref));
                labels[index].setData(ref ? `${sourceMark(ref)} ${ref.name}` : "");
            }
            const note = result.note ? `\n${result.note}` : "";
            status.setData(
                result.note
                    ? result.note
                    : result.total
                        ? `§7共 §f${result.total} §7首`
                        : "§7这个来源还没有歌曲"
            );
            pageText.setData(`§7第 §f${state.page}§7 / §f${state.maxPage} §7页${note}`);
            prevVisible.setData(state.page > 1);
            nextVisible.setData(state.page < state.maxPage);
            syncUsage();
        }).catch((error) => {
            if (request !== state.request) return;
            status.setData(`§c读取失败：${(error as Error)?.message ?? error}`);
        });
    };

    const syncUsage = () => {
        const storage = state.tab === "piano" ? piano.storage
            : state.tab === "card" ? piano.cardStorage
                : undefined;
        if (!storage) {
            usage.setData(state.tab === "card" ? "§7卡槽：§e未插卡" : "");
            return;
        }
        const stat = storage.usage();
        const over = stat.usedBytes > stat.limitBytes ? " §c（已超出上限，仅可读取/删除）" : "";
        usage.setData(
            `§7${storage.label}：§f${stat.songs} §7首 · §f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}${over}`
        );
    };

    ui.onChange(source, (index) => {
        state.tab = TAB_ORDER[index] ?? "piano";
        state.page = 1;
        refresh();
    });

    ui.dropdown("来源", source, TAB_ORDER.map(tab => ({ label: TAB_LABELS[tab], value: TAB_ORDER.indexOf(tab) })));
    ui.textField("搜索歌曲名", search);
    ui.label(status).label(usage);
    ui.button("搜索", () => {
        state.query = search.getData().trim();
        state.page = 1;
        refresh();
    });
    ui.label(pageText);

    for (let index = 0; index < PAGE_SIZE; index++) {
        ui.button(labels[index], () => {
            const ref = state.refs[index];
            if (!ref) return;
            ui.push(TrackActionsPage, { piano, ref });
        }, { visible: visible[index] });
    }

    ui.button("◀ 上一页", () => {
        if (state.page <= 1) return;
        state.page--;
        refresh();
    }, { visible: prevVisible });
    ui.button("下一页 ▶", () => {
        if (state.page >= state.maxPage) return;
        state.page++;
        refresh();
    }, { visible: nextVisible });
    ui.button("刷新", refresh);
    ui.button("旧播放列表（只读）", () => ui.push(LegacyPlaylistPage, { piano }));
    backButton(ui);
    ui.closeButton();

    refresh();
});
