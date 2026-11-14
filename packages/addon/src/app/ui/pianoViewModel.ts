import { system } from "@minecraft/server";
import type { PianoRuntime } from "@app/PianoRuntime";

const MIN_HOLD_TICKS = 3;
const MAX_HOLD_TICKS = 120;

/**
 * 轻量键位状态：不创建原生 Observable。
 *
 * 键位状态不属于任何表单控件，过去用 `ObservableString` 只会给每架钢琴多造
 * 一个引擎 wrapper；保持 getData/setData/subscribe/unsubscribe 的兼容形状即可。
 */
class ActiveKeys {
    private value = "";
    private readonly subscribers = new Set<(value: string) => void>();

    getData() { return this.value; }

    setData(value: string) {
        if (value === this.value) return;
        this.value = value;
        for (const subscriber of [...this.subscribers]) subscriber(value);
    }

    subscribe(callback: (value: string) => void) {
        this.subscribers.add(callback);
        return callback;
    }

    unsubscribe(callback: (value: string) => void) {
        this.subscribers.delete(callback);
    }

    dispose() {
        this.subscribers.clear();
        this.value = "";
    }
}

/**
 * 一架钢琴一份的按键视图。
 *
 * 所有发声来源（玩家打字、物理按键、MIDI）都会经过 PianoRuntime.playNote，
 * 这里把 MIDI 音符聚合成共享状态；每个玩家用自己的 keyMap/octave 渲染。
 */
export class PianoViewModel {
    /** 共享按键状态（逗号分隔的 MIDI 音符）；只作为变更通知，渲染仍按玩家映射。 */
    readonly activeKeys = new ActiveKeys();

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
        this.activeKeys.dispose();
    }
}

const viewModels = new Map<PianoRuntime, PianoViewModel>();

/** 诊断：当前仍被缓存的 per-piano 键位视图数量。 */
export function pianoViewModelCount() { return viewModels.size; }

/** 获取/创建一架钢琴的按键视图；调用方保证 piano 存活。 */
export function pianoViewModel(piano: PianoRuntime): PianoViewModel {
    // 兜底：如果某次 disposedSignal 回调异常导致旧钢琴没被删掉，下一次打开
    // 面板时顺手清掉死运行时，避免缓存随放置/拆除次数线性增长。
    for (const key of [...viewModels.keys()]) {
        if (key.isAlive()) continue;
        const stale = viewModels.get(key);
        viewModels.delete(key);
        try { stale?.dispose(); } catch { /* diagnostic only */ }
    }
    let viewModel = viewModels.get(piano);
    if (viewModel) return viewModel;

    viewModel = new PianoViewModel(piano);
    viewModels.set(piano, viewModel);

    // 直接挂到运行时的显式清理列表：不依赖 disposedSignal 是否还能派发，
    // dispose() 时一定会移除缓存并释放 VM。
    piano.onDispose(() => {
        viewModels.delete(piano);
        try { viewModel?.dispose(); } catch { /* already disposed */ }
    });
    return viewModel;
}
