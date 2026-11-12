import { expect, mock, test } from "bun:test";
import { Signal } from "../src/domain/util/signal";

/** 按键视图的到期清理应复用运行时 tick，而不是给每个音符挂定时器。 */
let tick = 100;
let timeouts = 0;

class FakeObservableString {
    private value: string;
    private readonly subscribers = new Set<(value: string) => void>();

    constructor(value = "") {
        this.value = value;
    }

    getData() {
        return this.value;
    }

    setData(value: string) {
        this.value = value;
        for (const subscriber of this.subscribers) subscriber(value);
    }

    subscribe(callback: (value: string) => void) {
        this.subscribers.add(callback);
        return callback;
    }

    unsubscribe(callback: (value: string) => void) {
        return this.subscribers.delete(callback);
    }
}

mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() {
            return tick;
        },
        runTimeout: () => {
            timeouts++;
            return 0;
        },
    },
}));

mock.module("@minecraft/server-ui", () => ({
    ObservableString: FakeObservableString,
}));

const { PianoViewModel } = await import("../src/app/ui/pianoViewModel");

test("按键到期由运行时 tick 驱动，不创建定时器", () => {
    const noteSignal = new Signal<{ midi: number; duration: number }>();
    const tickSignal = new Signal<number>();
    const disposedSignal = new Signal<void>();
    const piano = {
        noteSignal,
        tickSignal,
        disposedSignal,
        isAlive: () => true,
    } as unknown as ConstructorParameters<typeof PianoViewModel>[0];

    const viewModel = new PianoViewModel(piano);
    noteSignal.publish({ midi: 60, duration: 0.15 });
    expect(viewModel.activeKeys.getData()).toBe("60");
    expect(timeouts).toBe(0);

    tick = 102;
    tickSignal.publish(tick);
    expect(viewModel.activeKeys.getData()).toBe("60");

    tick = 103;
    tickSignal.publish(tick);
    expect(viewModel.activeKeys.getData()).toBe("");
    expect(timeouts).toBe(0);

    viewModel.dispose();
    expect(tickSignal.listenerCount()).toBe(0);
    expect(noteSignal.listenerCount()).toBe(0);
});
