import { describe, expect, test } from "bun:test";
import { PlayQueue } from "../src/domain/playback/queue";

const song = (id: string) => ({ id, name: id, duration: 1 });

describe("PlayQueue.indexOf", () => {
    test("finds existing songs and returns -1 for missing ids", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));

        expect(queue.indexOf("a")).toBe(0);
        expect(queue.indexOf("b")).toBe(1);
        expect(queue.indexOf("missing")).toBe(-1);
    });

    test("reflects removals", () => {
        const queue = new PlayQueue();
        queue.enqueue(song("a"));
        queue.enqueue(song("b"));
        queue.remove(0);

        expect(queue.indexOf("a")).toBe(-1);
        expect(queue.indexOf("b")).toBe(0);
    });
});
