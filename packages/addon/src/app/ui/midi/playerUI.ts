import type { Block, Player } from "@minecraft/server";
import type { ObservableString } from "@minecraft/server-ui";
import { DDUI } from "sapi-pro";
import { resolveInstrument } from "@platform/assembly";
import { pianoWorld } from "@app/PianoWorld";
import type { PianoRuntime } from "@app/PianoRuntime";
import { getPlayModeName, type PlayMode } from "@domain/playback/queue";
import type { MidiPlayer } from "@domain/playback/player";
import { midiViewModel } from "./playerViewModel";
import { MidiListForm } from "./midiList";
import { LibraryForm } from "./libraryUI";

const playModes: PlayMode[] = ["sequence", "single", "loop", "shuffle"];

function switchPlayMode(player: MidiPlayer, label: ObservableString) {
    const queue = player.queue;
    const index = playModes.indexOf(queue.getMode());
    const mode = playModes[(index + 1) % playModes.length];
    queue.setMode(mode);
    label.setData(getPlayModeName(mode));
}

/**
 * MIDI 播放器页面。
 *
 * - 只读状态来自钢琴共享的 `MidiPlayerViewModel`，用 `ui.retain` 持有引用，关闭时 release；
 * - 进度滑块是本页私有的 clientWritable Observable，`ui.set` 用于服务器回写，不会被当成玩家拖动；
 * - 点歌/歌单直接把传统表单压进同一个表单栈，返回时自动回到本页。
 */
export const MidiPlayerPage = DDUI.page<{ piano: PianoRuntime; block: Block }>(
    "§bMIDI播放",
    (ui, args) => {
        const midi = args.piano.getMidiPlayer();
        const block = args.block;
        if (!midi.isAlive() || !block.isValid) {
            ui.close();
            return;
        }

        const viewModel = midiViewModel(midi);
        // 先订阅失效信号再 retain：retain 触发的同步如果发现播放器已结束，本页会被关掉
        ui.subscribe(viewModel.invalid, () => ui.close());
        ui.subscribe(args.piano.disposedSignal, () => ui.close());
        ui.retain(viewModel);

        const alive = () => midi.isAlive();
        const refresh = () => {
            if (alive()) viewModel.sync();
        };
        /** 点歌/歌单的“关闭”按钮回到播放器（与旧版一致：重新解析方块上的运行时） */
        // 跳转会释放旧 DDUIContext，不能在返回回调里访问已清空的 ui.player。
        const owner = ui.player;
        const reopenPlayer = () => openMidiPlayer(owner, block);

        // 进度：共享状态 → 页面滑块；玩家拖动滑块 → seek
        const progress = ui.number(viewModel.progress.getData());
        ui.subscribe(viewModel.progress, (pct) => ui.set(progress, pct));
        ui.onChange(progress, (pct) => {
            if (!alive()) return ui.close();
            const duration = (midi.getInfo().durationMs ?? 0) / 1000;
            if (duration > 0) midi.seek((pct / 100) * duration);
        });

        ui.label(viewModel.state)
            .label(viewModel.midiName)
            .label(viewModel.queue)
            .label("   ")
            .label(viewModel.progressText)
            .slider("播放进度 (%)", progress, 0, 100, { step: 1 })
            .label("   ")
            .button(viewModel.buttonText, () => {
                if (!alive()) return ui.close();
                const state = midi.getState();
                if (state === "playing") midi.pause();
                else if (state === "paused") midi.resume();
                else if (state === "idle") {
                    void midi.play().catch((error) => console.error("[midi] 播放失败", error));
                } else return ui.close();
                refresh();
            })
            .button("♪ 点歌", () => {
                if (!alive() || !block.isValid) return ui.close();
                ui.push(MidiListForm, { midiPlayer: midi, p: 1, onBack: reopenPlayer });
            })
            .button("⏮ 上一首", () => {
                if (!alive()) return ui.close();
                midi.queue.prev();
                void midi.play().catch((error) => console.error("[midi] 播放失败", error));
                refresh();
            })
            .button("⏭ 下一首", () => {
                if (!alive()) return ui.close();
                midi.queue.next();
                void midi.play().catch((error) => console.error("[midi] 播放失败", error));
                refresh();
            })
            .button(viewModel.playMode, () => {
                if (!alive()) return ui.close();
                switchPlayMode(midi, viewModel.playMode);
            })
            .button("歌单", () => {
                if (!alive() || !block.isValid) return ui.close();
                ui.push(LibraryForm, { midiPlayer: midi, onBack: reopenPlayer });
            });
    }
);

/** 打开播放器页面；MidiPlayer 由 PianoRuntime 缓存复用，UI 只负责这一层。 */
export function openMidiPlayer(player: Player, block: Block) {
    if (!player.isValid || !block.isValid) return;
    const location = resolveInstrument(block);
    const anchor = location?.dimension.getBlock(location.pos);
    const piano = location ? pianoWorld.get(location) : undefined;
    if (!anchor || !piano || !piano.isAlive()) return;
    DDUI.open(player, MidiPlayerPage, { piano, block: anchor });
}
