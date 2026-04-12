import { getPlayModeName, PlayMode, PlayQueue } from "@midiPlayer/queue";
import { Block, Player, system } from "@minecraft/server";
import { CustomForm, Observable } from "@minecraft/server-ui";
import { Cardinal_Direction } from "@types";
import { getLeftPianoBlock } from "@utils/block";
import { formManager } from "sapi-pro";
import { midiPlayerManager } from "../manager";
import { MidiPlayer } from "../player";
import { QueueListForm } from "./queueUI";

interface MidiPlayerContext {
    // 顶部信息（拆行）
    state: Observable<string>;
    midiName: Observable<string>;
    queue: Observable<string>;

    // 进度区
    progressBar: Observable<string>;
    progressText: Observable<string>;

    // 按钮
    buttonText: Observable<string>;
}

const playModes: PlayMode[] = ["sequence", "single", "loop", "shuffle"];
function switchPlayMode(queue: PlayQueue, label: Observable<string>) {
    const curIdx = playModes.indexOf(queue.getMode());
    const mode = playModes[(curIdx + 1) % playModes.length];
    queue.setMode(mode);
    label.setData(getPlayModeName(mode));
}

export async function openMidiPlayer(p: Player, block: Block) {
    const leftBlock = getLeftPianoBlock(block);
    if (!leftBlock) return;
    const dir = leftBlock.permutation.getState(
        "minecraft:cardinal_direction"
    ) as Cardinal_Direction | undefined;
    if (!dir) return;

    // 获取或创建 player
    let player =
        midiPlayerManager.get(leftBlock.dimension, leftBlock.location) ??
        midiPlayerManager.add(
            new MidiPlayer(leftBlock.dimension, leftBlock.location, dir)
        );

    const ctx: MidiPlayerContext = {
        state: Observable.create<string>("§7加载中..."),
        midiName: Observable.create<string>(""),
        queue: Observable.create<string>(""),

        progressBar: Observable.create<string>(""),
        progressText: Observable.create<string>(""),

        buttonText: Observable.create<string>("▶ 播放"),
    };

    const mode = player.queue.getMode();
    const playModeLabel = Observable.create<string>(getPlayModeName(mode));

    const form = CustomForm.create(p, "§bMIDI播放")
        // ===== 顶部信息 =====
        .label(ctx.state)
        .label(ctx.midiName)
        .label(ctx.queue)

        .label("   ")

        // ===== 进度 =====
        .label(ctx.progressBar)
        .label(ctx.progressText)

        .label("   ")

        // ===== 控制区 =====
        .button(ctx.buttonText, () => {
            const state = player.getInfo().state;
            if (state === "playing") {
                player.pause();
            } else if (state === "paused") {
                player.resume();
            } else if (state === "idle") {
                const idx = player.queue.getIndex();
                player.playAt(idx);
            } else {
                close();
            }
            updateUI(ctx, player);
        })
        .button("队列管理", () => {
            close();
            system.runTimeout(() => {
                formManager.open(p, QueueListForm, {
                    midiPlayer: player,
                    p: 1,
                    ui: { player: p, block: block },
                });
            }, 20);
        })
        .button("⏮ 上一首", () => {
            player.prev();
            updateUI(ctx, player);
        })
        .button("⏭ 下一首", () => {
            player.next();
            updateUI(ctx, player);
        })
        .button(playModeLabel, () => {
            switchPlayMode(player.queue, playModeLabel);
        });

    let closed = false;
    let unSub: Function | undefined = undefined;

    function close() {
        if (closed) return;
        closed = true;

        if (unSub) unSub();

        if (form.isShowing()) {
            form.close();
        }
    }

    // 初始 UI
    updateUI(ctx, player);

    // ✅ 订阅 player 更新
    unSub = player.signal.subscribe(() => {
        // UI 已关闭 → 取消订阅
        if (!form.isShowing()) {
            return close();
        }

        updateUI(ctx, player);
    });

    try {
        const result = await form.show();
        if (!result) {
            close();
        }
    } catch (err) {
        console.error(err);
        close();
        return;
    }
}

function updateUI(ctx: MidiPlayerContext, player: MidiPlayer) {
    const info = player.getInfo();

    const stateMap: Record<string, string> = {
        idle: "§7空闲",
        playing: "§a播放中",
        paused: "§e已暂停",
    };

    const stateText = stateMap[info.state] ?? info.state;

    // ===== 顶部信息 =====
    ctx.state.setData(`§l§f状态: ${stateText}`);
    ctx.midiName.setData(`§7当前: §b${info.midiName}`);
    ctx.queue.setData(`§7队列长度: §e${info.queueLength}`);

    // ===== 进度条 =====
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

    // ===== 按钮 =====
    ctx.buttonText.setData(info.state === "playing" ? "⏸ 暂停" : "▶ 播放");
}
