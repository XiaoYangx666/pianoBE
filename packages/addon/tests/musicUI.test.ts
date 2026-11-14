import { beforeEach, describe, expect, mock, test } from "bun:test";
import { encodePbe2, type StoredMusicEntry } from "@piano/core";
import { MidiPlayer } from "../src/domain/playback/player";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createMidiAppMock, createSapiProMock, FakeObservable } from "./support/fakeDDUI";

const host = createDDUIHost();

mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() { return 0; },
        runTimeout: (callback: () => void) => { callback(); return 0; },
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
    DataDrivenScreenClosedReason: { ClientClosed: "ClientClosed", ServerClosed: "ServerClosed", UserBusy: "UserBusy" },
    FormRejectError: class extends Error {},
    uiManager: { closeAllForms: () => {} },
}));

mock.module("sapi-pro", () => createSapiProMock(host));
// CI 没有私有 tabletop 包：页面测试只用到 display/assembly 的类型与纯函数。
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
mock.module("@app/permissions", () => ({ canImportMidi: () => true, isPbeAdmin: () => true }));
mock.module("@app/PianoWorld", () => ({ pianoWorld: { get: () => undefined } }));

const { MusicLibraryPage } = await import("../src/app/ui/midi/libraryUI");
const { MusicCardPage } = await import("../src/app/ui/midi/cardUI");
const { PlayQueuePage } = await import("../src/app/ui/midi/queueUI");
const { TrackActionsPage } = await import("../src/app/ui/midi/trackActions");
const { MidiPlayerPage } = await import("../src/app/ui/midi/playerUI");

function makeEntry(id: string, name: string): StoredMusicEntry {
    return {
        v: 1,
        id,
        name,
        duration: 1200,
        noteCount: 10,
        bytes: 200,
        checksum: "abcd1234",
        shards: 1,
        gen: "g",
        createdAt: 1,
    };
}

function fakeStorage(entries: StoredMusicEntry[], kind: "piano" | "card" = "piano") {
    const data = new Map<string, Uint8Array>();
    for (const entry of entries) {
        data.set(entry.id, encodePbe2({
            id: entry.id,
            name: entry.name,
            duration: 1200,
            tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [60, 0, 20, 90] }],
        }));
    }
    return {
        kind,
        label: kind === "piano" ? "电子钢琴" : "测试卡",
        list: () => entries,
        has: (id: string) => entries.some(entry => entry.id === id),
        get: (id: string) => data.get(id),
        save: (bytes: Uint8Array) => {
            const entry = { ...entries[0], id: "new", name: "新歌", bytes: bytes.length };
            entries.push(entry);
            data.set("new", bytes);
            return entry;
        },
        remove: (id: string) => {
            const index = entries.findIndex(entry => entry.id === id);
            if (index < 0) return false;
            entries.splice(index, 1);
            return true;
        },
        rename: () => undefined,
        usage: () => ({ songs: entries.length, usedBytes: 512, limitBytes: 65536, remainingBytes: 65024 }),
        setLimit: () => {},
        limitBytes: 65536,
    };
}

function makeMidi() {
    return new MidiPlayer({ acquire: async () => undefined }, { note() {}, playing() {} });
}

function makePiano(overrides: Record<string, unknown> = {}) {
    const midi = makeMidi();
    const storage = fakeStorage([makeEntry("s1", "小星星")]);
    const piano: any = {
        getMidiPlayer: () => midi,
        isAlive: () => true,
        disposedSignal: new Signal<void>(),
        music: { availability: () => "ok" },
        storage,
        cardStorage: undefined,
        cardAccess: undefined,
        readBytes: () => undefined,
        refreshCardIndicator: () => {},
        ...overrides,
    };
    return { piano, midi, storage };
}

function makePlayer(id = "p1", messages: string[] = []) {
    return {
        id,
        name: id,
        isValid: true,
        getComponent: () => undefined,
        sendMessage: (message: string) => { messages.push(message); },
    } as any;
}

