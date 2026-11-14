import { beforeEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createMidiAppMock, createSapiProMock, FakeCustomForm, FakeObservable } from "./support/fakeDDUI";

/**
 * 主钢琴面板迁移后的回归测试。
 *
 * 覆盖迁移中最容易退化的行为：
 * - 输入 → 发声、状态文本、输入长度限制与清空；
 * - 简洁模式 / 升八度 / 快捷键的持久化（程序同步不能误触发持久化）；
 * - 页面局部 active notes 只更新 4 行文本，不重建表单；
 * - 页面按钮把设置 / 曲谱 / MIDI / 导入压入同一个表单栈；
 * - 钢琴销毁时页面自动关闭。
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

mock.module("sapi-pro", () => createSapiProMock(host));

let location: any;
let currentPiano: any;

mock.module("@platform/assembly", () => ({
    resolveInstrument: () => location,
}));

mock.module("@app/PianoWorld", () => ({
    pianoWorld: { get: () => currentPiano },
}));

mock.module("@app/permissions", () => ({
    canImportMidi: () => true,
    isPbeAdmin: () => false,
}));

mock.module("@app/midi", () => createMidiAppMock());

// 播放列表页面依赖 @ext / sapi-pro-func，本测试不关心它；只替换掉这个模块
mock.module(path.resolve(import.meta.dir, "../src/app/ui/midi/playListUI.ts"), () => ({
    PlayListMainForm: { name: "PlayListMainForm" },
}));

const { openPiano, PianoPanelPage } = await import("../src/app/ui/piano");
const { PianoSettingsPage } = await import("../src/app/ui/settingsUI");
const { PianoScorePage } = await import("../src/app/ui/scoreUI");
const { MidiPlayerPage } = await import("../src/app/ui/midi/playerUI");
const { MidiImportPage } = await import("../src/app/ui/midi/importUI");

type PlayedNote = { midi: number; layer: unknown; duration: number };

function makePiano() {
    const played: PlayedNote[] = [];
    const piano: any = {
        settings: { soundLayer: "standard", scoreId: undefined, scoreMounted: false },
        hasScreen: true,
        location: { dimension: { id: "overworld" } },
        center: { x: 0, y: 0, z: 0 },
        noteSignal: new Signal(),
        tickSignal: new Signal(),
        disposedSignal: new Signal(),
        isAlive: () => true,
        verify: () => "complete",
        playNote: (note: any, layer: unknown, duration: number) => {
            played.push({ midi: note.midi, layer, duration });
        },
        getMidiPlayer: () => ({ isAlive: () => false }),
        played,
    };
    return piano;
}

function makePlayer(id = "p1", initial: Record<string, unknown> = {}) {
    const properties = new Map<string, unknown>(Object.entries(initial));
    return {
        id,
        isValid: true,
        dimension: { id: "overworld" },
        location: { x: 0, y: 0, z: 0 },
        getDynamicProperty: (key: string) => properties.get(key),
        setDynamicProperty: (key: string, value: unknown) => {
            properties.set(key, value);
        },
        sendMessage: () => {},
        properties,
    } as any;
}

function makeBlock() {
    const block: any = { isValid: true, location: { x: 0, y: 0, z: 0 } };
    location = { pos: { x: 0, y: 0, z: 0 }, dimension: { id: "overworld", getBlock: () => block } };
    return block;
}

function openPanel(player = makePlayer()) {
    const piano = makePiano();
    currentPiano = piano;
    const block = makeBlock();
    openPiano(player, block);
    return { player, piano, block, form: host.lastForm(), ui: host.active()! };
}

function findToggle(form: FakeCustomForm, label: string) {
    const component = form.components.find((item) => item.type === "toggle" && item.label === label);
    expect(component).toBeDefined();
    return component!.value as FakeObservable<boolean>;
}

beforeEach(() => {
    host.reset();
    location = undefined;
    currentPiano = undefined;
});

describe("主钢琴面板", () => {
    test("打开面板会挂上输入框、常驻开关与所有入口按钮", () => {
        const { form } = openPanel();

        expect(form.isShowing()).toBe(true);
        expect(host.forms()).toHaveLength(1);
        expect(form.components.filter((item) => item.type === "label").length).toBeGreaterThanOrEqual(6);
        expect(form.components.some((item) => item.type === "textField")).toBe(true);
        expect(form.buttonLabels()).toEqual(
            expect.arrayContaining([
                "♪ MIDI 播放器",
                "钢琴设置",
                "曲谱配置",
                "快捷键设置",
                "导入 MIDI",
            ])
        );
    });

    test("输入字符会按当前键位发声并更新状态文本，且不重建表单", () => {
        const { piano, form, ui } = openPanel();
        const input = form.components.find((item) => item.type === "textField")!.value as FakeObservable<string>;

        input.setData("z");

        expect(piano.played).toHaveLength(1);
        expect(piano.played[0].midi).toBe(48);
        expect(piano.played[0].duration).toBeCloseTo(0.15);
        const status = form.components.filter((item) => item.type === "label")[0].text as FakeObservable<string>;
        expect(status.getData()).toContain("音符");
        expect(host.forms()).toHaveLength(1);
        expect(ui.isClosed).toBe(false);
    });

    test("单音模式保留输入，连音快捷键切换后才能自动清空", async () => {
        // 默认 comMode = true（单音）：输入不会被自动清空
        const { form } = openPanel();
        const input = form.components.find((item) => item.type === "textField")!.value as FakeObservable<string>;
        input.setData("z");
        await Promise.resolve();
        await Promise.resolve();
        expect(input.getData()).toBe("z");

        // 绑定 “!” 为连音快捷键：同一次输入里切换模式后按连音模式清空
        const shortcutPlayer = makePlayer("p2", { "piano:shortcuts": JSON.stringify({ legato: "!" }) });
        const next = openPanel(shortcutPlayer);
        const nextInput = next.form.components.find((item) => item.type === "textField")!.value as FakeObservable<string>;
        nextInput.setData("z!");
        await Promise.resolve();
        await Promise.resolve();
        expect(nextInput.getData()).toBe("");
        expect(shortcutPlayer.properties.get("piano:comMode")).toBe(false);
    });

    test("单音模式下长时间输入只保留尾部 32 个字符", async () => {
        const { form } = openPanel();
        const input = form.components.find((item) => item.type === "textField")!.value as FakeObservable<string>;

        input.setData("z".repeat(40));

        expect(input.getData()).toHaveLength(32);
        expect(input.getData()).toBe("z".repeat(32));
    });

    test("简洁模式与升八度会写入玩家动态属性，打开时的同步不会误写", () => {
        const { player, form, piano } = openPanel();
        const compact = findToggle(form, "简洁模式");
        const octave = findToggle(form, "升8度 (高音模式)");

        // 打开时的同步（ui.set）不应持久化
        expect(player.properties.has("piano:compact")).toBe(false);

        compact.setData(true);
        octave.setData(true);

        expect(player.properties.get("piano:compact")).toBe(true);
        expect(player.properties.get("piano:octave")).toBe(true);
        expect(piano.played).toEqual([]);
    });

    test("页面局部按键状态只更新键位行文本", () => {
        const { piano, form } = openPanel();
        // label 顺序：状态、空行、4 行键位、空行
        const rows = form.components.filter((item) => item.type === "label").slice(2, 6);
        expect(rows).toHaveLength(4);

        piano.noteSignal.publish({ midi: 48, duration: 0.2 });
        const text = rows.map((row) => (row.text as FakeObservable<string>).getData());
        expect(text.some((row) => row.includes("§a§lz"))).toBe(true);

        // 发声结束后高亮消失
        piano.tickSignal.publish(10000);
        const after = rows.map((row) => (row.text as FakeObservable<string>).getData());
        expect(after.some((row) => row.includes("§a§lz"))).toBe(false);
        expect(host.forms()).toHaveLength(1);
    });


    test("同一音符再次触发会延长高亮，过期由运行时 tick 清理", () => {
        const { piano, form } = openPanel();
        const rows = form.components.filter((item) => item.type === "label").slice(2, 6);
        const highlighted = () => rows.some((row) =>
            (row.text as FakeObservable<string>).getData().includes("§a§lz")
        );

        piano.noteSignal.publish({ midi: 48, duration: 0.2 });
        piano.tickSignal.publish(103);
        expect(highlighted()).toBe(true);
        piano.noteSignal.publish({ midi: 48, duration: 0.4 });
        piano.tickSignal.publish(105);
        expect(highlighted()).toBe(true);
        piano.tickSignal.publish(108);
        expect(highlighted()).toBe(false);
        expect(host.forms()).toHaveLength(1);
    });

    test("关闭后解除钢琴所有页面级信号监听，旧控件不再更新", () => {
        const { piano, form } = openPanel();
        const rows = form.components.filter((item) => item.type === "label").slice(2, 6);
        expect(piano.noteSignal.listenerCount()).toBe(1);
        expect(piano.tickSignal.listenerCount()).toBe(1);
        expect(piano.disposedSignal.listenerCount()).toBe(1);
        piano.noteSignal.publish({ midi: 48, duration: 0.2 });

        form.playerClose();
        expect(piano.noteSignal.listenerCount()).toBe(0);
        expect(piano.tickSignal.listenerCount()).toBe(0);
        expect(piano.disposedSignal.listenerCount()).toBe(0);
        const writes = rows.map((row) => (row.text as FakeObservable<string>).writes);
        piano.noteSignal.publish({ midi: 48, duration: 0.5 });
        piano.tickSignal.publish(101);
        expect(rows.map((row) => (row.text as FakeObservable<string>).writes)).toEqual(writes);
    });

    test("连续打开关闭同一架钢琴不会积累页面级订阅", () => {
        const { player, piano, block, form } = openPanel();
        form.playerClose();
        for (let i = 0; i < 20; i++) {
            openPiano(player, block);
            expect(piano.noteSignal.listenerCount()).toBe(1);
            expect(piano.tickSignal.listenerCount()).toBe(1);
            host.lastForm().playerClose();
            expect(piano.noteSignal.listenerCount()).toBe(0);
            expect(piano.tickSignal.listenerCount()).toBe(0);
            expect(piano.disposedSignal.listenerCount()).toBe(0);
        }
    });

    test("入口按钮把对应页面压入表单栈", () => {
        const { form } = openPanel();

        form.click("钢琴设置");
        expect(host.nav.pushed.at(-1)!.form).toBe(PianoSettingsPage);
        expect(host.nav.pushed.at(-1)!.args.piano).toBeDefined();

        const second = openPanel();
        second.form.click("曲谱配置");
        expect(host.nav.pushed.at(-1)!.form).toBe(PianoScorePage);

        const third = openPanel();
        third.form.click("♪ MIDI 播放器");
        expect(host.nav.pushed.at(-1)!.form).toBe(MidiPlayerPage);
        expect(host.nav.pushed.at(-1)!.args.piano).toBe(third.piano);

        const fourth = openPanel();
        fourth.form.click("导入 MIDI");
        expect(host.nav.pushed.at(-1)!.form).toBe(MidiImportPage);
    });

    test("钢琴销毁时面板自动关闭并释放订阅", () => {
        const { piano, form } = openPanel();
        expect(form.isShowing()).toBe(true);

        piano.disposedSignal.publish();

        expect(form.isShowing()).toBe(false);
        // 页面级订阅在钢琴销毁时解除
        expect(piano.noteSignal.listenerCount()).toBe(0);
    });

    test("面板重新打开时使用新的玩家状态，不累积旧页面", () => {
        const player = makePlayer();
        const piano = makePiano();
        currentPiano = piano;
        const block = makeBlock();

        openPiano(player, block);
        const first = host.lastForm();
        openPiano(player, block);

        expect(first.isShowing()).toBe(false);
        expect(host.lastForm().isShowing()).toBe(true);
        expect(host.forms()).toHaveLength(2);
        expect(PianoPanelPage).toBeDefined();
    });
});
