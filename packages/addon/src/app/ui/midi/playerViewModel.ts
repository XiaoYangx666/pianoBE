import { ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { getPlayModeName } from "@domain/playback/queue";
import type { MidiPlayer } from "@domain/playback/player";
import { Signal } from "@domain/util/signal";

/** 同一架钢琴共享的只读 MIDI 视图状态；滑块等可写控件仍由玩家会话持有。 */
export interface MidiPlayerReadonlyContext {
    state: ObservableString;
    midiName: ObservableString;
    queue: ObservableString;
    progressText: ObservableString;
    progress: ObservableNumber;
    buttonText: ObservableString;
    playMode: ObservableString;
}

function formatTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

/** 把 MidiPlayer 的当前状态写入一组只读 Observable。 */
export function writeMidiReadonly(ctx: MidiPlayerReadonlyContext, player: MidiPlayer) {
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
    ctx.progressText.setData(
        `§7${formatTime(info.currentTime)} / ${formatTime((info.durationMs ?? 0) / 1000)}`
    );
    ctx.progress.setData(Math.round(info.progress * 100));
    ctx.buttonText.setData(info.state === "playing" ? "⏸ 暂停" : "▶ 播放");
    ctx.playMode.setData(getPlayModeName(player.queue.getMode()));
}

/**
 * 一架钢琴一份的 MIDI 只读视图。
 *
 * retain/release 只控制是否需要跟随播放状态刷新；Observable 本身在钢琴存活期间一直保留。
 */
export class MidiPlayerViewModel implements MidiPlayerReadonlyContext {
    readonly state = new ObservableString("§7加载中...");
    readonly midiName = new ObservableString("");
    readonly queue = new ObservableString("");
    readonly progressText = new ObservableString("");
    readonly progress = new ObservableNumber(0);
    readonly buttonText = new ObservableString("▶ 播放");
    readonly playMode = new ObservableString("");
    /** 播放器结束时通知所有绑定表单关闭。 */
    readonly invalid = new Signal<void>();

    private refs = 0;
    private unsubscribe?: () => void;
    private invalidated = false;
    private disposed = false;

    constructor(private readonly player: MidiPlayer) {
        this.playMode.setData(getPlayModeName(player.queue.getMode()));
        this.sync();
    }

    retain() {
        if (this.disposed) return;
        if (this.refs++ > 0) return;
        this.unsubscribe = this.player.signal.subscribe(() => this.sync());
        this.sync();
    }

    release() {
        if (this.refs === 0) return;
        if (--this.refs > 0) return;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    sync() {
        if (this.disposed) return;
        writeMidiReadonly(this, this.player);
        if (!this.player.isAlive() && !this.invalidated) {
            this.invalidated = true;
            this.invalid.publish();
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.refs = 0;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.invalid.dispose();
    }
}

const viewModels = new Map<MidiPlayer, MidiPlayerViewModel>();

/** 获取/创建一架钢琴的 MIDI 只读视图；生命周期跟随 MidiPlayer。 */
export function midiViewModel(player: MidiPlayer): MidiPlayerViewModel {
    let viewModel = viewModels.get(player);
    if (viewModel) return viewModel;

    if (!player.isAlive()) return new MidiPlayerViewModel(player);

    viewModel = new MidiPlayerViewModel(player);
    viewModels.set(player, viewModel);

    const unsubscribe = player.disposedSignal.subscribe(() => {
        unsubscribe();
        viewModels.delete(player);
        viewModel?.dispose();
    });
    return viewModel;
}
