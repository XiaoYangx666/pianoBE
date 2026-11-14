import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { MidiPlayer } from "../src/domain/playback/player";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createMidiAppMock, createSapiProMock, FakeCustomForm, FakeObservable } from "./support/fakeDDUI";

/**
 * MIDI 播放器页面回归测试。
 *
 * 迁移到 sapi-pro 的 DDUI 后，页面只描述“状态 + 控件 + 跳转”，
 * 表单生命周期与导航由框架负责。这里用最小 DDUI 宿主驱动真实页面代码，
 * 断言页面本身必须保证的行为：
 * - 共享 ViewModel 的 retain/release；
 * - 服务器回写进度不会触发 seek，玩家拖动才 seek；
 * - 点歌 / 歌单把传统表单压入栈，并携带返回回调；
 * - 播放器结束时自动关页并释放订阅。
 */

const host = createDDUIHost();
const midiDir = path.resolve(import.meta.dir, "../src/app/ui/midi");

mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() {
            return 100;
        },
        runTimeout: (callback: () => void) => {
            callback();
            return 0;
        },
        runInterval: () => 0,
        clearRun: () => {},
        afterEvents: { scriptEventReceive: { subscribe: () => () => {} } },
        sendScriptEvent: () => {},
    },
    world: {
        afterEvents: { worldLoad: { subscribe: () => () => {} } },
        getPlayers: () => [],
    },
    Block: class {},
    Player: class {},
    PlayerPermissionLevel: { Visitor: 0, Member: 1, Operator: 2, Custom: 3 },
}));

mock.module("@minecraft/server-ui", () => ({
    CustomForm: FakeCustomForm,
    ObservableString: FakeObservable,
    ObservableNumber: FakeObservable,
    ObservableBoolean: FakeObservable,
    DataDrivenScreenClosedReason: {
        ClientClosed: "ClientClosed",
        ServerClosed: "ServerClosed",
        UserBusy: "UserBusy",
    },
    FormRejectError: class extends Error {},
    uiManager: { closeAllForms: () => {} },
}));

let location:
    | {
          dimension: { id: string; getBlock: (pos: unknown) => unknown };
          pos: { x: number; y: number; z: number };
          direction: "north" | "south" | "east" | "west";
      }
    | undefined;

mock.module("@platform/assembly", () => ({
    resolveInstrument: () => location,
}));

type FakePiano = {
    getMidiPlayer: () => MidiPlayer;
    isAlive: () => boolean;
    disposedSignal: Signal<void>;
};

let currentPiano: FakePiano | undefined;

mock.module("@app/PianoWorld", () => ({
    pianoWorld: { get: () => currentPiano },
}));

mock.module("sapi-pro", () => createSapiProMock(host));

mock.module("@app/midi", () => createMidiAppMock());

// 导入页依赖权限模块（会加载 Configdb / world）；本测试不需要真实权限逻辑
mock.module("@app/permissions", () => ({
    canImportMidi: () => true,
    isPbeAdmin: () => false,
}));

mock.module(path.join(midiDir, "playListUI.ts"), () => ({
    PlayListMainForm: { name: "PlayListMainForm" },
}));

const { openMidiPlayer } = await import("../src/app/ui/midi/playerUI");
const { MidiListForm } = await import("../src/app/ui/midi/midiList");
const { LibraryForm } = await import("../src/app/ui/midi/libraryUI");
const { midiViewModel } = await import("../src/app/ui/midi/playerViewModel");

const SONG = { id: "sample", name: "Sample", duration: 400 };

function makeMidi() {
    return new MidiPlayer(
        {
            acquire: async () => {
                const { buildSeekIndex, encodePbe2, readPbe2Events } = await import("@piano/core");
                const pbe2 = encodePbe2({
                    ...SONG,
                    tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [60, 0, 40, 90] }],
                });
                const { header, events } = readPbe2Events(pbe2);
                return {
                    song: {
                        id: header.id,
                        name: header.name,
                        duration: header.duration,
                        noteCount: header.noteCount,
                        header,
                        events,
                        index: buildSeekIndex(events, header.hasVelocity),
                        refCount: 1,
                        lastAccess: 0,
                        byteSize: events.length,
                    },
                    release() {},
                };
            },
        },
        { note() {}, playing() {} }
    );
}

