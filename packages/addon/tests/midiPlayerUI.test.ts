import { beforeEach, describe, expect, mock, test } from "bun:test";
import { MidiPlayer } from "../src/domain/playback/player";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createMidiAppMock, createSapiProMock, FakeObservable } from "./support/fakeDDUI";

/**
 * MIDI 播放器主界面回归测试。
 *
 * 新设计：播放器只保留播放控制 + 三个入口（队列 / 曲库 / 存储卡），
 * 不再有“歌单”中转层；队列与曲库都是独立 DDUI 页面。
 */

const host = createDDUIHost();

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
    MolangVariableMap: class {
        setVector3() {}
        setFloat() {}
    },
    TextPrimitive: class {
    },
    BlockPermutation: {
        resolve: (typeId: string, states: Record<string, string>) => ({
            type: { id: typeId },
            getState: (key: string) => states[key],
        }),
    },
    ItemStack: class { constructor(public typeId: string) {} },
    Player: class {},
    PlayerPermissionLevel: { Visitor: 0, Member: 1, Operator: 2, Custom: 3 },
    EntityComponentTypes: { Inventory: "minecraft:inventory", Equippable: "minecraft:equippable" },
    EquipmentSlot: { Mainhand: "Mainhand" },
}));

mock.module("@minecraft/server-ui", () => ({
    CustomForm: class {},
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

mock.module("sapi-pro", () => createSapiProMock(host));
mock.module("@begame/tabletop/minecraft", () => ({
    reconcileEntityTransform: (entity: any, point: any, yaw: number) => {
        entity?.teleport?.(point);
        entity?.setRotation?.({ x: 0, y: yaw });
    },
    releaseVisual: (entity: any) => entity?.remove?.(),
    createBlockResourceEvents: () => ({ register: () => {}, start: () => {} }),
    createNativeDropSuppression: () => () => {},
}));
mock.module("@app/midi", () => createMidiAppMock());
mock.module("@app/permissions", () => ({
    canImportMidi: () => true,
    isPbeAdmin: () => false,
}));

let location: any;
mock.module("@platform/assembly", () => ({
    resolveInstrument: () => location,
}));

type FakePiano = {
    getMidiPlayer: () => MidiPlayer;
    isAlive: () => boolean;
    disposedSignal: Signal<void>;
    music: { availability: () => "ok" };
    storage?: unknown;
    cardStorage?: unknown;
    cardAccess?: unknown;
    displayEntity?: unknown;
    refreshCardIndicator?: () => void;
};

let currentPiano: FakePiano | undefined;
mock.module("@app/PianoWorld", () => ({
    pianoWorld: { get: () => currentPiano },
}));

const { openMidiPlayer } = await import("../src/app/ui/midi/playerUI");
const { PlayQueuePage } = await import("../src/app/ui/midi/queueUI");
const { MusicLibraryPage } = await import("../src/app/ui/midi/libraryUI");
const { MusicCardPage } = await import("../src/app/ui/midi/cardUI");
const { MidiImportPage } = await import("../src/app/ui/midi/importUI");
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
                        key: header.id,
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
        music: { availability: () => "ok" },
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
        expect(form.sliders).toHaveLength(1);
        expect(midi.signal.listenerCount()).toBe(1);
        expect(form.buttonLabels()).toContain("播放队列");
        expect(form.buttonLabels()).toContain("音乐曲库");
        expect(form.buttonLabels()).toContain("存储卡");
        expect(form.buttonLabels()).toContain("导入 MIDI");
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

    test("三个入口分别压入队列/曲库/存储卡页面", () => {
        const midi = makeMidi();
        const piano = makePiano(midi);
        currentPiano = piano;
        openMidiPlayer(makePlayer(), makeBlock());

        lastForm().click("播放队列");
        expect(host.nav.pushed.at(-1)!.form).toBe(PlayQueuePage);
        expect(host.nav.pushed.at(-1)!.args.piano).toBe(piano);

        openMidiPlayer(makePlayer(), makeBlock());
        lastForm().click("音乐曲库");
        expect(host.nav.pushed.at(-1)!.form).toBe(MusicLibraryPage);
        expect(host.nav.pushed.at(-1)!.args.piano).toBe(piano);

        openMidiPlayer(makePlayer(), makeBlock());
        lastForm().click("存储卡");
        expect(host.nav.pushed.at(-1)!.form).toBe(MusicCardPage);
        expect(host.nav.pushed.at(-1)!.args.piano).toBe(piano);

        openMidiPlayer(makePlayer(), makeBlock());
        lastForm().click("导入 MIDI");
        expect(host.nav.pushed.at(-1)!.form).toBe(MidiImportPage);
        expect(host.nav.pushed.at(-1)!.args.piano).toBe(piano);
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

        viewModel.progress.setData(50);
        expect(slider.getData()).toBe(50);
        expect(seeks).toEqual([]);

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
});
