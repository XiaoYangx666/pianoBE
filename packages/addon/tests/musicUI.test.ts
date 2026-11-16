import { beforeEach, describe, expect, mock, test } from "bun:test";
import { encodePbe2, type StoredMusicEntry } from "@piano/core";
import { MidiPlayer } from "../src/domain/playback/player";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createMidiAppMock, createSapiProMock, FakeObservable, type FakeCustomForm } from "./support/fakeDDUI";

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

let pageImpl: (page: number, pageSize: number, q?: string) => Promise<{ items: any[]; total: number }> =
    async () => ({ items: [], total: 0 });
mock.module("@app/midi", () => createMidiAppMock({
    page: (...args: any[]) => pageImpl(args[0], args[1], args[2]),
}));
mock.module("@app/permissions", () => ({ canImportMidi: () => true, isPbeAdmin: () => true }));
mock.module("@app/PianoWorld", () => ({ pianoWorld: { get: () => undefined } }));

const { MusicLibraryPage } = await import("../src/app/ui/midi/libraryUI");
const { MusicCardPage } = await import("../src/app/ui/midi/cardUI");
const { PlayQueuePage } = await import("../src/app/ui/midi/queueUI");
const { TrackActionsPage } = await import("../src/app/ui/midi/trackActions");
const { MidiPlayerPage } = await import("../src/app/ui/midi/playerUI");
const { MidiImportPage } = await import("../src/app/ui/midi/importUI");

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

function fakeStorage(entries: StoredMusicEntry[], label = "测试卡") {
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
        label,
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
    return new MidiPlayer({ acquire: async () => undefined }, { note() {}, playing() {}, stopNotes() {} });
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
        cardUid: undefined,
        readBytes: () => undefined,
        refreshCardIndicator: () => {},
        ...overrides,
    };
    return { piano, midi, storage };
}

