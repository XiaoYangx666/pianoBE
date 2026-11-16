import { describe, expect, test } from "bun:test";
import { SoundReleaseQueue, type ReleasableSound } from "../src/domain/playback/soundRelease";

class FakeSound implements ReleasableSound {
    fades: { duration: number; target: number }[] = [];
    stops = 0;
    failFade = false;

    fade(duration: number, target: number) {
        if (this.failFade) throw new Error("ended");
        this.fades.push({ duration, target });
    }

    stop() {
        this.stops++;
    }
}

describe("SoundReleaseQueue", () => {
    test("fades at note off and stops after the release", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const sound = new FakeSound();
        queue.add(sound, 60, 0.15, 100);

        queue.update(101);
        expect(sound.fades).toHaveLength(0);

        queue.update(103); // 0.15s = 3 ticks
        expect(sound.fades).toEqual([{ duration: 0.6, target: 0 }]);
        expect(sound.stops).toBe(0);

        queue.update(115); // 0.6s = 12 ticks
        expect(sound.stops).toBe(0);

        queue.update(116);
        expect(sound.stops).toBe(1);
        expect(queue.size).toBe(0);
    });

    test("retriggering the same key quickly damps the old instance", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const first = new FakeSound();
        const second = new FakeSound();
        queue.add(first, 60, 1, 0);
        queue.add(second, 60, 1, 5);

        expect(first.fades).toEqual([{ duration: 0.04, target: 0 }]);
        expect(second.fades).toHaveLength(0);

        queue.update(7);
        expect(first.stops).toBe(1);
    });

    test("keeps voices at different keys independent", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const first = new FakeSound();
        const second = new FakeSound();
        queue.add(first, 60, 0.1, 0);
        queue.add(second, 64, 0.5, 0);

        queue.update(2);
        expect(first.fades).toHaveLength(1);
        expect(second.fades).toHaveLength(0);

        queue.update(10);
        expect(second.fades).toHaveLength(1);
    });

    test("caps how long an unfinished note keeps its instance", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 96, 8);
        const sound = new FakeSound();
        queue.add(sound, 60, 30, 0);

        queue.update(159);
        expect(sound.fades).toHaveLength(0);

        queue.update(160); // 8 秒上限
        expect(sound.fades).toEqual([{ duration: 0.6, target: 0 }]);

        queue.update(173);
        expect(sound.stops).toBe(1);
        expect(queue.size).toBe(0);
    });

    test("drops a voice when fade fails", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const sound = new FakeSound();
        sound.failFade = true;
        queue.add(sound, 60, 0.05, 0);

        queue.update(1);
        expect(queue.size).toBe(0);
    });

    test("keeps the voice count bounded in dense passages", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 2);
        const first = new FakeSound();
        const second = new FakeSound();
        const third = new FakeSound();
        queue.add(first, 60, 1, 0);
        queue.add(second, 62, 1, 0);
        queue.add(third, 64, 1, 0);

        expect(queue.size).toBe(2);
        expect(first.stops).toBe(1);
        expect(second.stops).toBe(0);
    });

    test("stopAll stops every live instance", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const first = new FakeSound();
        const second = new FakeSound();
        queue.add(first, 60, 1, 0);
        queue.add(second, 64, 1, 0);

        queue.stopAll();
        expect(first.stops).toBe(1);
        expect(second.stops).toBe(1);
        expect(queue.size).toBe(0);
    });
});
