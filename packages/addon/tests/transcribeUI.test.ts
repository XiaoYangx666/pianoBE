import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { StoredMusicEntry } from "@piano/core";
import { Signal } from "../src/domain/util/signal";
import { createDDUIHost, createSapiProMock, FakeObservable } from "./support/fakeDDUI";
import type { TranscribeJob, TranscribeSong } from "../src/platform/server/admin/transcribeClient";

/**
 * 在线转录页面回归测试：
 * - 页面只读管理器状态，关闭页面不取消任务；
 * - 重新打开能恢复进行中/已完成状态；
 * - 导入走管理器，成功后释放任务。
 */

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
        getDynamicPropertyIds: () => [],
        getDynamicProperty: () => undefined,
        setDynamicProperty: () => {},
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
mock.module("@app/permissions", () => ({
    canImportMidi: () => true,
    isPbeAdmin: () => false,
}));

const { TranscriptionManager } = await import("../src/app/server/transcription/manager");
const { TranscribePage } = await import("../src/app/server/transcription/ui");

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeEntry(name: string): StoredMusicEntry {
    return { id: "song-1", name, duration: 400, noteCount: 10, bytes: 8, checksum: "x" } as StoredMusicEntry;
}

function createHarness(options: {
    stage?: TranscribeJob["stage"];
    withCard?: boolean;
    saveFails?: boolean;
} = {}) {
    const started: Array<ReturnType<typeof deferred<{ id: string }>>> = [];
    const cancelled: string[] = [];
    const state = {
        job: {
            id: "job-1",
            stage: options.stage ?? "transcribing",
            name: "测试曲目",
            message: "转录音符…",
            percent: 42,
            noteCount: 0,
            midiDuration: 800,
            dataSize: 2048,
        } as TranscribeJob,
        song: {
            id: "song-1",
            name: "测试曲目",
            duration: 800,
            noteCount: 10,
            bytes: 2048,
            expiresAt: 0,
            pbe3: new Uint8Array([1, 2, 3]),
        } as TranscribeSong,
    };
    let callback: (() => void) | undefined;
    let now = 10_000;
    let uid = "card-1";
    let saved = 0;

    const manager = new TranscriptionManager({
        client: {
            startBilibili() {
                const d = deferred<{ id: string }>();
                started.push(d);
                return d.promise;
            },
            getJob: async () => state.job,
            getSong: async () => state.song,
            cancel: async (id) => { cancelled.push(id); },
        },
        notify: () => {},
        schedule: (next) => { callback = next; return () => { callback = undefined; }; },
        now: () => now,
    });

    const entry = makeEntry("测试曲目");
    const storage = {
        label: "音乐存储卡",
        usage: () => ({ songs: 1, usedBytes: 1024, limitBytes: 65536, remainingBytes: 64512 }),
        save: () => {
            if (options.saveFails) throw new Error("容量不足");
            saved++;
            return entry;
        },
    };
    const cardAccess = options.withCard === false ? undefined : {
        uid,
        storage: () => storage,
        refreshLore: () => {},
    };
    const disposed = new Signal<void>();
    const piano = {
        disposedSignal: disposed,
        isAlive: () => true,
        get cardAccess() { return cardAccess; },
        refreshCardIndicator: () => {},
    };
    const player = { id: "p1", isValid: true };

    return {
        manager,
        piano,
        player,
        started,
        cancelled,
        state,
        entry,
        tick: () => callback?.(),
        advance: (ms: number) => { now += ms; },
        changeCard: (next: string) => { uid = next; if (cardAccess) cardAccess.uid = next; },
        saved: () => saved,
        open: () => {
            const ui = host.DDUI.open(player, TranscribePage, { piano, manager });
            return ui;
        },
    };
}

async function queueTask(h: ReturnType<typeof createHarness>) {
    const submit = h.manager.submit("p1", "BV1xx411c7mD");
    h.started.at(-1)!.resolve({ id: "job-1" });
    await submit;
}

async function completeTask(h: ReturnType<typeof createHarness>) {
    await queueTask(h);
    h.state.job = { ...h.state.job, stage: "done" };
    h.tick();
    await flush();
}

