import { describe, expect, mock, test } from "bun:test";
import { encodePbe3, crc32Hex, type MusicRef, type StoredMusicEntry } from "@piano/core";
import { readPlaybackRecord } from "../src/domain/playback/playbackRecord";
import { PlayQueue } from "../src/domain/playback/queue";

mock.module("@app/midiManager", () => ({
    midiManager: {
        acquire: async () => undefined,
        getInfo: () => undefined,
        read: async () => undefined,
        performanceEntries: () => [],
        performances: () => [],
    },
}));

const { PianoMusic } = await import("../src/app/music/pianoMusic");

function music(id: string, notes = 6): Uint8Array {
    const values: number[] = [];
    for (let index = 0; index < notes; index++) values.push(60 + (index % 12), index * 40, 20, 90);
    return encodePbe3({
        id,
        name: `曲目 ${id}`,
        duration: Math.max(1, notes * 40),
        tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: values }],
    });
}

function stored(bytes: Uint8Array): StoredMusicEntry {
    return {
        v: 1,
        id: "abc",
        name: "测试",
        duration: 40,
        noteCount: 6,
        bytes: bytes.length,
        checksum: crc32Hex(bytes),
        shards: 1,
        gen: "g",
        createdAt: 1,
    };
}

function fakeStorage(entries: StoredMusicEntry[], data: Map<string, Uint8Array>) {
    return {
        label: "测试卡",
        list: () => entries,
        has: (id: string) => entries.some(entry => entry.id === id),
        get: (id: string) => data.get(id),
        save: () => { throw new Error("not used"); },
        remove: () => false,
        rename: () => undefined,
        usage: () => ({ songs: entries.length, usedBytes: 0, limitBytes: 65536, remainingBytes: 65536 }),
        setLimit: () => {},
        limitBytes: 65536,
    };
}

describe("播放队列（带来源）", () => {
    test("同 id 不同来源不是同一首", () => {
        const queue = new PlayQueue();
        const fromLibrary: MusicRef = { id: "x", name: "X", duration: 40, source: "library", checksum: "1111" };
        const fromCard: MusicRef = { id: "x", name: "X", duration: 40, source: "card", checksum: "1111" };
        queue.enqueue(fromLibrary);
        queue.enqueue(fromCard);
        expect(queue.getLength()).toBe(2);
        expect(queue.indexOf(fromCard)).toBe(1);
        expect(queue.indexOf(fromLibrary)).toBe(0);
    });

    test("同一曲目存放在不同实体卡中，队列不会错误去重", () => {
        const queue = new PlayQueue();
        const ref: MusicRef = { id: "x", name: "X", duration: 40, source: "card", checksum: "abc12345", cardUid: "card-a" };
        queue.enqueue(ref);
        expect(queue.enqueueUnique({ ...ref, cardUid: "card-b" })).toBe("added");
        expect(queue.indexOf({ ...ref, cardUid: "card-b" })).toBe(1);
        expect(queue.getLength()).toBe(2);
    });

    test("快照/恢复保留来源，旧调用仍可按 id 查找", () => {
        const queue = new PlayQueue();
        queue.enqueue({ id: "a", name: "A", duration: 40, source: "card", checksum: "abcd" });
        const snapshot = queue.snapshot();
        const restored = new PlayQueue();
        restored.restore(snapshot);
        expect(restored.current()?.source).toBe("card");
        expect(restored.indexOf("a")).toBe(0);
    });
});

describe("播放快照兼容", () => {
    test("旧 v1 快照按曲库来源读取，不丢队列", () => {
        const raw = JSON.stringify({
            version: 1,
            songs: [{ id: "old", name: "老歌", duration: 400 }],
            index: 0,
            mode: "loop",
            state: "paused",
            seconds: 12,
        });
        const record = readPlaybackRecord(raw)!;
        expect(record.version).toBe(2);
        expect(record.songs[0].source).toBe("library");
        expect(record.mode).toBe("loop");
    });

    test("坏快照整份拒绝，而不是恢复到半份队列", () => {
        const raw = JSON.stringify({
            version: 2,
            songs: [{ id: "ok", name: "好", duration: 40, source: "card" }, { nope: true }],
            index: 0,
            mode: "sequence",
            state: "playing",
            seconds: 0,
        });
        expect(readPlaybackRecord(raw)).toBeUndefined();
    });
});

