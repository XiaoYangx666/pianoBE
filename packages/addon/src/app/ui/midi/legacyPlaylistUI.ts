import { DDUI } from "sapi-pro";
import { formatBytes, toMusicRef, type MusicRef, type PlaylistMeta } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { midiManager, playlist } from "@app/midi";
import { PAGE_SIZE, pageCount } from "./shared";
import { backButton } from "../ddui";

export interface LegacyPlaylistArgs {
    piano: PianoRuntime;
}

/**
 * 旧持久化播放列表：只读兼容入口。
 *
 * 保留读取/导出/迁移能力，不再提供创建、改名、公开设置等编辑操作；
 * 新设计里“播放顺序”由钢琴自己的队列负责。
 */
export const LegacyPlaylistPage = DDUI.page<LegacyPlaylistArgs>("旧播放列表（只读）", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const state = { metas: [] as PlaylistMeta[], page: 1, maxPage: 1, request: 0 };
    const status = ui.string("§7正在读取…");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(false, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });

    const refresh = () => {
        const request = ++state.request;
        void Promise.all([playlist.listMy(player.id), playlist.listPublic()]).then(([mine, shared]) => {
            if (request !== state.request || ui.closed || !player.isValid) return;
            const merged = new Map<number, PlaylistMeta>();
            for (const meta of [...mine, ...shared]) merged.set(meta.id, meta);
            state.metas = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
            state.maxPage = pageCount(state.metas.length);
            if (state.page > state.maxPage) state.page = state.maxPage;
            const start = (state.page - 1) * PAGE_SIZE;
            for (let slot = 0; slot < PAGE_SIZE; slot++) {
                const meta = state.metas[start + slot];
                visible[slot].setData(Boolean(meta));
                labels[slot].setData(meta ? `${meta.public ? "§a[公开] " : "§7"}${meta.name} §8(${meta.playCount} 次)` : "");
            }
            status.setData(state.metas.length ? `§7共 ${state.metas.length} 个旧列表（仅可读取/导出）` : "§7没有旧播放列表");
            pageText.setData(`§7第 §f${state.page}§7 / §f${state.maxPage} §7页`);
            prevVisible.setData(state.page > 1);
            nextVisible.setData(state.page < state.maxPage);
        }).catch((error) => {
            if (request !== state.request) return;
            status.setData(`§c读取失败：${(error as Error)?.message ?? error}`);
        });
    };

    ui.label(status).label(pageText);
    for (let slot = 0; slot < PAGE_SIZE; slot++) {
        ui.button(labels[slot], () => {
            const meta = state.metas[(state.page - 1) * PAGE_SIZE + slot];
            if (!meta) return;
            ui.push(LegacyPlaylistContentPage, { piano, meta });
        }, { visible: visible[slot] });
    }
    ui.button("◀ 上一页", () => { if (state.page > 1) { state.page--; refresh(); } }, { visible: prevVisible });
    ui.button("下一页 ▶", () => { if (state.page < state.maxPage) { state.page++; refresh(); } }, { visible: nextVisible });
    ui.button("刷新", refresh);
    backButton(ui);
    ui.closeButton();
    refresh();
});

const LegacyPlaylistContentPage = DDUI.page<{ piano: PianoRuntime; meta: PlaylistMeta }>("旧列表内容", (ui, args) => {
    const { piano, meta } = args;
    const status = ui.string("§7正在读取…");
    const listText = ui.string("", { clientWritable: false });
    let refs: MusicRef[] = [];

    ui.label(`§b${meta.name}`);
    ui.label(status).label(listText);

    void playlist.getContent(meta.id).then(async (ids) => {
        if (ui.closed || !ui.player.isValid) return;
        const loaded: MusicRef[] = [];
        for (const id of ids.slice(0, 40)) {
            const info = midiManager.getInfo(id) ?? await midiManager.infoOf(id);
            if (info) loaded.push(toMusicRef("library", info));
        }
        refs = loaded;
        status.setData(`§7共 ${ids.length} 首（显示前 ${loaded.length} 首）`);
        listText.setData(loaded.slice(0, 8).map((ref, index) => `§7${index + 1}. §f${ref.name}`).join("\n") || "§7（空列表）");
    }).catch((error) => {
        if (ui.closed) return;
        status.setData(`§c读取失败：${(error as Error)?.message ?? error}`);
    });

    ui.button("全部加入播放队列", () => {
        if (!refs.length) return status.setData("§e列表为空或尚未加载完成");
        const queue = piano.getMidiPlayer().queue;
        let added = 0;
        for (const ref of refs) {
            if (queue.indexOf(ref) >= 0) continue;
            queue.enqueue(ref);
            added++;
        }
        status.setData(`§a已加入 ${added} 首（重复曲目已跳过）`);
    });

    ui.button("全部复制到钢琴", () => {
        const storage = piano.storage;
        if (!storage) return status.setData("§c钢琴存储暂不可用");
        if (!refs.length) return status.setData("§e列表为空或尚未加载完成");
        void (async () => {
            let added = 0;
            let failed = 0;
            let used = 0;
            for (const ref of refs) {
                if (ui.closed) return;
                try {
                    const bytes = await piano.readBytes(ref);
                    if (!bytes) { failed++; continue; }
                    const entry = storage.save(bytes);
                    added++;
                    used += entry.bytes;
                } catch {
                    failed++;
                }
            }
            status.setData(`§a已复制 ${added} 首${failed ? `，${failed} 首失败（可能容量不足）` : ""}` +
                (used ? ` · 原始 ${formatBytes(used)}` : ""));
        })();
    });

    ui.button("返回", () => ui.back());
});
