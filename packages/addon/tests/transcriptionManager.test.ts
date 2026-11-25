import { describe, expect, test } from "bun:test";
import type { StoredMusicEntry } from "@piano/core";
import {
    COMPLETED_CHECK_MS,
    MAX_POLL_FAILURES,
    POLL_INTERVAL_MS,
    RESULT_TTL_MS,
    TranscriptionManager,
    WAIT_TIMEOUT_MS,
    type TranscriptionClient,
} from "../src/app/server/transcription/manager";
import { OnlineTranscribeError, type TranscribeJob, type TranscribeSong } from "../src/platform/server/admin/transcribeClient";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createScheduler() {
    let callback: (() => void) | undefined;
    let stopped = false;
    return {
        schedule: (next: () => void) => {
            callback = next;
            return () => {
                stopped = true;
                callback = undefined;
            };
        },
        tick: () => callback?.(),
        get stopped() {
            return stopped;
        },
    };
}

function job(stage: TranscribeJob["stage"], patch: Partial<TranscribeJob> = {}): TranscribeJob {
    return {
        id: "job-1",
        stage,
        name: "曲目",
        message: "",
        percent: 0,
        noteCount: 10,
        ...patch,
    };
}

function song(): TranscribeSong {
    return {
        id: "song-1",
        name: "曲目",
        duration: 400,
        noteCount: 10,
        bytes: 8,
        expiresAt: 0,
        pbe3: new Uint8Array([1, 2, 3]),
    };
}

interface ClientState {
    started: Array<{ input: string; d: ReturnType<typeof deferred<{ id: string }>> }>;
    getJobCalls: string[];
    cancelled: string[];
    pendingJob?: ReturnType<typeof deferred<TranscribeJob>>;
    jobResult: TranscribeJob | (() => Promise<TranscribeJob>);
    songResult: TranscribeSong | (() => Promise<TranscribeSong>);
}

function makeClient(): { client: TranscriptionClient; state: ClientState } {
    const state: ClientState = {
        started: [],
        getJobCalls: [],
        cancelled: [],
        jobResult: job("queued"),
        songResult: song(),
    };
    const client: TranscriptionClient = {
        startBilibili(input) {
            const d = deferred<{ id: string }>();
            state.started.push({ input, d });
            return d.promise;
        },
        getJob(id) {
            state.getJobCalls.push(id);
            if (state.pendingJob) return state.pendingJob.promise;
            return typeof state.jobResult === "function" ? state.jobResult() : Promise.resolve(state.jobResult);
        },
        getSong() {
            return typeof state.songResult === "function" ? state.songResult() : Promise.resolve(state.songResult);
        },
        cancel(id) {
            state.cancelled.push(id);
            return Promise.resolve();
        },
    };
    return { client, state };
}

function createManager(client: TranscriptionClient, options: {
    notify?: (playerId: string, message: string) => void;
    now?: () => number;
} = {}) {
    const scheduler = createScheduler();
    let now = 10_000;
    const clock = options.now ?? (() => now);
    const manager = new TranscriptionManager({
        client,
        notify: options.notify ?? (() => {}),
        schedule: scheduler.schedule,
        now: clock,
    });
    return {
        manager,
        scheduler,
        advance(ms: number) {
            now += ms;
        },
    };
}

async function startTask(
    manager: TranscriptionManager,
    clientState: ClientState,
    jobId = "job-1",
    playerId = "p1"
) {
    const pending = manager.submit(playerId, "BV1xx411c7mD");
    clientState.started.at(-1)!.d.resolve({ id: jobId });
    await pending;
    return manager.get(playerId)!;
}