function makePiano(midi: MidiPlayer): FakePiano {
    return {
        getMidiPlayer: () => midi,
        isAlive: () => true,
        disposedSignal: new Signal<void>(),
    };
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

const lastForm = () => host.lastForm();

beforeEach(() => {
    host.reset();
    currentPiano = undefined;
    location = undefined;
});

describe("MIDI 播放器页面", () => {
    test("打开页面会 retain 共享 ViewModel 并绑定控件", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        openMidiPlayer(makePlayer(), makeBlock());
        const form = lastForm();

        expect(form.isShowing()).toBe(true);
        expect(form.buttons.size).toBe(6);
        expect(form.sliders).toHaveLength(1);
        expect(midi.signal.listenerCount()).toBe(1);
    });

    test("关闭页面释放 ViewModel 引用，后续信号不再写控件", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        openMidiPlayer(makePlayer(), makeBlock());
        const form = lastForm();
        expect(midi.signal.listenerCount()).toBe(1);

        form.playerClose();

        expect(midi.signal.listenerCount()).toBe(0);
        expect(form.isShowing()).toBe(false);
        const writes = FakeObservable.all.reduce((total, observable) => total + observable.writes, 0);
        midi.signal.publish();
        expect(FakeObservable.all.reduce((total, observable) => total + observable.writes, 0)).toBe(writes);
    });

    test("点歌把 MidiListForm 压入表单栈，并带上返回播放器的回调", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        openMidiPlayer(makePlayer(), makeBlock());
        const form = lastForm();

        form.click("♪ 点歌");

        expect(host.nav.pushed).toHaveLength(1);
        expect(host.nav.pushed[0].form).toBe(MidiListForm);
        expect(host.nav.pushed[0].args.midiPlayer).toBe(midi);
        expect(host.nav.pushed[0].args.p).toBe(1);
        expect(typeof host.nav.pushed[0].args.onBack).toBe("function");
        expect(form.isShowing()).toBe(false);
        expect(midi.signal.listenerCount()).toBe(0);
    });

    test("歌单把 LibraryForm 压入表单栈", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        openMidiPlayer(makePlayer(), makeBlock());

        lastForm().click("歌单");

        expect(host.nav.pushed).toHaveLength(1);
        expect(host.nav.pushed[0].form).toBe(LibraryForm);
        expect(host.nav.pushed[0].args.midiPlayer).toBe(midi);
        expect(typeof host.nav.pushed[0].args.onBack).toBe("function");
    });


    test("旧 DDUIContext 释放 player 引用后，点歌和歌单仍可返回播放器", () => {
        for (const button of ["♪ 点歌", "歌单"]) {
            const midi = makeMidi();
            currentPiano = makePiano(midi);
            const owner = makePlayer(button);
            const block = makeBlock();
            openMidiPlayer(owner, block);
            const oldUi = host.active()!;
            lastForm().click(button);
            expect(oldUi.player).toBeUndefined();
            expect(midi.signal.listenerCount()).toBe(0);
            const onBack = host.nav.pushed.at(-1)!.args.onBack;
            expect(typeof onBack).toBe("function");
            onBack();
            expect(lastForm().isShowing()).toBe(true);
            expect(midi.signal.listenerCount()).toBe(1);
            lastForm().playerClose();
        }
    });

    test("服务器回写进度不 seek，玩家拖动滑块才 seek", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        openMidiPlayer(makePlayer(), makeBlock());
        const slider = lastForm().sliders[0].value;

        const seeks: number[] = [];
        (midi as any).seek = (seconds: number) => seeks.push(seconds);
        (midi as any).getInfo = () => ({ durationMs: 4000, state: "playing" });
        const viewModel = midiViewModel(midi);

        // 程序同步（ui.set）：只更新滑块，不触发 seek
        viewModel.progress.setData(50);
        expect(slider.getData()).toBe(50);
        expect(seeks).toEqual([]);

        // 玩家拖动：seek 到对应位置（4000ms × 25%）
        slider.setData(25);
        expect(seeks).toEqual([1]);
    });

    test("播放器结束时页面自动关闭并释放订阅", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        openMidiPlayer(makePlayer(), makeBlock());
        const form = lastForm();
        expect(form.isShowing()).toBe(true);

        midi.end();

        expect(form.isShowing()).toBe(false);
        expect(midi.signal.listenerCount()).toBe(0);
    });

    test("重复打开只有最后一个页面保留订阅", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        const player = makePlayer();
        const block = makeBlock();

        openMidiPlayer(player, block);
        const first = lastForm();
        openMidiPlayer(player, block);

        expect(first.isShowing()).toBe(false);
        expect(lastForm().isShowing()).toBe(true);
        expect(midi.signal.listenerCount()).toBe(1);
    });

    test("点歌期间方块失效时，返回不会重开界面", () => {
        const midi = makeMidi();
        currentPiano = makePiano(midi);
        const player = makePlayer();
        const block = makeBlock();

        openMidiPlayer(player, block);
        lastForm().click("♪ 点歌");
        const onBack = host.nav.pushed[0].args.onBack;

        block.isValid = false;
        onBack();

        expect(FakeCustomForm.forms.filter((form) => form.isShowing())).toHaveLength(0);
        expect(midi.signal.listenerCount()).toBe(0);
    });

    test("运行时被替换后，返回会绑定新的 MidiPlayer", () => {
        const oldMidi = makeMidi();
        const piano = makePiano(oldMidi);
        currentPiano = piano;
        const player = makePlayer();
        const block = makeBlock();

        openMidiPlayer(player, block);
        lastForm().click("♪ 点歌");
        const onBack = host.nav.pushed[0].args.onBack;

        const newMidi = makeMidi();
        piano.getMidiPlayer = () => newMidi;
        oldMidi.end();

        onBack();

        expect(lastForm().isShowing()).toBe(true);
        expect(newMidi.signal.listenerCount()).toBe(1);
        expect(oldMidi.signal.listenerCount()).toBe(0);
    });
});
