import type { PianoRuntime } from "@app/PianoRuntime";
import { MusicLibraryPage } from "./libraryUI";
import { PAGE_SIZE, availabilityMark, pageCount, sourceMark } from "./shared";
import { appPage, backButton } from "../ddui";

export interface QueueArgs {
    piano: PianoRuntime;
}

/** 播放队列：只负责顺序，不管理歌单。来源与可用性直接标在条目上。 */
export const PlayQueuePage = appPage<QueueArgs>("播放队列", (ui, args) => {
    const piano = args.piano;
    const player = ui.player;
    ui.subscribe(piano.disposedSignal, () => ui.close());

    const state = { page: 1, maxPage: 1, index: -1 };
    const head = ui.string("");
    const pageText = ui.string("");
    const labels = Array.from({ length: PAGE_SIZE }, () => ui.string(""));
    const visible = Array.from({ length: PAGE_SIZE }, () => ui.boolean(false, { clientWritable: false }));
    const prevVisible = ui.boolean(false, { clientWritable: false });
    const nextVisible = ui.boolean(false, { clientWritable: false });

    const refresh = () => {
        if (!piano.isAlive() || ui.closed) return;
        const midi = piano.getMidiPlayer();
        const queue = midi.queue;
        const refs = queue.getRefs();
        const info = midi.getInfo();
        state.index = queue.getIndex();
        state.maxPage = pageCount(refs.length);
        if (state.page > state.maxPage) state.page = state.maxPage;
        const current = queue.current();
        head.setData(
            `§7队列 §f${refs.length} §7首 · 状态 §f${info.state}` +
            (current ? `\n§7当前：§b${current.name}` : "")
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
            const mark = index === state.index ? "§q▶ " : `${index + 1}. `;
            labels[slot].setData(`${mark}${availabilityMark(piano.music.availability(ref))}${sourceMark(ref)} ${ref.name}`);
        }
        pageText.setData(refs.length ? `§7第 §f${state.page}§7 / §f${state.maxPage} §7页` : "§7队列是空的");
        prevVisible.setData(state.page > 1);
        nextVisible.setData(state.page < state.maxPage);
    };

    const playCurrent = () => {
        const midi = piano.getMidiPlayer();
        void midi.play().catch((error) => player.sendMessage(`§c播放失败：${(error as Error)?.message ?? error}`));
        refresh();
    };

    ui.label(head).label(pageText);
    ui.button("▶ 播放 / 继续", playCurrent);
    ui.button("⏮ 上一首", () => {
        piano.getMidiPlayer().queue.prev();
        playCurrent();
    });
    ui.button("⏭ 下一首", () => {
        piano.getMidiPlayer().queue.next();
        playCurrent();
    });
    ui.button("＋ 添加歌曲", () => ui.push(MusicLibraryPage, { piano, tab: "piano" }));

    for (let slot = 0; slot < PAGE_SIZE; slot++) {
        ui.button(labels[slot], () => {
            const queue = piano.getMidiPlayer().queue;
            const index = (state.page - 1) * PAGE_SIZE + slot;
            if (index >= queue.getLength()) return;
            ui.push(QueueItemPage, { piano, index });
        }, { visible: visible[slot] });
    }

    ui.button("◀ 上一页", () => { if (state.page > 1) { state.page--; refresh(); } }, { visible: prevVisible });
    ui.button("下一页 ▶", () => { if (state.page < state.maxPage) { state.page++; refresh(); } }, { visible: nextVisible });
    ui.button("§c清空队列", () => ui.push(ClearQueuePage, { piano }));
    ui.button("刷新", refresh);
    backButton(ui);
    ui.closeButton();

    refresh();
});

const QueueItemPage = appPage<{ piano: PianoRuntime; index: number }>("队列操作", (ui, args) => {
    const { piano, index } = args;
    const queue = piano.getMidiPlayer().queue;
    const ref = queue.getRefs()[index];
    const status = ui.string("");
    ui.label(ref ? `§b${ref.name}` : "§7（已不在队列中）");
    ui.label(status);
    ui.button("▶ 播放这首", () => {
        if (!ref) return status.setData("§e曲目已不存在");
        const midi = piano.getMidiPlayer();
        midi.queue.jump(index);
        void midi.play().catch((error) => status.setData(`§c播放失败：${(error as Error)?.message ?? error}`));
        status.setData("§a已开始播放");
    });
    ui.button("§c从队列移除", () => {
        piano.getMidiPlayer().queue.remove(index);
        ui.back();
    });
    ui.button("返回", () => ui.back());
});

const ClearQueuePage = appPage<QueueArgs>("清空队列", (ui, args) => {
    const queue = args.piano.getMidiPlayer().queue;
    ui.label(`§e确定清空队列中的 ${queue.getLength()} 首歌曲？`);
    ui.button("§c清空", () => {
        queue.clear();
        ui.back();
    });
    ui.button("取消", () => ui.back());
});
