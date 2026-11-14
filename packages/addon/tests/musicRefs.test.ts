import { describe, expect, mock, test } from "bun:test";
import { encodePbe2, crc32Hex, type MusicRef, type StoredMusicEntry } from "@piano/core";
import { readPlaybackRecord } from "../src/domain/playback/playbackRecord";
import { PlayQueue } from "../src/domain/playback/queue";

mock.module("@app/midiManager", () => ({
    midiManager: {
        acquire: async () => undefined,
        getInfo: () => undefined,
        read: async () => undefined,
    },
}));

const { PianoMusic } = await import("../src/app/music/pianoMusic");

function music(id: string, notes = 6): Uint8Array {
    const values: number[] = [];
    for (let index = 0; index < notes; index++) values.push(60 + (index % 12), index * 40, 20, 90);
    return encodePbe2({
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
        kind: "piano" as const,
        label: "测试钢琴",
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
        const fromPiano: MusicRef = { id: "x", name: "X", duration: 40, source: "piano", checksum: "1111" };
        const fromCard: MusicRef = { id: "x", name: "X", duration: 40, source: "card", checksum: "1111" };
        queue.enqueue(fromPiano);
        queue.enqueue(fromCard);
        expect(queue.getLength()).toBe(2);
        expect(queue.indexOf(fromCard)).toBe(1);
        expect(queue.indexOf(fromPiano)).toBe(0);
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
            songs: [{ id: "ok", name: "好", duration: 40, source: "piano" }, { nope: true }],
            index: 0,
            mode: "sequence",
            state: "playing",
            seconds: 0,
        });
        expect(readPlaybackRecord(raw)).toBeUndefined();
    });
});

describe("钢琴音乐读取（PianoMusic）", () => {
    test("可用性按指纹判断：同 id 不同内容视为不可用", () => {
        const bytes = music("abc");
        const entry = stored(bytes);
        const musicSource = new PianoMusic(
            () => fakeStorage([entry], new Map([["abc", bytes]])),
            () => undefined
        );
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "piano", checksum: entry.checksum, bytes: entry.bytes })).toBe("ok");
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "piano", checksum: "deadbeef" })).toBe("missing");
        expect(musicSource.availability({ id: "abc", name: "测试", duration: 40, source: "card" })).toBe("missing");
    });

    test("读取时校验长度与 CRC，内容不符不会交给播放器", async () => {
        const bytes = music("abc");
        const entry = stored(bytes);
        const source = new PianoMusic(
            () => fakeStorage([entry], new Map([["abc", bytes]])),
            () => undefined
        );

        const ok = await source.acquire({ id: "abc", name: "测试", duration: 40, source: "piano", checksum: entry.checksum, bytes: entry.bytes });
        expect(ok?.song.id).toBe("abc");
        ok?.release();

        const bad = await source.acquire({ id: "abc", name: "测试", duration: 40, source: "piano", checksum: "00000000" });
        expect(bad).toBeUndefined();
    });

    test("存储卡被取走后，卡来源的队列条目不可用", () => {
        let cardPresent = true;
        const bytes = music("c1");
        const entry = stored(bytes);
        const cardStorage = fakeStorage([entry], new Map([["abc", bytes]]));
        const source = new PianoMusic(
            () => undefined,
            () => cardPresent ? cardStorage : undefined
        );
        const ref: MusicRef = { id: "abc", name: "测试", duration: 40, source: "card", checksum: entry.checksum };
        expect(source.availability(ref)).toBe("ok");
        cardPresent = false;
        expect(source.availability(ref)).toBe("missing");
    });
});