function cardAccess(entries: StoredMusicEntry[], uid = "card-a") {
    const storage = fakeStorage(entries);
    return {
        uid,
        item: {},
        storage: () => storage,
        refreshLore: () => {},
    };
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

function dropdown(form: FakeCustomForm) {
    const component = form.components.find(item => item.type === "dropdown") as { value: FakeObservable<number> };
    return component.value;
}

function searchField(form: FakeCustomForm) {
    return form.components.find(item => item.type === "textField")!.value as FakeObservable<string>;
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

const libraryMetas = [
    { id: "l1", name: "晴天", duration: 800, noteCount: 120, bytes: 2048 },
    { id: "l2", name: "夜曲", duration: 900, noteCount: 140, bytes: 3072 },
];

beforeEach(() => {
    host.reset();
    pageImpl = async () => ({ items: [], total: 0 });
});

describe("公共曲库与管理/添加模式", () => {
    test("管理模式默认展示公共曲库，点击歌曲进入详情", async () => {
        pageImpl = async () => ({ items: libraryMetas, total: 2 });
        const { piano } = makePiano();
        const args: any = { piano };
        const form = open(MusicLibraryPage, args);
        await settle();

        expect(form.buttonLabels()).toContain("[库] 晴天");
        form.click("[库] 晴天");
        expect(host.nav.pushed.at(-1)!.form).toBe(TrackActionsPage);
        expect((host.nav.pushed.at(-1)!.args as any).ref.source).toBe("library");
        expect((host.nav.pushed.at(-1)!.args as any).ref.noteCount).toBe(120);
        expect(args.tab).toBe("library");
    });

    test("添加模式点击歌曲直接加入队列，留在当前页且不重复添加", async () => {
        const entries = [makeEntry("c1", "卡上歌")];
        const cardStorage = fakeStorage(entries);
        const { piano, midi } = makePiano({
            cardAccess: cardAccess(entries),
            cardStorage,
            cardUid: "card-a",
        });
        const form = open(MusicLibraryPage, { piano, tab: "card", mode: "add" });
        await settle();

        form.click("[卡] 卡上歌");
        expect(midi.queue.getLength()).toBe(1);
        expect(host.nav.pushed).toHaveLength(0);
        expect(form.buttonLabels().some(label => label.startsWith("✓ "))).toBe(true);

        form.click("✓ [卡] 卡上歌");
        expect(midi.queue.getLength()).toBe(1);
        expect(form.labelTexts().some(text => text.includes("队列中已有"))).toBe(true);
    });

    test("搜索框自动查询并解析末尾 p 页码；返回重建保持来源/搜索/页码", async () => {
        const calls: Array<{ page: number; q?: string }> = [];
        pageImpl = async (page, _size, q) => {
            calls.push({ page, q });
            return { items: libraryMetas, total: 40 };
        };
        const { piano } = makePiano();
        const args: any = { piano };
        const form = open(MusicLibraryPage, args);
        await settle();

        searchField(form).setData("周杰伦 p5");
        await settle();

        expect(args.query).toBe("周杰伦");
        expect(args.page).toBe(5);
        expect(calls.at(-1)).toEqual({ page: 5, q: "周杰伦" });
        expect(form.labelTexts().some(text => text.includes("第 §f5"))).toBe(true);

        const rebuilt = open(MusicLibraryPage, args);
        expect(dropdown(rebuilt).getData()).toBe(0);
        expect(searchField(rebuilt).getData()).toBe("周杰伦 p5");
    });

    test("手动翻页同步更新搜索框页码", async () => {
        pageImpl = async () => ({ items: libraryMetas, total: 40 });
        const { piano } = makePiano();
        const form = open(MusicLibraryPage, { piano });
        await settle();

        form.click("下一页 ▶");
        await settle();
        expect(searchField(form).getData()).toBe("p2");

        form.click("◀ 上一页");
        await settle();
        expect(searchField(form).getData()).toBe("");
    });

    test("每页固定 5 首，页码超出范围自动回到有效页", async () => {
        const metas = Array.from({ length: 5 }, (_, index) => ({
            id: `l${index}`,
            name: `歌曲${index}`,
            duration: 800,
        }));
        pageImpl = async () => ({ items: metas, total: 12 });
        const { piano } = makePiano();
        const args: any = { piano };
        const form = open(MusicLibraryPage, args);
        await settle();

        const songButtons = form.buttonLabels().filter(label => label.startsWith("[库] "));
        expect(songButtons).toHaveLength(5);

        searchField(form).setData("p12");
        await settle();
        // 12 首 / 每页 5 首 = 3 页
        expect(args.page).toBe(3);
        expect(searchField(form).getData()).toBe("p3");
    });

    test("切换来源时未插卡给出明确状态", async () => {
        const { piano } = makePiano();
        const form = open(MusicLibraryPage, { piano });
        await settle();

        dropdown(form).setData(1);
        await settle();

        const labels = form.labelTexts();
        expect(labels.some(text => text.includes("卡槽为空"))).toBe(true);
        expect(form.buttonLabels()).not.toContain("[卡] 小星星");
    });
});

describe("存储卡页面", () => {
    test("卡被弹出后页面进入空卡状态，只保留卡片自身操作", async () => {
        const { piano } = makePiano({ cardAccess: cardAccess([makeEntry("c1", "卡上歌")], "card-a") });
        const form = open(MusicCardPage, { piano });
        expect(form.buttonLabels()).toContain("弹出存储卡");
        expect(form.buttonLabels()).toContain("保存名称");
        expect(form.buttonLabels()).not.toContain("导入 MIDI 到这张卡");
        expect(form.buttonLabels()).not.toContain("在曲库中浏览这张卡");
        expect(form.buttonLabels()).not.toContain("卡上歌");

        piano.cardAccess = undefined;
        const empty = open(MusicCardPage, { piano });
        expect(empty.labelTexts().some(text => text.includes("未插卡"))).toBe(true);
        expect(empty.buttonLabels()).not.toContain("插入手中的卡");
    });
});

describe("播放队列页面", () => {
    test("不再包含播放控制，卡来源曲目在取卡后标记为不可用", () => {
        const { piano, midi } = makePiano({
            music: { availability: (ref: { source: string }) => ref.source === "card" ? "missing" : "ok" },
        });
        midi.queue.enqueue({ id: "s1", name: "卡上的歌", duration: 1200, source: "card", cardUid: "card-a", checksum: "abcd1234" });
        const form = open(PlayQueuePage, { piano });

        expect(form.buttonLabels().some(label => label.includes("⚠") && label.includes("卡上的歌"))).toBe(true);
        expect(form.buttonLabels()).not.toContain("▶ 播放 / 继续");
        expect(form.buttonLabels()).not.toContain("⏮ 上一首");
        expect(form.buttonLabels()).not.toContain("⏭ 下一首");
    });

    test("添加歌曲直接进入曲库添加模式", () => {
        const { piano } = makePiano();
        const form = open(PlayQueuePage, { piano });
        form.click("＋ 添加歌曲");
        expect(host.nav.pushed.at(-1)!.form).toBe(MusicLibraryPage);
        expect((host.nav.pushed.at(-1)!.args as any).mode).toBe("add");
    });
});

describe("歌曲详情页面", () => {
    test("公共曲库且未插卡：只显示播放/加入队列，不显示复制或删除", () => {
        const { piano } = makePiano();
        const form = open(TrackActionsPage, {
            piano,
            ref: { id: "l1", name: "晴天", duration: 1200, source: "library", noteCount: 10, bytes: 200 },
        });

        const buttons = form.buttonLabels();
        expect(buttons).toContain("▶ 立即播放");
        expect(buttons).toContain("＋ 加入播放队列");
        expect(buttons).not.toContain("复制到存储卡");
        expect(buttons).not.toContain("删除歌曲");
        expect(buttons).not.toContain("复制到钢琴");
        expect(form.labelTexts()).toContain("§7音符：§f10");
        expect(form.labelTexts()).toContain("§7大小：§f200 B");
    });

    test("公共曲库已插卡显示复制；存储卡歌曲显示删除、不显示复制", () => {
        const { piano } = makePiano({ cardAccess: cardAccess([]) });
        const libraryForm = open(TrackActionsPage, {
            piano,
            ref: { id: "l1", name: "晴天", duration: 1200, source: "library" },
        });
        expect(libraryForm.buttonLabels()).toContain("复制到存储卡");
        expect(libraryForm.buttonLabels()).not.toContain("删除歌曲");

        const cardForm = open(TrackActionsPage, {
            piano,
            ref: { id: "c1", name: "卡上歌", duration: 1200, source: "card", cardUid: "card-a" },
        });
        expect(cardForm.buttonLabels()).toContain("删除歌曲");
        expect(cardForm.buttonLabels()).not.toContain("复制到存储卡");
    });

    test("立即播放使用播放业务层接口，不直接清空队列", () => {
        const { piano, midi } = makePiano();
        const calls: string[] = [];
        midi.queue.enqueue({ id: "keep", name: "保留", duration: 100, source: "library" });
        piano.getMidiPlayer = () => ({
            queue: midi.queue,
            playNow: (ref: any) => { calls.push(`play:${ref.id}`); return Promise.resolve(); },
            addToQueue: () => "added",
            getInfo: () => ({ state: "idle" }),
        });
        const form = open(TrackActionsPage, {
            piano,
            ref: { id: "l1", name: "晴天", duration: 1200, source: "library" },
        });
        form.click("▶ 立即播放");
        expect(calls).toEqual(["play:l1"]);
        expect(midi.queue.getLength()).toBe(1);
        expect(midi.queue.current()?.id).toBe("keep");
    });
});

describe("MIDI 导入页面", () => {
    test("未插卡时提示并禁止开始导入", () => {
        const { piano } = makePiano();
        const form = open(MidiImportPage, { piano });
        expect(form.labelTexts().some(text => text.includes("卡槽为空"))).toBe(true);
        expect(form.components.some(component => component.type === "textField")).toBe(false);
    });

    test("已插卡时直接以当前存储卡为目标，不再出现目标下拉框", () => {
        const entries: StoredMusicEntry[] = [];
        const { piano } = makePiano({ cardAccess: cardAccess(entries) });
        const form = open(MidiImportPage, { piano });
        expect(form.components.some(component => component.type === "textField")).toBe(true);
        expect(form.components.some(component => component.type === "dropdown")).toBe(false);
        expect(form.labelTexts().some(text => text.includes("当前卡槽"))).toBe(true);
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

    test("未插卡时直接不显示“存储卡”入口", () => {
        const bare = makePiano();
        const block = { isValid: true } as any;
        host.DDUI.open(makePlayer("no-card"), MidiPlayerPage, { piano: bare.piano, block });
        expect(host.lastForm().buttonLabels()).not.toContain("存储卡");

        const withCard = makePiano({ cardAccess: { item: {} } });
        host.DDUI.open(makePlayer("has-card"), MidiPlayerPage, { piano: withCard.piano, block });
        expect(host.lastForm().buttonLabels()).toContain("存储卡");
    });
});
