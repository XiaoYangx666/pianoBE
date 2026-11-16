import { DDUI } from "sapi-pro";
import { formatBytes, type MusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { TrackActionsPage } from "./trackActions";
import {
    PAGE_SIZE,
    TAB_LABELS,
    TAB_ORDER,
    formatLibrarySearch,
    listTab,
    pageCount,
    parseLibrarySearch,
    sourceMark,
    type LibraryTab,
} from "./shared";

export type LibraryMode = "manage" | "add";

export interface LibraryArgs {
    piano: PianoRuntime;
    /** 打开时聚焦的来源 */
    tab?: LibraryTab;
    /** 打开时带入的搜索关键词（不含页码指令） */
    query?: string;
    /** 打开时所在页（从歌曲详情返回时保持） */
    page?: number;
    /** 管理模式进入歌曲详情；添加模式点击直接加入播放队列 */
    mode?: LibraryMode;
}

/** 远程曲库搜索防抖（4 tick = 200ms） */
const SEARCH_DEBOUNCE_TICKS = 4;

/**
 * 统一音乐曲库：公共曲库 / 当前存储卡。
 *
 * 管理模式点击进入歌曲详情；添加模式点击直接加入播放队列并留在当前页。
 * 来源、搜索词与页码写回 args，进入歌曲详情再返回时状态不丢。
 */
export const MusicLibraryPage = DDUI.page<LibraryArgs>("音乐曲库", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const mode: LibraryMode = args.mode ?? "manage";
    const state = {
        tab: (args.tab === "card" || args.tab === "library" ? args.tab : "library") as LibraryTab,
        page: Math.max(1, args.page ?? 1),
        query: args.query ?? "",
        request: 0,
        refs: [] as MusicRef[],
        total: 0,
        maxPage: 1,
    };
    /** 把当前浏览状态写回页面上下文，返回时按原状态重建。 */
    const persist = () => {
        args.tab = state.tab;
        args.query = state.query;
        args.page = state.page;
    };
    persist();

    const source = ui.number(TAB_ORDER.indexOf(state.tab));
    const search = ui.string(formatLibrarySearch(state.query, state.page));
    const status = ui.string("§7正在读取…");
    const notice = ui.string("");
    const usage = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(true, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });
    let cancelDebounce: (() => void) | undefined;

    const syncSearch = () => ui.set(search, formatLibrarySearch(state.query, state.page));

    const renderLabels = () => {
        if (!piano.isAlive() || ui.closed) return;
        const queue = piano.getMidiPlayer().queue;
        for (let index = 0; index < PAGE_SIZE; index++) {
            const ref = state.refs[index];
            visible[index].setData(Boolean(ref));
            if (!ref) {
                labels[index].setData("");
                continue;
            }
            const added = mode === "add" && queue.indexOf(ref) >= 0;
            // 按钮文本不支持格式化符号，只放纯文本。
            labels[index].setData(`${added ? "✓ " : ""}${sourceMark(ref)} ${ref.name}`);
        }
    };

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        cancelDebounce?.();
        cancelDebounce = undefined;
        persist();
        const request = ++state.request;
        const page = state.page;
        status.setData("§7正在读取…");
        void listTab(piano, state.tab, page, state.query).then((result) => {
            if (request !== state.request || ui.closed || !player.isValid) return;
            state.total = result.total;
            state.maxPage = pageCount(result.total);
            // 数据源收缩（删除/换卡/筛选变化）时回到有效页并重新取。
            if (page > state.maxPage) {
                state.page = state.maxPage;
                persist();
                syncSearch();
                refresh();
                return;
            }
            state.refs = result.refs;
            renderLabels();
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
        if (state.tab === "library") {
            usage.setData("§7公共曲库提供歌曲浏览与播放，只读，不能删除或覆盖。");
            return;
        }
        const storage = piano.cardStorage;
        if (!storage) {
            usage.setData("§7卡槽：§e未插卡");
            return;
        }
        const stat = storage.usage();
        const over = stat.usedBytes > stat.limitBytes ? " §c（已超出上限，仅可读取/删除）" : "";
        usage.setData(
            `§7${storage.label}：§f${stat.songs} §7首 · §f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}${over}`
        );
    };

    const scheduleRefresh = () => {
        cancelDebounce?.();
        cancelDebounce = undefined;
        if (state.tab !== "library") {
            refresh();
            return;
        }
        cancelDebounce = ui.timeout(() => {
            cancelDebounce = undefined;
            refresh();
        }, SEARCH_DEBOUNCE_TICKS);
    };

    ui.onChange(source, (index) => {
        state.tab = TAB_ORDER[index] ?? "library";
        state.page = 1;
        persist();
        syncSearch();
        notice.setData("");
        refresh();
    });

    ui.dropdown("来源", source, TAB_ORDER.map(tab => ({ label: TAB_LABELS[tab], value: TAB_ORDER.indexOf(tab) })));
    ui.textField("搜索 / 跳页（如 周杰伦 p5）", search);
    ui.label(status).label(usage).label(notice);
    ui.label(pageText);

    // 监听搜索框内容变化，自动更新结果；末尾 p数字 作为页码指令。
    ui.onChange(search, (value) => {
        const parsed = parseLibrarySearch(value);
        state.query = parsed.query;
        state.page = parsed.page ?? 1;
        persist();
        notice.setData("");
        scheduleRefresh();
    });

    ui.label(mode === "add" ? "§7添加模式：点击歌曲直接加入播放队列，可连续添加" : "§7管理模式：点击歌曲查看详情与单曲操作");

    for (let index = 0; index < PAGE_SIZE; index++) {
        ui.button(labels[index], () => {
            const ref = state.refs[index];
            if (!ref || !piano.isAlive()) return;
            if (mode === "add") {
                const result = piano.getMidiPlayer().addToQueue(ref);
                notice.setData(result === "added" ? `§a已加入队列：§f${ref.name}` : `§e队列中已有：§f${ref.name}`);
                renderLabels();
                return;
            }
            ui.push(TrackActionsPage, { piano, ref });
        }, { visible: visible[index] });
    }

    ui.button("◀ 上一页", () => {
        if (state.page <= 1) return;
        state.page--;
        persist();
        syncSearch();
        refresh();
    }, { visible: prevVisible });
    ui.button("下一页 ▶", () => {
        if (state.page >= state.maxPage) return;
        state.page++;
        persist();
        syncSearch();
        refresh();
    }, { visible: nextVisible });
    ui.button("刷新", () => {
        notice.setData("");
        refresh();
    });
    ui.closeButton();

    refresh();
});