describe("钢琴音乐读取（PianoMusic）", () => {
    test("可用性按指纹与卡片身份判断：同 id 不同内容/不同卡视为不可用", () => {
        const bytes = music("abc");
        const entry = stored(bytes);
        const musicSource = new PianoMusic(
            () => fakeStorage([entry], new Map([["abc", bytes]])),
            () => "card-a"
        );
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-a", checksum: entry.checksum, bytes: entry.bytes })).toBe("ok");
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-a", checksum: "deadbeef" })).toBe("missing");
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-b", checksum: entry.checksum })).toBe("missing");
        // 公共曲库：元信息未登记时返回 unknown，交给实际加载判断。
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "library" })).toBe("unknown");
    });

    test("读取时校验长度与 CRC，内容不符不会交给播放器", async () => {
        const bytes = music("abc");
        const entry = stored(bytes);
        const source = new PianoMusic(
            () => fakeStorage([entry], new Map([["abc", bytes]])),
            () => "card-a"
        );

        const ok = await source.acquire({ id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-a", checksum: entry.checksum, bytes: entry.bytes });
        expect(ok?.song.id).toBe("abc");
        ok?.release();

        const bad = await source.acquire({ id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-a", checksum: "00000000" });
        expect(bad).toBeUndefined();
    });

    test("索引未登记时，公共曲库引用自带的演出摘要仍可读取", () => {
        const source = new PianoMusic(() => undefined, () => undefined);
        const entry = {
            id: "pianobe.pack.featured:abc",
            name: "精选演出",
            songId: "abc",
            requiredEffects: ["starfield"],
        };
        const ref: MusicRef = {
            id: "abc",
            name: "花海",
            duration: 40,
            source: "library",
            performanceEntries: [entry],
        };
        expect(source.performanceEntries(ref)).toEqual([entry]);
        expect(source.performances(ref)).toEqual([]);
    });

    test("引用自带演出 cues 时直接解析，不再依赖索引", async () => {
        const source = new PianoMusic(() => undefined, () => undefined);
        const cues = [{ tick: 0, op: "flash" as const, effect: "starfield", color: "#FFFFFF", level: 80, scale: 100 }];
        const ref: MusicRef = {
            id: "abc",
            name: "花海",
            duration: 40,
            source: "library",
            performanceEntries: [{
                id: "pianobe.pack.featured:abc",
                name: "精选演出",
                songId: "abc",
                cues,
            }],
        };
        expect(await source.resolvePerformanceCues(ref, "pianobe.pack.featured:abc")).toEqual(cues);
    });

    test("存储卡被取走或被替换后，卡来源的队列条目不可用", () => {
        let cardPresent = true;
        let cardUid = "card-a";
        const bytes = music("c1");
        const entry = stored(bytes);
        const cardStorage = fakeStorage([entry], new Map([["abc", bytes]]));
        const source = new PianoMusic(
            () => cardPresent ? cardStorage : undefined,
            () => cardUid
        );
        const ref: MusicRef = { id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-a", checksum: entry.checksum };
        expect(source.availability(ref)).toBe("ok");
        // 换成另一张卡：即使 id/内容一致也不能当作同一张卡。
        cardUid = "card-b";
        expect(source.availability(ref)).toBe("missing");
        cardUid = "card-a";
        expect(source.availability(ref)).toBe("ok");
        cardPresent = false;
        expect(source.availability(ref)).toBe("missing");
    });

    test("缓存命中也必须检查卡片身份与曲目是否仍存在", async () => {
        const bytes = music("abc");
        const entry = stored(bytes);
        let uid = "card-a";
        let present = true;
        let tracks = [entry];
        const source = new PianoMusic(
            () => present ? fakeStorage(tracks, new Map([["abc", bytes]])) : undefined,
            () => uid
        );
        const ref: MusicRef = { id: "abc", name: "测试", duration: 40, source: "card", cardUid: "card-a", checksum: entry.checksum, bytes: entry.bytes };
        const first = await source.acquire(ref);
        expect(first).toBeDefined();
        first?.release();
        present = false;
        expect(await source.acquire(ref)).toBeUndefined();
        present = true;
        uid = "card-b";
        expect(await source.acquire(ref)).toBeUndefined();
        uid = "card-a";
        tracks = [];
        expect(await source.acquire(ref)).toBeUndefined();
        tracks = [entry];
        const again = await source.acquire(ref);
        expect(again).toBeDefined();
        again?.release();
    });
});
