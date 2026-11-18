import { describe, expect, it } from "vitest";
import { SongCache, encodePbe3, type MidiSong } from "../src/index.js";

const song: MidiSong = {
    id: "abc12345",
    name: "测试曲目",
    duration: 40 * 30,
    tracks: [
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [60, 0, 100, 90, 64, 800, 100, 80, 67, 1600, 50, 70],
        },
    ],
};

describe("SongCache", () => {
    it("同一首歌只加载一次，并被多个句柄共享", async () => {
        const pbe3 = encodePbe3(song);
        let loads = 0;
        const cache = new SongCache(async () => {
            loads++;
            return pbe3;
        });
        const [a, b] = await Promise.all([cache.acquire(song.id), cache.acquire(song.id)]);
        expect(loads).toBe(1);
        expect(a?.song).toBe(b?.song);
        a?.release();
        b?.release();
        expect(cache.size).toBe(1);
    });

    it("LRU 只淘汰无活跃引用的曲目", async () => {
        const a = encodePbe3(song);
        const b = encodePbe3({ ...song, id: "bbb", name: "B", duration: 100 });
        const cache = new SongCache(async (id) => (id === song.id ? a : b), {
            maxBytes: a.length + b.length - 1,
            now: (() => {
                let tick = 0;
                return () => ++tick;
            })(),
        });
        const handle = await cache.acquire(song.id);
        await cache.acquire("bbb");
        expect(cache.size).toBe(2); // first still referenced
        handle?.release();
        expect(cache.size).toBe(1); // over budget, unused first evicted
    });

    it("加载失败不留下半成品，且返回 undefined", async () => {
        const cache = new SongCache(async () => new Uint8Array([1, 2, 3]));
        expect(await cache.acquire("bad")).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it("预算不是单曲大小限制：播放中的超预算歌曲不会被淘汰", async () => {
        const pbe3 = encodePbe3(song);
        const cache = new SongCache(async () => pbe3, { maxBytes: 1 });
        const handle = await cache.acquire(song.id);
        expect(handle).toBeDefined();
        expect(cache.size).toBe(1);
        expect(cache.stats().activeSongs).toBe(1);

        handle?.release();
        expect(cache.size).toBe(0);
        expect(cache.stats().evictions).toBe(1);
        expect(cache.stats().activeSongs).toBe(0);
    });

    it("统计命中、未命中与活跃引用，释放后活跃数归零", async () => {
        const pbe3 = encodePbe3(song);
        const cache = new SongCache(async () => pbe3);
        const first = await cache.acquire(song.id);
        const second = await cache.acquire(song.id);
        const stats = cache.stats();
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(1);
        expect(stats.activeSongs).toBe(1);
        expect(stats.activeBytes).toBeGreaterThan(0);

        first?.release();
        expect(cache.stats().activeSongs).toBe(1);
        second?.release();
        expect(cache.stats().activeSongs).toBe(0);
    });
});