describe("TranscriptionManager", () => {
    test("每个玩家最多一个任务，并发提交不会绕过限制", async () => {
        const { client, state } = makeClient();
        const { manager } = createManager(client);
        const first = manager.submit("p1", "BV1");
        const second = await manager.submit("p1", "BV2");
        expect(second.ok).toBe(false);
        expect(state.started).toHaveLength(1);

        state.started[0]!.d.resolve({ id: "job-1" });
        expect((await first).ok).toBe(true);
        expect(manager.get("p1")?.stage).toBe("queued");
    });

    test("已完成但未导入的结果继续占用名额", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler, advance } = createManager(client);
        const task = await startTask(manager, state);
        state.jobResult = job("done", { updatedAt: 10_000 });
        scheduler.tick();
        await flush();
        expect(task.stage).toBe("done");
        expect((await manager.submit("p1", "BV2")).ok).toBe(false);
        advance(COMPLETED_CHECK_MS);
        expect((await manager.submit("p1", "BV3")).ok).toBe(false);
    });

    test("多个玩家的任务互相独立", async () => {
        const { client, state } = makeClient();
        const { manager } = createManager(client);
        await startTask(manager, state, "job-1", "p1");
        await startTask(manager, state, "job-2", "p2");
        expect(manager.get("p1")?.jobId).toBe("job-1");
        expect(manager.get("p2")?.jobId).toBe("job-2");
        manager.cancel("p1");
        expect(manager.get("p2")?.jobId).toBe("job-2");
        expect(state.cancelled).toEqual(["job-1"]);
    });

    test("提交尚未返回时玩家退出，返回的远程任务会被清理", async () => {
        const { client, state } = makeClient();
        const { manager } = createManager(client);
        const pending = manager.submit("p1", "BV1");
        manager.releasePlayer("p1");
        expect(manager.get("p1")).toBeUndefined();

        state.started[0]!.d.resolve({ id: "job-orphan" });
        expect((await pending).ok).toBe(false);
        await flush();
        expect(state.cancelled).toEqual(["job-orphan"]);
    });

    test("取消后旧提交返回的任务 ID 会被清理，不会覆盖新任务", async () => {
        const { client, state } = makeClient();
        const { manager } = createManager(client);
        const oldSubmit = manager.submit("p1", "BV-old");
        manager.cancel("p1");

        const newSubmit = manager.submit("p1", "BV-new");
        expect(state.started).toHaveLength(2);
        state.started[0]!.d.resolve({ id: "job-old" });
        state.started[1]!.d.resolve({ id: "job-new" });

        expect((await oldSubmit).ok).toBe(false);
        expect((await newSubmit).ok).toBe(true);
        await flush();
        expect(state.cancelled).toContain("job-old");
        expect(manager.get("p1")?.jobId).toBe("job-new");
    });

    test("旧任务迟到的轮询结果不会修改新任务", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state, "job-old");

        const pending = deferred<TranscribeJob>();
        state.pendingJob = pending;
        scheduler.tick();
        expect(state.getJobCalls).toEqual(["job-old"]);

        manager.cancel("p1");
        state.pendingJob = undefined;
        await startTask(manager, state, "job-new");

        pending.resolve(job("done", { id: "job-old", name: "旧任务" }));
        await flush();
        expect(manager.get("p1")?.jobId).toBe("job-new");
        expect(manager.get("p1")?.stage).toBe("queued");
    });

    test("同一个任务不会并发发起多次状态查询", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);

        const pending = deferred<TranscribeJob>();
        state.pendingJob = pending;
        scheduler.tick();
        scheduler.tick();
        scheduler.tick();
        expect(state.getJobCalls).toHaveLength(1);
        pending.resolve(job("transcribing"));
        await flush();
    });

    test("没有任务时不发起网络请求", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        scheduler.tick();
        expect(state.getJobCalls).toHaveLength(0);
        manager.dispose();
    });

    test("转录完成只通知一次，之后不再高频轮询", async () => {
        let notified = 0;
        const { client, state } = makeClient();
        const { manager, scheduler, advance } = createManager(client, { notify: () => notified++ });
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();
        expect(notified).toBe(1);

        advance(COMPLETED_CHECK_MS + 1);
        scheduler.tick();
        await flush();
        expect(notified).toBe(1);
        expect(state.getJobCalls).toHaveLength(2);
    });

    test("完成任务在结果过期后释放并反馈玩家", async () => {
        const messages: string[] = [];
        const { client, state } = makeClient();
        const { manager, scheduler, advance } = createManager(client, {
            notify: (_playerId, message) => messages.push(message),
        });
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();

        advance(RESULT_TTL_MS);
        scheduler.tick();
        await flush();
        expect(manager.get("p1")).toBeUndefined();
        expect(messages.at(-1)).toContain("过期");
    });

    test("任务失败后不再继续轮询", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler, advance } = createManager(client);
        await startTask(manager, state);
        state.jobResult = job("error", { error: "音频下载失败" });
        scheduler.tick();
        await flush();
        expect(manager.get("p1")?.stage).toBe("failed");
        expect(state.getJobCalls).toHaveLength(1);

        for (let i = 0; i < 3; i++) {
            advance(POLL_INTERVAL_MS + 1);
            scheduler.tick();
            await flush();
        }
        expect(state.getJobCalls).toHaveLength(1);
    });

    test("服务端任务 404 时结束对应任务", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);
        state.jobResult = (() => Promise.reject(new OnlineTranscribeError("任务不存在或已过期", 404)));
        scheduler.tick();
        await flush();
        expect(manager.get("p1")?.stage).toBe("failed");
        expect(state.cancelled).toContain("job-1");
    });

    test("等待超时后结束任务并尽力取消远程任务", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler, advance } = createManager(client);
        await startTask(manager, state);
        advance(WAIT_TIMEOUT_MS + 1);
        scheduler.tick();
        expect(manager.get("p1")?.stage).toBe("failed");
        expect(manager.get("p1")?.error).toContain("超时");
        expect(state.cancelled).toContain("job-1");
    });

    test("连续轮询失败达到上限后结束任务", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler, advance } = createManager(client);
        await startTask(manager, state);
        state.jobResult = (() => Promise.reject(new Error("网络断开")));
        for (let i = 0; i < MAX_POLL_FAILURES; i++) {
            scheduler.tick();
            await flush();
            advance(POLL_INTERVAL_MS + 1);
        }
        expect(manager.get("p1")?.stage).toBe("failed");
    });

    test("导入成功后释放任务并清理远程结果", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();

        let saved = 0;
        const entry: StoredMusicEntry = { name: "曲目" } as StoredMusicEntry;
        const result = await manager.importToCard("p1", {
            isUsable: () => true,
            cardUid: () => "card-1",
            save: () => {
                saved++;
                return entry;
            },
            refresh: () => {},
        });
        expect(result.entry).toBe(entry);
        expect(saved).toBe(1);
        expect(manager.get("p1")).toBeUndefined();
        expect(state.cancelled).toContain("job-1");
    });

    test("导入失败保留结果，换卡后可再次导入", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();

        let uid = "card-1";
        await expect(manager.importToCard("p1", {
            isUsable: () => true,
            cardUid: () => uid,
            save: () => {
                throw new Error("容量不足");
            },
            refresh: () => {},
        })).rejects.toThrow("容量不足");
        expect(manager.get("p1")?.stage).toBe("done");

        uid = "card-2";
        const entry: StoredMusicEntry = { name: "曲目" } as StoredMusicEntry;
        await manager.importToCard("p1", {
            isUsable: () => true,
            cardUid: () => uid,
            save: () => entry,
            refresh: () => {},
        });
        expect(manager.get("p1")).toBeUndefined();
    });

    test("获取结果期间换卡会中止写入，结果保留", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();

        const pending = deferred<TranscribeSong>();
        state.songResult = () => pending.promise;
        let uid = "card-1";
        let saved = 0;
        const importing = manager.importToCard("p1", {
            isUsable: () => true,
            cardUid: () => uid,
            save: () => {
                saved++;
                return { name: "曲目" } as StoredMusicEntry;
            },
            refresh: () => {},
        });
        uid = "card-2";
        pending.resolve(song());
        await expect(importing).rejects.toThrow("替换");
        expect(saved).toBe(0);
        expect(manager.get("p1")?.stage).toBe("done");
    });

    test("重复点击导入只会写入一次", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();

        const pending = deferred<TranscribeSong>();
        state.songResult = () => pending.promise;
        let saved = 0;
        const target = {
            isUsable: () => true,
            cardUid: () => "card-1",
            save: () => {
                saved++;
                return { name: "曲目" } as StoredMusicEntry;
            },
            refresh: () => {},
        };
        const first = manager.importToCard("p1", target);
        await expect(manager.importToCard("p1", target)).rejects.toThrow("正在导入");
        pending.resolve(song());
        await first;
        expect(saved).toBe(1);
    });

    test("获取结果期间被取消时不写入，也不影响后续新任务", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state);
        state.jobResult = job("done");
        scheduler.tick();
        await flush();

        const pending = deferred<TranscribeSong>();
        state.songResult = () => pending.promise;
        let saved = 0;
        const importing = manager.importToCard("p1", {
            isUsable: () => true,
            cardUid: () => "card-1",
            save: () => {
                saved++;
                return { name: "曲目" } as StoredMusicEntry;
            },
            refresh: () => {},
        });
        manager.cancel("p1");
        await startTask(manager, state, "job-new");
        pending.resolve(song());
        await expect(importing).rejects.toThrow("已结束");
        expect(saved).toBe(0);
        expect(manager.get("p1")?.jobId).toBe("job-new");
    });

    test("管理器销毁后异步请求才返回，不会发布状态或再次通知", async () => {
        let notified = 0;
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client, { notify: () => notified++ });
        await startTask(manager, state);
        const pending = deferred<TranscribeJob>();
        state.pendingJob = pending;
        scheduler.tick();

        manager.dispose();
        pending.resolve(job("done"));
        await flush();
        expect(notified).toBe(0);
        expect(manager.get("p1")).toBeUndefined();
    });

    test("玩家退出释放本地任务并取消远程任务", async () => {
        const { client, state } = makeClient();
        const { manager } = createManager(client);
        await startTask(manager, state);
        expect(manager.releasePlayer("p1")).toBe(true);
        expect(manager.get("p1")).toBeUndefined();
        await flush();
        expect(state.cancelled).toEqual(["job-1"]);
    });

    test("管理器销毁后停止轮询、释放全部任务且不再发布状态", async () => {
        const { client, state } = makeClient();
        const { manager, scheduler } = createManager(client);
        await startTask(manager, state, "job-1", "p1");
        await startTask(manager, state, "job-2", "p2");
        manager.dispose();
        expect(scheduler.stopped).toBe(true);
        expect(manager.get("p1")).toBeUndefined();
        expect(manager.get("p2")).toBeUndefined();
        expect(state.cancelled.sort()).toEqual(["job-1", "job-2"]);
        scheduler.tick();
        expect(state.getJobCalls).toHaveLength(0);
        expect((await manager.submit("p1", "BV")).ok).toBe(false);
    });
});
