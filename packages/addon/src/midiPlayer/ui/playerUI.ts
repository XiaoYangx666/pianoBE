import { getPlayModeName, PlayMode } from "@midiPlayer/queue";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { formManager } from "sapi-pro";
import { MidiPlayer } from "../player";
import { PlayListMainForm } from "./playListUI";
import { QueueListForm } from "./queueUI";

export interface MidiPlayerUIContext {
    state: ObservableString;
    midiName: ObservableString;
    queue: ObservableString;

    progressBar: ObservableString;
    progressText: ObservableString;

    buttonText: ObservableString;
    playMode: ObservableString;

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

export function createMidiPlayerUI(
    p: Player,
    ctx: MidiPlayerUIContext,
    getPlayer: () => MidiPlayer,
    close: () => void
) {
    ctx.playMode.setData(getPlayModeName(getPlayer().queue.getMode()));

    const form = new CustomForm(p, "§bMIDI播放")
        .label(ctx.state)
        .label(ctx.midiName)
        .label(ctx.queue)

        .label("   ")

        .label(ctx.progressBar)
        .label(ctx.progressText)

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

        .button("队列管理", () => {
            close();
            if (!getPlayer().isAlive()) {
                return;
            }
            system.runTimeout(() => {
                formManager.open(p, QueueListForm, {
                    midiPlayer: getPlayer(),
                    p: -1,
                    block: ctx.block,
                });
            }, 20);
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
        .button("播放列表管理", () => {
            close();
            if (!getPlayer().isAlive()) {
                return;
            }
            system.runTimeout(() => {
                formManager.open(p, PlayListMainForm, {
                    midiPlayer: getPlayer(),
                });
            }, 20);
        });

    return form;
}

export function updateUI(ctx: MidiPlayerUIContext, player: MidiPlayer) {
    const info = player.getInfo();

    const stateMap: Record<string, string> = {
        idle: "§7空闲",
        playing: "§a播放中",
        paused: "§e已暂停",
    };

    const stateText = stateMap[info.state] ?? info.state;

    ctx.state.setData(`§l§f状态: ${stateText}`);
    ctx.midiName.setData(`§7当前: §b${info.midiName}`);
    ctx.queue.setData(`§7队列长度: §e${info.queueLength}`);

    const percent = (info.progress * 100).toFixed(1);

    const barLength = 20;
    const filled = Math.floor(info.progress * barLength);

    let bar = "§7[";
    for (let i = 0; i < barLength; i++) {
        bar += i < filled ? "§a|" : "§8|";
    }
    bar += "§7]";

    ctx.progressBar.setData(bar);

    ctx.progressText.setData(
        `§7进度: §e${percent}%  §7(${info.currentNoteIndex}/${info.totalNotes})`
    );

    ctx.buttonText.setData(info.state === "playing" ? "⏸ 暂停" : "▶ 播放");
}
