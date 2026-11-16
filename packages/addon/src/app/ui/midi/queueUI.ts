import { DDUI } from "sapi-pro";
import { formatBytes, type MusicRef } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { MusicLibraryPage } from "./libraryUI";
import { PAGE_SIZE, availabilityMark, pageCount, sourceMark } from "./shared";

export interface QueueArgs {
    piano: PianoRuntime;
    /** 当前页（从条目详情返回时保持） */
    page?: number;
}

/** 播放队列：只负责顺序，播放控制统一保留在 MIDI 播放器主页面。 */
export const PlayQueuePage = DDUI.page<QueueArgs>("播放队列", (ui, args) => {
    const piano = args.piano;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const state = { page: Math.max(1, args.page ?? 1), maxPage: 1, index: -1 };
    const persist = () => { args.page = state.page; };
    persist();
    const head = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(false, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        persist();
        const midi = piano.getMidiPlayer();
        const queue = midi.queue;
        const refs = queue.getRefs();
        const info = midi.getInfo();
        state.index = queue.getIndex();
        state.maxPage = pageCount(refs.length);
        if (state.page > state.maxPage) {
            state.page = state.maxPage;
            persist();
        }
        const current = queue.current();
        head.setData(
            `§7队列 §f${refs.length} §7首` +
            (current ? `\n§7当前：§b${current.name}` : "\n§7队列为空，点“添加歌曲”开始")
        );
        const start = (state.page - 1) * PAGE_SIZE;
        for (let slot = 0; slot < PAGE_SIZE; slot++) {
            const index = start + slot;
            const ref = refs[index];
            if (!ref) {
                visible[slot].setData(false);
                continue;
            }
            visible[slot].setData(true);
            // 按钮文本不支持格式化符号，只放纯文本。
            const mark = index === state.index ? "▶ " : `${index + 1}. `;
            labels[slot].setData(`${mark}${availabilityMark(piano.music.availability(ref))}${sourceMark(ref)} ${ref.name}`);
        }
        pageText.setData(refs.length ? `§7第 §f${state.page}§7 / §f${state.maxPage} §7页` : "§7队列是空的");
        prevVisible.setData(state.page > 1);
        nextVisible.setData(state.page < state.maxPage);
    };

    ui.label(head).label(pageText);
    ui.label(`§7播放控制请回到 MIDI 播放器主页面（状态：§f${piano.getMidiPlayer().getInfo().state}§7）`);
    ui.button("＋ 添加歌曲", () => ui.push(MusicLibraryPage, { piano, mode: "add", tab: "library" }));

    for (let slot = 0; slot < PAGE_SIZE; slot++) {
        ui.button(labels[slot], () => {
            const queue = piano.getMidiPlayer().queue;
            const index = (state.page - 1) * PAGE_SIZE + slot;
            const ref = queue.getRefs()[index];
            if (!ref) return;
            ui.push(QueueItemPage, { piano, ref });
        }, { visible: visible[slot] });
    }

    ui.button("◀ 上一页", () => { if (state.page > 1) { state.page--; refresh(); } }, { visible: prevVisible });
    ui.button("下一页 ▶", () => { if (state.page < state.maxPage) { state.page++; refresh(); } }, { visible: nextVisible });
    ui.button("清空队列", () => ui.push(ClearQueuePage, { piano }));
    ui.closeButton();

    refresh();
});

interface QueueItemArgs {
    piano: PianoRuntime;
    ref: MusicRef;
}

const QueueItemPage = DDUI.page<QueueItemArgs>("队列操作", (ui, args) => {
    const { piano, ref } = args;
    const status = ui.string("");
    const queue = () => piano.getMidiPlayer().queue;
    ui.label(`§b${ref.name}`);
    ui.label(`§7来源：${sourceMark(ref)} §7时长：${Math.floor(ref.duration / 40 / 60)}:${String(Math.floor(ref.duration / 40) % 60).padStart(2, "0")}`);
    ui.label(`§7音符：${ref.noteCount !== undefined ? ref.noteCount : "未知"} §7大小：${ref.bytes !== undefined ? formatBytes(ref.bytes) : "未知"}`);
    ui.label(status);

    const move = (delta: number) => {
        const target = queue();
        const at = target.indexOf(ref);
        if (at < 0) return status.setData("§e曲目已不在队列中");
        if (!target.move(at, at + delta)) return status.setData("§e已经到边界了");
        status.setData(delta < 0 ? "§a已上移" : "§a已下移");
    };

    ui.button("▶ 跳转播放", () => {
        if (!piano.isAlive()) return ui.close();
        const target = queue();
        if (target.indexOf(ref) < 0) return status.setData("§e曲目已不在队列中");
        if (piano.music.availability(ref) !== "ok") {
            return status.setData("§c曲目当前不可用（来源可能已被移除）");
        }
        void piano.getMidiPlayer().playNow(ref)
            .then(() => status.setData("§a已跳转并开始播放"))
            .catch(error => status.setData(`§c播放失败：${(error as Error)?.message ?? error}`));
    });
    ui.button("上移", () => move(-1));
    ui.button("下移", () => move(1));
    ui.button("从队列移除", () => {
        const target = queue();
        const at = target.indexOf(ref);
        if (at < 0) return status.setData("§e曲目已不在队列中");
        target.remove(at);
        ui.back();
    });
    ui.closeButton();
});

const ClearQueuePage = DDUI.page<QueueArgs>("清空队列", (ui, args) => {
    const queue = args.piano.getMidiPlayer().queue;
    ui.label(`§e确定清空队列中的 ${queue.getLength()} 首歌曲？`);
    ui.button("清空", () => {
        queue.clear();
        ui.back();
    });
    ui.button("取消", () => ui.back());
});
