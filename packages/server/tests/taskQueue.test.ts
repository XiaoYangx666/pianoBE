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

    queue.add(async () => {
        events.push("a:start");
        await gate;
        events.push("a:end");
    });
    queue.add(async () => {
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

    queue.add(async () => {
        events.push("a");
        await gate;
    });
    queue.add(async () => {
        events.push("b");
        await gate;
    });
    queue.add(async () => {
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
        queue.add(async () => {
            throw new Error("boom");
        });
        queue.add(async () => {
            done.push("next");
        });
        await tick();
    } finally {
        console.error = original;
    }
    expect(done).toEqual(["next"]);
    expect(queue.activeCount).toBe(0);
});
