import { expect, test } from "bun:test";
import { TaskQueue } from "../src/services/transcribeJobs";

function tick(ms = 20): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test("并发 1 时任务串行执行", async () => {
    const queue = new TaskQueue(1);
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    queue.add("a", async () => {
        events.push("a:start");
        await gate;
        events.push("a:end");
    });
    queue.add("b", async () => {
        events.push("b:start");
    });

    await tick();
    expect(events).toEqual(["a:start"]);
    expect(queue.activeCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    release();
    await tick();
    expect(events).toEqual(["a:start", "a:end", "b:start"]);
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
});

test("并发上限 2 时同时跑两个", async () => {
    const queue = new TaskQueue(2);
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    queue.add("a", async () => {
        events.push("a");
        await gate;
    });
    queue.add("b", async () => {
        events.push("b");
        await gate;
    });
    queue.add("c", async () => {
        events.push("c");
    });

    await tick();
    expect(events).toEqual(["a", "b"]);
    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);

    release();
    await tick();
    expect(events).toEqual(["a", "b", "c"]);
    expect(queue.activeCount).toBe(0);
});

test("任务抛错不会卡住后续任务", async () => {
    const queue = new TaskQueue(1);
    const done: string[] = [];
    const original = console.error;
    console.error = () => {};
    try {
        queue.add("boom", async () => {
            throw new Error("boom");
        });
        queue.add("next", async () => {
            done.push("next");
        });
        await tick();
    } finally {
        console.error = original;
    }
    expect(done).toEqual(["next"]);
    expect(queue.activeCount).toBe(0);
});

test("取消排队任务后不再执行，队列计数释放", async () => {
    const queue = new TaskQueue(1);
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    queue.add("running", async () => {
        events.push("running:start");
        await gate;
    });
    queue.add("waiting", async () => {
        events.push("waiting:start");
    });
    await tick();
    expect(queue.pendingCount).toBe(1);
    expect(queue.cancel("waiting")).toBe(true);
    expect(queue.pendingCount).toBe(0);
    release();
    await tick();
    expect(events).toEqual(["running:start"]);
});

test("取消执行中的任务会触发 AbortSignal", async () => {
    const queue = new TaskQueue(1);
    let aborted = false;
    queue.add("running", async (signal) => {
        signal.addEventListener("abort", () => {
            aborted = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
    });
    await tick(5);
    expect(queue.cancel("running")).toBe(true);
    await tick(60);
    expect(aborted).toBe(true);
    expect(queue.activeCount).toBe(0);
});
