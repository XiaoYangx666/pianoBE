import { DDUI } from "sapi-pro";
import { formatBytes, type MusicSelection } from "@piano/core";
import type { PianoRuntime } from "@app/PianoRuntime";
import { MusicLibraryPage } from "./libraryUI";
import { PAGE_SIZE, availabilityMark, pageCount, sourceMark } from "./shared";

export interface QueueArgs {
    piano: PianoRuntime;
    /** 当前页（从条目详情返回时保持） */
    page?: number;
}

function trackName(piano: PianoRuntime, ref: MusicSelection): string {
    if (ref.performanceId === "plain") return `${ref.name} · 普通演奏`;
    if (ref.performanceId === "default") return ref.name;
    const performance = piano.performanceEntries?.(ref).find(entry => entry.id === ref.performanceId);
    return performance ? `${ref.name} · ${performance.name}` : ref.name;
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
        state.index = queue.getIndex();
        state.maxPage = pageCount(refs.length);
        if (state.page > state.maxPage) {
            state.page = state.maxPage;
            persist();
        }
        const current = queue.current();
        head.setData(
            `§7队列 §f${refs.length} §7首` +
            (current ? `\n§7当前：§b${trackName(piano, current)}` : "\n§7队列为空，点“添加歌曲”开始")
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
            labels[slot].setData(`${mark}${availabilityMark(piano.music.availability(ref))}${sourceMark(ref)} ${trackName(piano, ref)}`);
        }
        pageText.setData(refs.length ? `§7第 §f${state.page}§7 / §f${state.maxPage} §7页` : "§7队列是空的");
        prevVisible.setData(state.page > 1);
        nextVisible.setData(state.page < state.maxPage);
    };

    ui.label(head).label(pageText);
    ui.label("§7播放控制请回播放器主页");
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
    ref: MusicSelection;
}

const QueueItemPage = DDUI.page<QueueItemArgs>("队列操作", (ui, args) => {
    const { piano, ref } = args;
    const status = ui.string("");
    const queue = () => piano.getMidiPlayer().queue;
    ui.label(`§b${trackName(piano, ref)}`);
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
        const midi = piano.getMidiPlayer();
        const target = midi.queue;
        if (target.indexOf(ref) < 0) return status.setData("§e曲目已不在队列中");
        if (piano.music.availability(ref) === "missing") {
            return status.setData("§c曲目当前不可用（来源可能已被移除）");
        }
        void midi.playNow(ref)
            .then(() => {
                const index = target.indexOf(ref);
                const playing = index >= 0 && index === target.getIndex() && midi.isPlaying();
                status.setData(playing ? "§a已跳转并开始播放" : "§c未能播放这首曲目");
            })
            .catch(error => status.setData(`§c播放失败：${(error as Error)?.message ?? error}`));
    });
    ui.button("上移", () => move(-1));
    ui.button("下移", () => move(1));
    ui.button("从队列移除", () => {
        if (!piano.isAlive()) return ui.close();
        if (!piano.getMidiPlayer().removeFromQueue(ref)) return status.setData("§e曲目已不在队列中");
        ui.back();
    });
    ui.closeButton();
});

const ClearQueuePage = DDUI.page<QueueArgs>("清空队列", (ui, args) => {
    const { piano } = args;
    ui.label(`§e确定清空队列中的 ${piano.getMidiPlayer().queue.getLength()} 首歌曲？`);
    ui.button("清空", () => {
        if (!piano.isAlive()) return ui.close();
        piano.getMidiPlayer().clearQueue();
        ui.back();
    });
    ui.button("取消", () => ui.back());
});
