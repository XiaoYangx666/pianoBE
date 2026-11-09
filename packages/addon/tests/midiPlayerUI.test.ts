import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { MidiPlayer } from "../src/domain/playback/player";

/**
 * MIDI 播放器 UI 的返回路径回归测试。
 *
 * 这里不重写 UI：只替换 Minecraft / sapi-pro / 钢琴世界的宿主入口，
 * 让真实的 playerUIManager、playerUI、queueUI 控制流跑起来。
 */

const midiDir = path.resolve(import.meta.dir, "../src/app/ui/midi");

class FakeObservable<T> {
    static all: FakeObservable<unknown>[] = [];
    data: T;
    writes = 0;
    private readonly subscribers = new Set<(value: T) => void>();

    constructor(value: T) {
        this.data = value;
        FakeObservable.all.push(this as FakeObservable<unknown>);
    }

    setData(value: T) {
        this.data = value;
        this.writes++;
        for (const subscriber of this.subscribers) subscriber(value);
    }

    getData() {
        return this.data;
    }

    subscribe(callback: (value: T) => void) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }
}

type ButtonHandler = () => void;

class FakeCustomForm {
    static forms: FakeCustomForm[] = [];
    readonly buttons = new Map<string, ButtonHandler>();
    showing = false;
    private resolveShow?: (reason: number) => void;

    constructor(readonly player: unknown, readonly title: string) {
        FakeCustomForm.forms.push(this);
    }

    label() { return this; }
    slider() { return this; }

    button(label: string, handler: ButtonHandler) {
        this.buttons.set(label, handler);
        return this;
    }

    show() {
        this.showing = true;
        return new Promise<number>((resolve) => { this.resolveShow = resolve; });
    }

    close() {
        if (!this.showing) return;
        this.showing = false;
        const resolve = this.resolveShow;
        this.resolveShow = undefined;
        resolve?.(0);
    }

    isShowing() {
        return this.showing;
    }
}

let currentTick = 100;
mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() { return currentTick; },
        runTimeout: (callback: () => void) => { callback(); return 0; },
    },
    Block: class {},
    Player: class {},
}));

mock.module("@minecraft/server-ui", () => ({
    CustomForm: FakeCustomForm,
    ObservableString: FakeObservable,
    ObservableNumber: FakeObservable,
    DataDrivenScreenClosedReason: { UserBusy: 1 },
}));

let location: {
    dimension: { id: string; getBlock: (pos: unknown) => unknown };
    pos: { x: number; y: number; z: number };
    direction: "north" | "south" | "east" | "west";
} | undefined;

mock.module("@platform/assembly", () => ({
    resolveInstrument: () => location,
}));

let currentPiano: { getMidiPlayer: () => MidiPlayer } | undefined;

mock.module("@app/PianoWorld", () => ({
    pianoWorld: { get: () => currentPiano },
}));

const openedForms: { form: unknown; args: any }[] = [];

mock.module("sapi-pro", () => ({
    formManager: {
        open: (_player: unknown, form: unknown, args: unknown) => {
            openedForms.push({ form, args });
        },
    },
    CommonForm: {
        // 返回表单定义本身，测试可以直接调用 oncancel。
        ButtonForm: (config: unknown) => config,
    },
}));

mock.module(path.join(midiDir, "midiList.ts"), () => ({
    MidiListForm: { name: "MidiListForm" },
    MidiSearchForm: { name: "MidiSearchForm" },
}));

mock.module(path.join(midiDir, "playListUI.ts"), () => ({
    PlayListMainForm: { name: "PlayListMainForm" },
}));

const { openMidiPlayer, midiUIManager } = await import("../src/app/ui/midi/playerUIManager");

const SONG = { id: "sample", name: "Sample", duration: 400 };

function makeMidi() {
    return new MidiPlayer(
        { load: async () => ({ ...SONG, tracks: [] }) },
        { note() {}, playing() {} }
    );
}

function makePlayer(id = "p1") {
    return { id, name: id, isValid: true } as any;
}

