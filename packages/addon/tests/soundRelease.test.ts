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

    test("stops a pedal-extended note when the 4s sample ends", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const sound = new FakeSound();
        queue.add(sound, 60, 30, 0);

        queue.update(79); // 4 秒采样尚未结束
        expect(sound.fades).toHaveLength(0);
        expect(sound.stops).toBe(0);

        queue.update(80); // 采样自然结束：直接 stop，不再淡出
        expect(sound.fades).toHaveLength(0);
        expect(sound.stops).toBe(1);
        expect(queue.size).toBe(0);
    });

    test("holds higher notes for less time because the sample is pitch-shifted", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        const low = new FakeSound();
        const high = new FakeSound();
        queue.add(low, 48, 30, 0, 100, false, 1); // 4s
        queue.add(high, 84, 30, 0, 100, false, 2); // 2s

        queue.update(40);
        expect(high.stops).toBe(1);
        expect(low.stops).toBe(0);

        queue.update(80);
        expect(low.stops).toBe(1);
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

    test("default capacity follows the piano voice budget", () => {
        const queue = new SoundReleaseQueue(0.6, 20);
        expect(queue.capacity).toBe(28);
    });

    test("makeRoom drops a quieter new note instead of stealing", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 2);
        const loud = new FakeSound();
        const medium = new FakeSound();
        queue.add(loud, 60, 1, 0, 100);
        queue.add(medium, 62, 1, 0, 80);

        expect(queue.makeRoom(70, false, 64)).toBe(false);
        expect(queue.dropped).toBe(1);
        expect(queue.evictions).toBe(0);
        expect(loud.fades).toHaveLength(0);
        expect(queue.size).toBe(2);
    });

    test("makeRoom does not drop a new note with the same velocity", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 2);
        const first = new FakeSound();
        const second = new FakeSound();
        queue.add(first, 60, 1, 0, 100);
        queue.add(second, 62, 1, 0, 100);

        // 全曲力度相同的 MIDI（例如《Secret》）不能因为“相等”就吞掉新旋律音。
        expect(queue.makeRoom(100, false, 64)).toBe(true);
        expect(queue.dropped).toBe(0);
        expect(queue.evictions).toBe(1);
        expect(queue.size).toBe(1);
    });

    test("makeRoom steals the quietest voice for a louder note", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 2);
        const loud = new FakeSound();
        const quiet = new FakeSound();
        queue.add(loud, 60, 1, 0, 110);
        queue.add(quiet, 62, 1, 0, 50);

        expect(queue.makeRoom(90, false, 64)).toBe(true);
        expect(quiet.stops).toBe(1);
        expect(loud.stops).toBe(0);

        const incoming = new FakeSound();
        queue.add(incoming, 64, 1, 1, 90);
        expect(queue.evictions).toBe(1);
        expect(queue.size).toBe(2);
    });

    test("manual keystrokes win over sequenced notes", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 2);
        const music = new FakeSound();
        const other = new FakeSound();
        queue.add(music, 60, 1, 0, 110);
        queue.add(other, 62, 1, 0, 100);

        expect(queue.makeRoom(1, 1, true, 64)).toBe(true);
        expect(music.stops + other.stops).toBe(1);
    });

    test("retriggering the same key does not evict another voice", () => {
        const queue = new SoundReleaseQueue(0.6, 20, 2);
        const first = new FakeSound();
        const other = new FakeSound();
        queue.add(first, 60, 1, 0, 100);
        queue.add(other, 62, 1, 0, 100);

        expect(queue.makeRoom(20, false, 60)).toBe(true);
        expect(queue.evictions).toBe(0);
    });
});