describe("TranscribePage", () => {
    beforeEach(() => host.reset());

    test("启动时提交，进行中只展示状态与取消入口", async () => {
        const h = createHarness();
        await queueTask(h);
        h.tick();
        await flush();
        h.open();
        const form = host.lastForm();
        expect(form.buttonLabels()).toContain("取消任务");
        expect(form.buttonLabels()).not.toContain("开始转录");
        expect(form.buttonLabels()).not.toContain("导入存储卡");
        expect(form.labelTexts().join("\n")).toContain("转录中");
        expect(form.labelTexts().join("\n")).toContain("42%");
    });

    test("更换存储卡不影响转录任务", async () => {
        const h = createHarness();
        await queueTask(h);
        h.changeCard("card-2");
        h.tick();
        await flush();
        expect(h.manager.get("p1")?.stage).toBe("transcribing");
    });

    test("关闭页面不取消任务，重新打开恢复进度", async () => {
        const h = createHarness();
        await queueTask(h);
        const first = h.open();
        first.close();
        expect(h.cancelled).toHaveLength(0);
        expect(h.manager.get("p1")?.jobId).toBe("job-1");
        expect(h.manager.changeSignal.listenerCount()).toBe(0);

        h.state.job = { ...h.state.job, percent: 77, message: "转录音符…" };
        h.tick();
        await flush();
        h.open();
        const form = host.lastForm();
        expect(form.buttonLabels()).toContain("取消任务");
        expect(form.labelTexts().join("\n")).toContain("77%");
    });

    test("关闭页面后仍会收到完成状态，重新打开显示结果", async () => {
        const h = createHarness();
        await queueTask(h);
        h.open().close();

        h.state.job = { ...h.state.job, stage: "done" };
        h.tick();
        await flush();
        expect(h.manager.get("p1")?.stage).toBe("done");

        h.open();
        const form = host.lastForm();
        expect(form.buttonLabels()).toContain("导入存储卡");
        expect(form.buttonLabels()).toContain("丢弃结果");
        expect(form.labelTexts().join("\n")).toContain("测试曲目");
        expect(form.labelTexts().join("\n")).toContain("0:20");
    });

    test("导入成功后释放任务并回到输入界面", async () => {
        const h = createHarness();
        await completeTask(h);
        h.open();
        host.lastForm().click("导入存储卡");
        await flush();

        expect(h.saved()).toBe(1);
        expect(h.manager.get("p1")).toBeUndefined();
        expect(h.cancelled).toContain("job-1");
        expect(host.lastForm().buttonLabels()).toContain("开始转录");
    });

    test("导入失败保留结果并提示可重试", async () => {
        const h = createHarness({ saveFails: true });
        await completeTask(h);
        h.open();
        host.lastForm().click("导入存储卡");
        await flush();

        expect(h.manager.get("p1")?.stage).toBe("done");
        expect(host.lastForm().labelTexts().join("\n")).toContain("容量不足");
        expect(host.lastForm().buttonLabels()).toContain("导入存储卡");
    });

    test("丢弃结果会释放任务并取消远程任务", async () => {
        const h = createHarness();
        await completeTask(h);
        h.open();
        host.lastForm().click("丢弃结果");
        await flush();
        expect(h.manager.get("p1")).toBeUndefined();
        expect(h.cancelled).toContain("job-1");
    });

    test("失败任务可清除并重新提交，不自动重试", async () => {
        const h = createHarness();
        await queueTask(h);
        h.state.job = { ...h.state.job, stage: "error", error: "音频下载失败" };
        h.tick();
        await flush();
        h.open();
        expect(host.lastForm().buttonLabels()).toContain("清除失败任务");
        expect(host.lastForm().labelTexts().join("\n")).toContain("音频下载失败");

        host.lastForm().click("清除失败任务");
        expect(h.manager.get("p1")).toBeUndefined();
        expect(host.lastForm().buttonLabels()).toContain("开始转录");
        expect(h.started).toHaveLength(1);
    });

    test("导入时没有存储卡会提示，任务保留", async () => {
        const h = createHarness({ withCard: false });
        await completeTask(h);
        h.open();
        host.lastForm().click("导入存储卡");
        await flush();
        expect(h.saved()).toBe(0);
        expect(h.manager.get("p1")?.stage).toBe("done");
        expect(host.lastForm().labelTexts().join("\n")).toContain("请先把音乐存储卡");
    });
});
