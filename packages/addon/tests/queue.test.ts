import { describe, expect, test } from "bun:test";
import { PlayQueue } from "../src/domain/playback/queue";

const song = (id: string) => ({ id, name: id, duration: 1, source: "library" as const, performanceId: "default" });

describe("PlayQueue.dropCurrent", () => {
    test("removes the failed entry and returns its successor", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));
        queue.enqueue(song("c"));
        queue.jump(0);

        expect(queue.dropCurrent()?.id).toBe("b");
        expect(queue.getRefs().map(ref => ref.name)).toEqual(["b", "c"]);
        expect(queue.current()?.id).toBe("b");
    });

    test("does not use the single-repeat rule when skipping a failed entry", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));
        queue.setMode("single");
        queue.jump(0);

        expect(queue.dropCurrent()?.id).toBe("b");
        expect(queue.next()?.id).toBe("b");
    });

    test("removes the requested ref even if the pointer moved while loading", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));
        queue.enqueue(song("c"));
        queue.jump(0);
        // 加载 a 期间玩家切到了 c。
        queue.jump(2);

        expect(queue.dropCurrent(song("a"))?.id).toBe("c");
        expect(queue.getRefs().map(ref => ref.name)).toEqual(["b", "c"]);
        expect(queue.current()?.id).toBe("c");
    });

    test("ends cleanly after dropping the last entry", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("only"));
        queue.jump(0);

        expect(queue.dropCurrent()).toBeUndefined();
        expect(queue.isEmpty()).toBe(true);
        expect(queue.isEnd()).toBe(true);
        expect(queue.next()).toBeUndefined();
    });
});

describe("PlayQueue.indexOf", () => {
    test("finds existing selections and returns -1 for missing selections", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));

        expect(queue.indexOf(song("a"))).toBe(0);
        expect(queue.indexOf(song("b"))).toBe(1);
        expect(queue.indexOf(song("missing"))).toBe(-1);
    });

    test("reflects removals", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));
        queue.remove(0);

        expect(queue.indexOf(song("a"))).toBe(-1);
        expect(queue.indexOf(song("b"))).toBe(0);
    });
});
