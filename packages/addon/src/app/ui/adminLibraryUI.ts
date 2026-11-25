import type { Player } from "@minecraft/server";
import { DDUI } from "sapi-pro";
import { formatBytes } from "@piano/core";
import { midiManager } from "@app/midi";
import { isPbeAdmin } from "@app/permissions";
import { worldLibrary } from "@platform/storage/worldLibrary";
import { MidiImportPage } from "./midi/importUI";
import {
    PAGE_SIZE,
    formatLibrarySearch,
    pageCount,
    parseLibrarySearch,
} from "./midi/shared";

/** 打开管理员全局曲库（供 `/pbe:pbe_library` 使用）。 */
export function openAdminLibrary(player: Player) {
    if (!isPbeAdmin(player)) {
        player.sendMessage("§c只有管理员可以管理全局曲库。");
        return;
    }
    DDUI.open(player, AdminLibraryPage);
}

/** 管理员全局曲库入口：不需要钢琴或存储卡。 */
export const AdminLibraryPage = DDUI.page("全局曲库管理", (ui) => {
    const player = ui.player;
    if (!isPbeAdmin(player)) {
        player.sendMessage("§c只有管理员可以管理全局曲库。");
        ui.close();
        return;
    }

    const status = ui.string("");
    const stats = ui.string("");

    const reload = (message = "") => {
        try {
            worldLibrary.reload();
            midiManager.refreshPublicIndex();
            const stat = worldLibrary.stats();
            stats.setData(
                `§7歌曲 §f${stat.songs}§7 / §f${stat.maxSongs} §7首 · ` +
                `§f${formatBytes(stat.usedBytes)}§7 / §f${formatBytes(stat.limitBytes)}`
            );
            if (message) status.setData(message);
        } catch (error) {
            status.setData(`§c读取全局曲库失败：${(error as Error)?.message ?? error}`);
        }
    };

    ui.label("§8世界公共曲库 · 重启保留")
        .label(stats)
        .label(status)
        .button("导入全局歌曲", () => ui.push(MidiImportPage, { target: "world" }))
        .button("浏览与删除歌曲", () => ui.push(AdminLibrarySongsPage))
        .closeButton();

    reload();
});

interface AdminSongsArgs {
    page?: number;
    query?: string;
}

/** 管理员浏览全局曲库：复用普通曲库的搜索/页码规则。 */
export const AdminLibrarySongsPage = DDUI.page<AdminSongsArgs>("全局曲库歌曲", (ui, args) => {
    const player = ui.player;
    if (!isPbeAdmin(player)) {
        player.sendMessage("§c只有管理员可以管理全局曲库。");
        ui.close();
        return;
    }

    const state = {
        page: Math.max(1, args.page ?? 1),
        query: args.query ?? "",
        refs: [] as string[],
        total: 0,
        maxPage: 1,
    };
    const persist = () => {
        args.page = state.page;
        args.query = state.query;
    };
    persist();
    const search = ui.string(formatLibrarySearch(state.query, state.page));
    const status = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(false, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });

    const syncSearch = () => ui.set(search, formatLibrarySearch(state.query, state.page));

    const refresh = () => {
        if (ui.closed) return;
        persist();
        const result = worldLibrary.pageSync(state.page, PAGE_SIZE, state.query);
        state.total = result.total;
        state.maxPage = pageCount(result.total);
        if (state.page > state.maxPage) {
            state.page = state.maxPage;
            syncSearch();
            refresh();
            return;
        }
        state.refs = result.items.map(meta => meta.id);
        for (let index = 0; index < PAGE_SIZE; index++) {
            const meta = result.items[index];
            visible[index].setData(Boolean(meta));
            labels[index].setData(meta ? meta.name : "");
        }
        status.setData(result.total ? `§7共 §f${result.total} §7首` : "§7全局曲库还没有歌曲");
        pageText.setData(`§7第 §f${state.page}§7 / §f${state.maxPage} §7页`);
        prevVisible.setData(state.page > 1);
        nextVisible.setData(state.page < state.maxPage);
    };

    ui.textField("搜索 / p5 跳页", search);
    ui.label(status).label(pageText);
    ui.onChange(search, (value) => {
        const parsed = parseLibrarySearch(value);
        state.query = parsed.query;
        state.page = parsed.page ?? 1;
        persist();
        refresh();
    });

    for (let index = 0; index < PAGE_SIZE; index++) {
        ui.button(labels[index], () => {
            const id = state.refs[index];
            if (id) ui.push(AdminLibraryTrackPage, { id });
        }, { visible: visible[index] });
    }
    ui.button("◀ 上一页", () => {
        if (state.page <= 1) return;
        state.page--;
        syncSearch();
        refresh();
    }, { visible: prevVisible });
    ui.button("下一页 ▶", () => {
        if (state.page >= state.maxPage) return;
        state.page++;
        syncSearch();
        refresh();
    }, { visible: nextVisible });
    ui.button("返回", () => ui.back());
    ui.closeButton();

    refresh();
});

interface AdminTrackArgs {
    id: string;
}

const AdminLibraryTrackPage = DDUI.page<AdminTrackArgs>("全局歌曲详情", (ui, args) => {
    if (!isPbeAdmin(ui.player)) {
        ui.player.sendMessage("§c只有管理员可以管理全局曲库。");
        ui.close();
        return;
    }
    const status = ui.string("");
    const entry = worldLibrary.entry(args.id);
    if (!entry) {
        ui.label("§e这首歌曲已不在全局曲库中").closeButton();
        return;
    }
    const seconds = Math.max(0, Math.floor(entry.duration / 40));
    ui.label(`§b${entry.name}`);
    ui.label(`§7ID：§f${entry.id}`);
    ui.label(`§7时长：§f${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
    ui.label(`§7音符：§f${entry.noteCount}§7 · 大小：§f${formatBytes(entry.bytes)}`);
    ui.label(`§7校验：§f${entry.checksum}`);
    ui.label(status);

    ui.button("删除全局歌曲", () => ui.push(AdminLibraryDeletePage, { id: entry.id }));
    ui.button("返回", () => ui.back());
    ui.closeButton();
});

/** 删除世界歌曲前二次确认；执行时重查管理员权限。 */
const AdminLibraryDeletePage = DDUI.page<AdminTrackArgs>("确认删除全局歌曲", (ui, args) => {
    if (!isPbeAdmin(ui.player)) {
        ui.player.sendMessage("§c只有管理员可以删除全局歌曲。");
        ui.close();
        return;
    }
    const entry = worldLibrary.entry(args.id);
    const status = ui.string("");
    ui.label(entry ? `§e确定从世界公共曲库永久删除「${entry.name}」？` : "§e歌曲已不存在");
    ui.label(status);
    if (entry) ui.button("确认永久删除", () => {
        if (!isPbeAdmin(ui.player)) return status.setData("§c管理员权限已失效");
        try {
            if (!worldLibrary.remove(args.id)) return status.setData("§e歌曲已不存在");
            midiManager.refreshPublicIndex();
            ui.player.sendMessage(`§a[全局曲库] 已删除：${entry.name}`);
            ui.back();
        } catch (error) {
            status.setData(`§c删除失败：${(error as Error)?.message ?? error}`);
        }
    });
    ui.button("取消", () => ui.back());
    ui.closeButton();
});
