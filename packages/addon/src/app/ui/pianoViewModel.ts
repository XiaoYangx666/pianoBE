import { system } from "@minecraft/server";
import { ObservableString } from "@minecraft/server-ui";
import type { PianoRuntime } from "@app/PianoRuntime";

const MIN_HOLD_TICKS = 3;
const MAX_HOLD_TICKS = 120;

/**
 * 一架钢琴一份的按键视图。
 *
 * 所有发声来源（玩家打字、物理按键、MIDI）都会经过 PianoRuntime.playNote，
 * 这里把 MIDI 音符聚合成共享状态；每个玩家用自己的 keyMap/octave 渲染。
 */
export class PianoViewModel {
    /** 共享按键状态（逗号分隔的 MIDI 音符）；只作为变更通知，渲染仍按玩家映射。 */
    readonly activeKeys = new ObservableString("");

    private readonly active = new Map<number, number>();
    private unsubscribe?: () => void;
    private unsubscribeTick?: () => void;
    private disposed = false;

    constructor(piano: PianoRuntime) {
        this.unsubscribe = piano.noteSignal.subscribe(({ midi, duration }) =>
            this.strike(midi, duration)
        );
        // 复用运行时的每 tick 循环做到期清理，不再给每个音符挂 runTimeout。
        this.unsubscribeTick = piano.tickSignal.subscribe((tick) => this.sweep(tick));
    }

    private strike(midi: number, duration: number) {
        if (this.disposed) return;
        const hold = Math.max(
            MIN_HOLD_TICKS,
            Math.min(MAX_HOLD_TICKS, Math.ceil((Number.isFinite(duration) ? duration : 0) * 20))
        );
        const previous = this.active.get(midi);
        this.active.set(midi, system.currentTick + hold);
        if (previous === undefined) this.publish();
    }

    private sweep(tick: number) {
        if (this.disposed || this.active.size === 0) return;
        let changed = false;
        for (const [midi, expiry] of this.active) {
            if (expiry <= tick) {
                this.active.delete(midi);
                changed = true;
            }
        }
        if (changed) this.publish();
    }

    /** 当前仍在发声的音符；按当前 tick 过滤，避免定时器未执行时读到过期键。 */
    activeNotes(): ReadonlySet<number> {
        const now = system.currentTick;
        const notes = new Set<number>();
        for (const [midi, expiry] of this.active) {
            if (expiry > now) notes.add(midi);
        }
        return notes;
    }

    private publish() {
        const value = [...this.active.keys()].sort((a, b) => a - b).join(",");
        if (value !== this.activeKeys.getData()) this.activeKeys.setData(value);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.unsubscribeTick?.();
        this.unsubscribeTick = undefined;
        this.active.clear();
        this.activeKeys.setData("");
    }
}

const viewModels = new Map<PianoRuntime, PianoViewModel>();

/** 获取/创建一架钢琴的按键视图；调用方保证 piano 存活。 */
export function pianoViewModel(piano: PianoRuntime): PianoViewModel {
    let viewModel = viewModels.get(piano);
    if (viewModel) return viewModel;

    viewModel = new PianoViewModel(piano);
    viewModels.set(piano, viewModel);

    const unsubscribe = piano.disposedSignal.subscribe(() => {
        unsubscribe();
        viewModels.delete(piano);
        viewModel?.dispose();
    });
    return viewModel;
}
