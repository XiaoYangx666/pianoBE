import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_PIANO_SETTINGS } from "../src/domain/piano/settings";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createSapiProMock, FakeObservable } from "./support/fakeDDUI";

const host = createDDUIHost();

mock.module("@minecraft/server", () => ({
    system: {
        get currentTick() { return 100; },
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
    TextPrimitive: class {},
    MolangVariableMap: class {
        setVector3() {}
        setFloat() {}
    },
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
        UserClosed: "UserClosed",
    },
    FormRejectError: class extends Error {},
    uiManager: { closeAllForms: () => {} },
}));

mock.module("sapi-pro", () => createSapiProMock(host));

const { PianoSettingsPage } = await import("../src/app/ui/settingsUI");
const { ParticleSettingsPage } = await import("../src/app/ui/particleSettingsUI");
const { TextSettingsPage } = await import("../src/app/ui/textSettingsUI");
const { PianoScorePage } = await import("../src/app/ui/scoreUI");

function makePiano(overrides: { hasScreen?: boolean } = {}) {
    let settings = { ...DEFAULT_PIANO_SETTINGS } as any;
    const piano: any = {
        hasScreen: overrides.hasScreen ?? true,
        displayId: "display-1",
        location: { dimension: { id: "overworld" } },
        get settings() { return settings; },
        isAlive: () => true,
        verify: () => "complete",
        disposedSignal: new Signal<void>(),
        updateSettings(_previous: any, next: any) {
            settings = { ...next };
            return true;
        },
        flushSettings() {},
    };
    return {
        piano,
        getSettings: () => settings,
    };
}

function makePlayer() {
    const messages: string[] = [];
    return {
        player: {
            id: "p1",
            isValid: true,
            dimension: { id: "overworld" },
            sendMessage: (message: string) => { messages.push(message); },
        } as any,
        messages,
    };
}

function open(page: unknown, args: unknown) {
    const { player } = makePlayer();
    host.DDUI.open(player, page, args);
    return host.lastForm();
}

beforeEach(() => {
    host.reset();
});

describe("钢琴设置（拆分为多个表单）", () => {
    test("主表单只保留常用设置，并给出三个子页入口", () => {
        const { piano } = makePiano();
        const form = open(PianoSettingsPage, { piano });

        expect(form.buttonLabels()).toContain("粒子设置");
        expect(form.buttonLabels()).toContain("文字设置");
        expect(form.buttonLabels()).toContain("曲谱配置");
        // 主表单只有一个滑块（音量），文字相关控件已移出
        expect(form.sliders).toHaveLength(1);
        expect(form.components.filter(item => item.type === "textField")).toHaveLength(0);
    });

    test("三个子页都用 push 进入，返回时回到主表单", () => {
        const { piano } = makePiano();
        const form = open(PianoSettingsPage, { piano });

        form.click("粒子设置");
        expect(host.nav.pushed.at(-1)!.form).toBe(ParticleSettingsPage);

        const second = open(PianoSettingsPage, { piano });
        second.click("文字设置");
        expect(host.nav.pushed.at(-1)!.form).toBe(TextSettingsPage);

        const third = open(PianoSettingsPage, { piano });
        third.click("曲谱配置");
        expect(host.nav.pushed.at(-1)!.form).toBe(PianoScorePage);
    });

    test("粒子子页的开关与样式直接写回钢琴设置", () => {
        const { piano, getSettings } = makePiano();
        const form = open(ParticleSettingsPage, { piano });

        const toggle = form.components.find(item => item.type === "toggle");
        expect(toggle).toBeDefined();
        (toggle!.value as FakeObservable<boolean>).setData(false);
        expect(getSettings().particles).toBe(false);

        const dropdowns = form.components.filter(item => item.type === "dropdown");
        expect(dropdowns).toHaveLength(2);
        (dropdowns[0].value as FakeObservable<number>).setData(2);
        expect(getSettings().particleStyle).toBe(2);
    });

    test("文字子页在无屏幕的三角钢琴上只提示，不显示控件", () => {
        const { piano } = makePiano({ hasScreen: false });
        const form = open(TextSettingsPage, { piano });

        expect(form.sliders).toHaveLength(0);
        expect(form.labelTexts().join("\n")).toContain("没有琴面显示屏");
    });

    test("文字子页在有屏幕时提供完整控件", () => {
        const { piano } = makePiano();
        const form = open(TextSettingsPage, { piano });

        expect(form.sliders).toHaveLength(5);
        expect(form.components.filter(item => item.type === "textField")).toHaveLength(2);
    });
});

describe("DDUI 页面栈", () => {
    test("子页面不再放冗余“返回”，只保留原生关闭", () => {
        const { piano } = makePiano();
        for (const page of [ParticleSettingsPage, TextSettingsPage, PianoScorePage]) {
            const form = open(page, { piano });
            expect(form.buttonLabels()).not.toContain("返回");
            expect(form.components.some(item => item.type === "closeButton")).toBe(true);
        }
    });
});
