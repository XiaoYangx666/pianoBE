import { getPlayModeName, PlayMode } from "@domain/playback/queue";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { MidiPlayer } from "@domain/playback/player";
import { MidiPlayerReadonlyContext, writeMidiReadonly } from "./playerViewModel";

export interface MidiPlayerUIContext extends MidiPlayerReadonlyContext {
    /** 进度拖动条：值与播放进度同步；玩家拖动即 seek（clientWritable） */
    progressSlider: ObservableNumber;

    block: Block;
}

const playModes: PlayMode[] = ["sequence", "single", "loop", "shuffle"];

function switchPlayMode(player: MidiPlayer, label: ObservableString) {
    const queue = player.queue;
    const curIdx = playModes.indexOf(queue.getMode());
    const mode = playModes[(curIdx + 1) % playModes.length];
    queue.setMode(mode);
    label.setData(getPlayModeName(mode));
}

export interface MidiPlayerUIActions {
    openSongPicker(player: Player, block: Block, midi: MidiPlayer): void;
    openLibrary(player: Player, block: Block, midi: MidiPlayer): void;
}

export function createMidiPlayerUI(
    p: Player,
    ctx: MidiPlayerUIContext,
    getPlayer: () => MidiPlayer,
    close: () => void,
    actions: MidiPlayerUIActions
) {
    ctx.playMode.setData(getPlayModeName(getPlayer().queue.getMode()));

    const form = new CustomForm(p, "§bMIDI播放")
        .label(ctx.state)
        .label(ctx.midiName)
        .label(ctx.queue)

        .label("   ")

        .label(ctx.progressText)

        // 进度拖动条：双向绑定进度；拖动修改播放进度（seek 由 playerUIManager 监听处理）
        .slider("播放进度 (%)", ctx.progressSlider, 0, 100, { step: 1 })

        .label("   ")

        .button(ctx.buttonText, () => {
            const player = getPlayer();
            const state = player.getState();

            if (state === "playing") player.pause();
            else if (state === "paused") player.resume();
            else if (state === "idle") player.play();
            else close();

            updateUI(ctx, player);
        })

        .button("♪ 点歌", () => {
            const midi = getPlayer();
            const block = ctx.block;
            close();
            if (!midi.isAlive() || !block.isValid) {
                return;
            }
            system.runTimeout(() => actions.openSongPicker(p, block, midi), 20);
        })

        .button("⏮ 上一首", () => {
            if (!getPlayer().isAlive()) {
                return close();
            }
            getPlayer().queue.prev();
            getPlayer().play();
            updateUI(ctx, getPlayer());
        })

        .button("⏭ 下一首", () => {
            if (!getPlayer().isAlive()) {
                return close();
            }
            getPlayer().queue.next();
            getPlayer().play();
            updateUI(ctx, getPlayer());
        })

        .button(ctx.playMode, () => {
            if (!getPlayer().isAlive()) {
                return close();
            }
            switchPlayMode(getPlayer(), ctx.playMode);
        })
        .button("歌单", () => {
            const midi = getPlayer();
            const block = ctx.block;
            close();
            if (!midi.isAlive() || !block.isValid) {
                return;
            }
            system.runTimeout(() => actions.openLibrary(p, block, midi), 20);
        });

    return form;
}

export function updateUI(ctx: MidiPlayerUIContext, player: MidiPlayer) {
    writeMidiReadonly(ctx, player);
}