const lastForm = () => host.lastForm();

function open(page: unknown, args: unknown) {
    host.DDUI.open(makePlayer(), page, args);
    return lastForm();
}

function dropdown(form: ReturnType<typeof lastForm>) {
    const component = form.components.find(item => item.type === "dropdown") as { value: FakeObservable<number> };
    return component.value;
}

beforeEach(() => {
    host.reset();
});

describe("音乐曲库页面", () => {
    test("默认展示钢琴内置歌曲，点击进入歌曲操作", async () => {
        const { piano } = makePiano();
        const form = open(MusicLibraryPage, { piano });
        await Promise.resolve();

        expect(form.buttonLabels()).toContain("§d[琴] 小星星");
        form.click("§d[琴] 小星星");
        expect(host.nav.pushed.at(-1)!.form).toBe(TrackActionsPage);
        expect((host.nav.pushed.at(-1)!.args as any).ref.source).toBe("piano");
    });

    test("切到存储卡来源时若未插卡给出明确状态", async () => {
        const { piano } = makePiano();
        const form = open(MusicLibraryPage, { piano });
        await Promise.resolve();

        dropdown(form).setData(1);
        await Promise.resolve();
        await Promise.resolve();

        const labels = form.labelTexts();
        expect(labels.some(text => text.includes("卡槽为空"))).toBe(true);
        expect(form.buttonLabels()).not.toContain("§d[琴] 小星星");
    });
});

describe("存储卡页面", () => {
    test("未插卡时展示真实卡槽状态，插入按钮给出提示", async () => {
        const { piano } = makePiano();
        const form = open(MusicCardPage, { piano });

        const labels = form.labelTexts();
        expect(labels.some(text => text.includes("未插卡"))).toBe(true);

        form.click("插入手中的卡");
        const updated = form.labelTexts();
        expect(updated.some(text => text.includes("请把音乐存储卡拿在主手"))).toBe(true);
    });
});

describe("播放队列页面", () => {
    test("卡来源的曲目在取卡后标记为不可用", () => {
        const { piano, midi } = makePiano({
            music: { availability: (ref: { source: string }) => ref.source === "card" ? "missing" : "ok" },
        });
        midi.queue.enqueue({ id: "s1", name: "卡上的歌", duration: 1200, source: "card", checksum: "abcd1234" });
        const form = open(PlayQueuePage, { piano });

        expect(form.buttonLabels().some(label => label.includes("⚠") && label.includes("卡上的歌"))).toBe(true);
    });
});

describe("歌曲操作页面", () => {
    test("没有存储卡时“复制到存储卡”只提示，不写任何东西", () => {
        const { piano } = makePiano();
        const form = open(TrackActionsPage, {
            piano,
            ref: { id: "s1", name: "小星星", duration: 1200, source: "piano" },
        });

        form.click("复制到存储卡");
        const labels = form.labelTexts();
        expect(labels.some(text => text.includes("卡槽为空"))).toBe(true);
    });
});

describe("播放器页面入口", () => {
    test("曲库按钮带上钢琴运行时，不再经过歌单中转页", () => {
        const { piano } = makePiano();
        const block = { isValid: true } as any;
        const form = open(MidiPlayerPage, { piano, block });

        form.click("音乐曲库");
        expect(host.nav.pushed.at(-1)!.form).toBe(MusicLibraryPage);
        expect((host.nav.pushed.at(-1)!.args as any).piano).toBe(piano);
    });

    test("未插卡时“存储卡”按钮只提示，不打开空表单", () => {
        const { piano } = makePiano();
        const block = { isValid: true } as any;
        const messages: string[] = [];
        host.DDUI.open(makePlayer("card-guard", messages), MidiPlayerPage, { piano, block });
        const before = host.nav.pushed.length;

        host.lastForm().click("存储卡");

        expect(host.nav.pushed.length).toBe(before);
        expect(messages.join("\n")).toContain("卡槽是空的");
    });
});
