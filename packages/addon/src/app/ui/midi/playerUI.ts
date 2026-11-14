import type { Block, Player } from "@minecraft/server";
import type { ObservableString } from "@minecraft/server-ui";
import { DDUI } from "sapi-pro";
import { musicSourceLabel } from "@piano/core";
import { resolveInstrument } from "@platform/assembly";
import { pianoWorld } from "@app/PianoWorld";
import type { PianoRuntime } from "@app/PianoRuntime";
import { getPlayModeName, type PlayMode } from "@domain/playback/queue";
import type { MidiPlayer } from "@domain/playback/player";
import { midiViewModel } from "./playerViewModel";
import { MusicLibraryPage } from "./libraryUI";
import { MusicCardPage } from "./cardUI";
import { MidiImportPage } from "./importUI";
import { PlayQueuePage } from "./queueUI";

const playModes: PlayMode[] = ["sequence", "single", "loop", "shuffle"];

function switchPlayMode(player: MidiPlayer, label: ObservableString) {
    const queue = player.queue;
    const index = playModes.indexOf(queue.getMode());
    const mode = playModes[(index + 1) % playModes.length];
    queue.setMode(mode);
    label.setData(getPlayModeName(mode));
}

/**
 * MIDI 播放器主界面。
 *
 * 只保留播放控制与三个入口（队列 / 曲库 / 存储卡），不再有“歌单”中转页。
 */
export const MidiPlayerPage = DDUI.page<{ piano: PianoRuntime; block: Block }>(
    "§bMIDI播放",
    (ui, args) => {
        const midi = args.piano.getMidiPlayer();
        const piano = args.piano;
        const block = args.block;
        if (!midi.isAlive() || !block.isValid) {
            ui.close();
            return;
        }

        const viewModel = midiViewModel(midi);
        ui.subscribe(viewModel.invalid, () => ui.close());
        ui.subscribe(piano.disposedSignal, () => ui.close());
        ui.retain(viewModel);

        const alive = () => midi.isAlive() && piano.isAlive();
        const refresh = () => {
            if (alive()) viewModel.sync();
        };

        const source = ui.string("", { clientWritable: false });
        const syncSource = () => {
            const ref = midi.queue.current();
            source.setData(ref ? `§7来源：§f${musicSourceLabel(ref.source)}` : "§7队列为空");
        };
        syncSource();


        const progress = ui.number(viewModel.progress.getData());
        ui.subscribe(viewModel.progress, (pct) => ui.set(progress, pct));
        ui.onChange(progress, (pct) => {
            if (!alive()) return ui.close();
            const duration = (midi.getInfo().durationMs ?? 0) / 1000;
            if (duration > 0) midi.seek((pct / 100) * duration);
        });

        ui.label(viewModel.state)
            .label(viewModel.midiName)
            .label(source)
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
                syncSource();
            })
            .button("⏮ 上一首", () => {
                if (!alive()) return ui.close();
                midi.queue.prev();
                syncSource();
                void midi.play().catch((error) => console.error("[midi] 播放失败", error));
                refresh();
            })
            .button("⏭ 下一首", () => {
                if (!alive()) return ui.close();
                midi.queue.next();
                syncSource();
                void midi.play().catch((error) => console.error("[midi] 播放失败", error));
                refresh();
            })
            .button(viewModel.playMode, () => {
                if (!alive()) return ui.close();
                switchPlayMode(midi, viewModel.playMode);
            })
            .divider()
            .button("播放队列", () => {
                if (!alive() || !block.isValid) return ui.close();
                ui.push(PlayQueuePage, { piano });
            })
            .button("音乐曲库", () => {
                if (!alive() || !block.isValid) return ui.close();
                ui.push(MusicLibraryPage, { piano });
            });
        // 卡槽为空时直接不显示入口，不留一个只会弹提示的按钮。
        if (piano.cardAccess) {
            ui.button("存储卡", () => {
                if (!alive() || !block.isValid) return ui.close();
                ui.push(MusicCardPage, { piano });
            });
        }
        ui.button("导入 MIDI", () => {
            if (!alive() || !block.isValid) return ui.close();
            ui.push(MidiImportPage, { piano, target: piano.cardStorage ? "card" : "piano" });
        });
        ui.closeButton();
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
