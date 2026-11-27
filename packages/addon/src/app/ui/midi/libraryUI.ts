import { DDUI } from "sapi-pro";
import { formatBytes, type MusicSelection } from "@piano/core";
import { midiManager } from "@app/midi";
import type { PianoRuntime } from "@app/PianoRuntime";
import { TrackActionsPage, withDefaultQueuePerformance } from "./trackActions";
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
    /** 公共曲库筛选的逻辑曲库 ID（空表示全部曲库） */
    libraryId?: string;
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
 * 保留「公共曲库 / 当前存储卡」两个顶层来源；进入公共曲库后提供逻辑曲库筛选，
 * 不把所有曲库直接堆叠在一级菜单。
 */
export const MusicLibraryPage = DDUI.page<LibraryArgs>("音乐曲库", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const mode: LibraryMode = args.mode ?? "manage";
    const cachedLibs = midiManager.listLibrariesSync?.() ?? [];
    const state = {
        tab: (args.tab === "card" || args.tab === "library" ? args.tab : "library") as LibraryTab,
        libraryId: args.libraryId ?? "",
        libraries: [...cachedLibs] as Array<{ id: string; name: string }>,
        page: Math.max(1, args.page ?? 1),
        query: args.query ?? "",
        request: 0,
        refs: [] as MusicSelection[],
        total: 0,
        maxPage: 1,
    };
    const persist = () => {
        args.tab = state.tab;
        args.libraryId = state.libraryId;
        args.query = state.query;
        args.page = state.page;
    };
    persist();

    const source = ui.number(TAB_ORDER.indexOf(state.tab));
    const selectedLibIndex = state.libraryId
        ? Math.max(0, state.libraries.findIndex((item) => item.id === state.libraryId) + 1)
        : 0;
    const libraryIndex = ui.number(selectedLibIndex);
    const showLibraries = ui.boolean(state.tab === "library" && state.libraries.length > 0, { clientWritable: false });
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

    const perfSuffix = (ref: MusicSelection): string => {
        if (ref.source !== "library") return "";
        const count = piano.performanceEntries?.(ref).filter((entry) => entry.id !== "plain").length ?? 0;
        if (count <= 0) return "";
        return count === 1 ? " · 演出" : ` · ${count}演出`;
    };

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
            const added = mode === "add" && queue.indexOf(withDefaultQueuePerformance(piano, ref)) >= 0;
            // 按钮文本不支持格式化符号，只放纯文本。
            labels[index].setData(`${added ? "✓ " : ""}${sourceMark(ref)} ${ref.name}${perfSuffix(ref)}`);
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
        void listTab(piano, state.tab, page, state.query, state.tab === "library" ? state.libraryId : undefined)
            .then((result) => {
                if (request !== state.request || ui.closed || !player.isValid) return;
                state.total = result.total;
                state.maxPage = pageCount(result.total);
                if (page > state.maxPage) {
                    state.page = state.maxPage;
                    persist();
                    syncSearch();
                    refresh();
                    return;
                }
                state.refs = result.refs;
                renderLabels();
                status.setData(
                    result.note
                        ? result.note
                        : result.total
                          ? `§7共 §f${result.total} §7首`
                          : "§7暂无歌曲",
                );
                pageText.setData(`§7第 §f${state.page}§7 / §f${state.maxPage} §7页`);
                prevVisible.setData(state.page > 1);
                nextVisible.setData(state.page < state.maxPage);
                syncUsage();
            })
            .catch((error) => {
                if (request !== state.request) return;
                status.setData(`§c读取失败：${(error as Error)?.message ?? error}`);
            });
    };

    const syncUsage = () => {
        if (state.tab === "library") {
            usage.setData("§7只读");
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
            `§7${storage.label}：§f${stat.songs} §7首 · §f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}${over}`,
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
        showLibraries.setData(state.tab === "library" && state.libraries.length > 0);
        persist();
        syncSearch();
        notice.setData("");
        refresh();
    });

    ui.dropdown("来源", source, TAB_ORDER.map((tab) => ({ label: TAB_LABELS[tab], value: TAB_ORDER.indexOf(tab) })));
    ui.dropdown(
        "曲库",
        libraryIndex,
        [
            { label: "全部曲库", value: 0 },
            ...state.libraries.map((lib, idx) => ({ label: lib.name, value: idx + 1 })),
        ],
        { visible: showLibraries },
    );

    void midiManager.listLibraries?.().then((libs) => {
        if (ui.closed || !player.isValid || !libs?.length) return;
        const prevKey = state.libraries.map((l) => `${l.id}:${l.name}`).join("|");
        const nextKey = libs.map((l) => `${l.id}:${l.name}`).join("|");
        if (prevKey === nextKey) return;
        ui.reopen();
    }).catch(() => {});

    ui.onChange(libraryIndex, (idx) => {
        const chosenLib = idx > 0 ? state.libraries[idx - 1] : undefined;
        state.libraryId = chosenLib?.id ?? "";
        state.page = 1;
        persist();
        syncSearch();
        notice.setData("");
        refresh();
    });

    ui.textField("搜索 / p5 跳页", search);
    ui.label(status).label(usage).label(notice);
    ui.label(pageText);

    ui.onChange(search, (value) => {
        const parsed = parseLibrarySearch(value);
        state.query = parsed.query;
        state.page = parsed.page ?? 1;
        persist();
        notice.setData("");
        scheduleRefresh();
    });

    ui.label(mode === "add" ? "§7点歌加入队列" : "§7点歌查看详情");

    for (let index = 0; index < PAGE_SIZE; index++) {
        ui.button(
            labels[index],
            () => {
                const ref = state.refs[index];
                if (!ref || !piano.isAlive()) return;
                if (mode === "add") {
                    const result = piano.getMidiPlayer().addToQueue(withDefaultQueuePerformance(piano, ref));
                    notice.setData(result === "added" ? `§a已加入队列：§f${ref.name}` : `§e队列中已有：§f${ref.name}`);
                    renderLabels();
                    return;
                }
                ui.push(TrackActionsPage, { piano, ref });
            },
            { visible: visible[index] },
        );
    }

    ui.button(
        "◀ 上一页",
        () => {
            if (state.page <= 1) return;
            state.page--;
            persist();
            syncSearch();
            refresh();
        },
        { visible: prevVisible },
    );
    ui.button(
        "下一页 ▶",
        () => {
            if (state.page >= state.maxPage) return;
            state.page++;
            persist();
            syncSearch();
            refresh();
        },
        { visible: nextVisible },
    );
    ui.closeButton();

    refresh();
});
