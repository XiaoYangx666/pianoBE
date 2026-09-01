import { getPlayModeName, PlayMode } from "@midiPlayer/queue";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { formManager } from "sapi-pro";
import { MidiPlayer } from "../player";
import { PlayListMainForm } from "./playListUI";
import { QueueListForm } from "./queueUI";

export interface MidiPlayerUIContext {
    state: ObservableString;
    midiName: ObservableString;
    queue: ObservableString;

    /** 文本进度：只显示时长（当前 / 总时长） */
    progressText: ObservableString;

    /** 进度拖动条：值与播放进度同步；玩家拖动即 seek（clientWritable） */
    progressSlider: ObservableNumber;

    buttonText: ObservableString;
    playMode: ObservableString;

    block: Block;
}

/** 秒 → mm:ss */
function formatTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
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

    // 文本进度只显示时长（当前 / 总时长）；进度条交给滑块
    ctx.progressText.setData(
        `§7${formatTime(info.currentTime)} / ${formatTime((info.durationMs ?? 0) / 1000)}`
    );

    ctx.buttonText.setData(info.state === "playing" ? "⏸ 暂停" : "▶ 播放");
}