function makeBlock() {
    const dimension = { id: "overworld", getBlock: () => block };
    const block: any = { isValid: true, dimension, location: { x: 0, y: 0, z: 0 } };
    location = { dimension, pos: { x: 0, y: 0, z: 0 }, direction: "north" };
    return block;
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

function lastForm() {
    return FakeCustomForm.forms.at(-1)!;
}

function openQueueFromPlayer(playerForm: FakeCustomForm) {
    const handler = playerForm.buttons.get("队列管理");
    expect(handler).toBeDefined();
    handler!();
    return openedForms.at(-1)!;
}

/** 模拟玩家取消队列表单，走真实的 QueueListForm.oncancel。 */
function backFromQueue(queue: { form: any; args: any }) {
    queue.form.oncancel({}, {
        args: queue.args,
        back: () => { throw new Error("queue should return to the player UI"); },
    });
}

function observableWrites() {
    return FakeObservable.all.reduce((total, observable) => total + observable.writes, 0);
}

beforeEach(() => {
    midiUIManager.clear();
    FakeCustomForm.forms.length = 0;
    FakeObservable.all.length = 0;
    openedForms.length = 0;
    currentTick = 100;
    currentPiano = undefined;
    location = undefined;
});

describe("MIDI 播放器返回路径", () => {
    test("队列返回后重新订阅 MIDI 信号并继续刷新界面", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();

        const form = lastForm();
        expect(form.isShowing()).toBe(true);
        expect(midi.signal.listenerCount()).toBe(1);

        const queue = openQueueFromPlayer(form);
        await flush();
        expect(midi.signal.listenerCount()).toBe(0);
        expect(form.isShowing()).toBe(false);

        backFromQueue(queue);
        await flush();

        expect(form.isShowing()).toBe(true);
        expect(midi.signal.listenerCount()).toBe(1);

        const before = observableWrites();
        midi.signal.publish();
        expect(observableWrites()).toBeGreaterThan(before);
    });

    test("多次进出队列不会累积订阅", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        const form = lastForm();

        for (let i = 0; i < 3; i++) {
            const queue = openQueueFromPlayer(form);
            await flush();
            expect(midi.signal.listenerCount()).toBe(0);

            backFromQueue(queue);
            await flush();
            expect(midi.signal.listenerCount()).toBe(1);
            expect(form.isShowing()).toBe(true);
        }
    });

    test("关闭播放器会解除订阅", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        expect(midi.signal.listenerCount()).toBe(1);

        midiUIManager.invalidate(player.id);
        expect(midi.signal.listenerCount()).toBe(0);
    });

    test("队列打开期间钢琴被拆除时，返回不会重新打开失效界面", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        const form = lastForm();
        const queue = openQueueFromPlayer(form);
        await flush();

        location = undefined;
        backFromQueue(queue);
        await flush();

        expect(form.isShowing()).toBe(false);
        expect(midi.signal.listenerCount()).toBe(0);
        expect(FakeCustomForm.forms.length).toBe(1);
    });

    test("运行时被替换后，返回会绑定新的 MidiPlayer", async () => {
        const oldMidi = makeMidi();
        currentPiano = { getMidiPlayer: () => oldMidi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        const form = lastForm();
        const queue = openQueueFromPlayer(form);
        await flush();

        const newMidi = makeMidi();
        currentPiano = { getMidiPlayer: () => newMidi };
        oldMidi.end();

        backFromQueue(queue);
        await flush();

        expect(form.isShowing()).toBe(true);
        expect(oldMidi.signal.listenerCount()).toBe(0);
        expect(newMidi.signal.listenerCount()).toBe(1);

        const before = observableWrites();
        newMidi.signal.publish();
        expect(observableWrites()).toBeGreaterThan(before);
    });

    test("玩家失效时返回不会重新打开界面", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        const form = lastForm();
        const queue = openQueueFromPlayer(form);
        await flush();

        player.isValid = false;
        backFromQueue(queue);
        await flush();

        expect(form.isShowing()).toBe(false);
        expect(midi.signal.listenerCount()).toBe(0);
    });

    test("重复打开不会产生重复订阅", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        expect(midi.signal.listenerCount()).toBe(1);

        void openMidiPlayer(player, block);
        await flush();
        expect(midi.signal.listenerCount()).toBe(1);
    });

    test("运行时结束时 UI 自动关闭并解除订阅", async () => {
        const midi = makeMidi();
        currentPiano = { getMidiPlayer: () => midi };
        const player = makePlayer();
        const block = makeBlock();

        void openMidiPlayer(player, block);
        await flush();
        const form = lastForm();
        expect(form.isShowing()).toBe(true);

        midi.end();
        await flush();

        expect(form.isShowing()).toBe(false);
        expect(midi.signal.listenerCount()).toBe(0);
    });
});
