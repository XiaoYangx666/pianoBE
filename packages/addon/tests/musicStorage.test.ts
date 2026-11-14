import { describe, expect, test } from "bun:test";
import {
    MusicCollection,
    MusicValidationError,
    StorageBudget,
    encodePbe2,
    entryStoredBytes,
    metaKey,
    musicRefKey,
    type MidiSong,
} from "@piano/core";
import { MemoryKv } from "./support/fakeItems";

const PREFIX = "pb.test.";

function song(id: string, name = id, notes = 8, compress: boolean | "auto" = "auto"): Uint8Array {
    const values: number[] = [];
    for (let index = 0; index < notes; index++) {
        values.push(60 + (index % 12), index * 40, 20, 90);
    }
    const midi: MidiSong = {
        id,
        name,
        duration: Math.max(1, notes * 40),
        tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: values }],
    };
    return encodePbe2(midi, { compress });
}

function collection(kv: MemoryKv, limit: () => number) {
    return new MusicCollection(kv, PREFIX, limit, {
        now: () => 1_700_000_000_000,
        random: () => "abcd",
    });
}

describe("音乐存储：提交与读取", () => {
    test("保存后可完整读回，并按实际字节计量", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 64 * 1024);
        const bytes = song("a1", "小星星", 12);
        const entry = store.save(bytes);

        expect(store.entries()).toHaveLength(1);
        expect(store.get(entry.id)).toEqual(bytes);
        const usage = store.usage();
        expect(usage.usedBytes).toBe(entryStoredBytes(PREFIX, entry));
        expect(usage.usedBytes).toBeGreaterThan(bytes.length);
        expect(usage.remainingBytes).toBe(64 * 1024 - usage.usedBytes);
    });

    test("同一首重复写入只保留一条，并清理旧世代分片", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 64 * 1024);
        const bytes = song("a2");
        const first = store.save(bytes);
        const before = kv.keys().filter(key => key.startsWith(`${PREFIX}d.`)).length;

        const second = store.save(bytes);
        expect(store.entries()).toHaveLength(1);
        expect(second.id).toBe(first.id);
        expect(kv.keys().filter(key => key.startsWith(`${PREFIX}d.`)).length).toBe(before);
    });

    test("分片写入：大曲目会拆成多个动态属性分片", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 1024 * 1024);
        const entry = store.save(song("big", "大会", 6000, false));
        expect(entry.shards).toBeGreaterThan(1);
        expect(store.get(entry.id)?.length).toBe(entry.bytes);
    });

    test("分片被篡改时不返回错误内容", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 64 * 1024);
        const entry = store.save(song("a3"));
        const key = `${PREFIX}d.${entry.id}.${entry.gen}.0`;
        kv.set(key, "AAAA");
        expect(store.get(entry.id)).toBeUndefined();
    });

    test("非法/损坏的 PBE2 被拒绝，且不会留下可见记录", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 64 * 1024);
        expect(() => store.save(new Uint8Array([1, 2, 3]))).toThrow(MusicValidationError);
        expect(store.entries()).toHaveLength(0);
        expect(kv.keys().filter(key => key.startsWith(`${PREFIX}m.`))).toHaveLength(0);
    });
});

describe("音乐存储：容量边界", () => {
    test("刚好到达上限可以写入，少 1 字节即拒绝并提示差额", () => {
        const bytes = song("limit");
        const probe = new MemoryKv();
        const entry = collection(probe, () => 64 * 1024).save(bytes);
        const exact = entryStoredBytes(PREFIX, entry);

        const okKv = new MemoryKv();
        const ok = collection(okKv, () => exact).save(bytes);
        expect(ok.id).toBe(entry.id);

        const fullKv = new MemoryKv();
        expect(() => collection(fullKv, () => exact - 1).save(bytes)).toThrow(/容量不足/);
        expect(fullKv.keys().filter(key => key.startsWith(`${PREFIX}m.`))).toHaveLength(0);
    });

    test("替换同 id 时先释放旧占用", () => {
        const kv = new MemoryKv();
        let limit = 64 * 1024;
        const store = collection(kv, () => limit);
        const bytes = song("same", "旧名", 30);
        const first = store.save(bytes);
        const used = store.usage().usedBytes;

        // 上限只留一点余量：同名替换（同内容）可以，另一首放不下。
        limit = used + 32;
        expect(store.save(bytes).id).toBe(first.id);
        expect(() => store.save(song("other"))).toThrow(/容量不足/);
    });

    test("管理员调低上限后仍可读取/删除，但禁止新增", () => {
        const kv = new MemoryKv();
        let limit = 64 * 1024;
        const store = collection(kv, () => limit);
        const entry = store.save(song("keep", "keep", 2000, false));
        const bytes = store.get(entry.id)!;

        limit = 4 * 1024;
        expect(store.get(entry.id)).toEqual(bytes);
        expect(() => store.save(song("blocked"))).toThrow(/容量不足/);
        expect(store.remove(entry.id)).toBe(true);
        expect(store.entries()).toHaveLength(0);
    });

    test("StorageBudget 用实际落盘字节而不是原始长度判断", () => {
        const entry = collection(new MemoryKv(), () => 1 << 20).save(song("budget"));
        const stored = entryStoredBytes(PREFIX, entry);
        const budget = new StorageBudget(stored);
        expect(budget.check(PREFIX, [], entry).ok).toBe(true);
        const tight = new StorageBudget(stored - 1);
        const result = tight.check(PREFIX, [], entry);
        expect(result.ok).toBe(false);
        expect(result.shortBytes).toBe(1);
        expect(result.message).toContain("还差");
    });
});

describe("音乐存储：中断与恢复", () => {
    test("元数据提交失败会回滚本次分片，旧版本仍可读", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 64 * 1024);
        const first = store.save(song("safe", "第一版"));
        const oldBytes = store.get(first.id)!;

        kv.failOn = metaKey(PREFIX, first.id);
        expect(() => store.save(song("safe", "第二版", 40))).toThrow(MusicValidationError);
        kv.failOn = undefined;

        expect(store.get(first.id)).toEqual(oldBytes);
        expect(store.entries()).toHaveLength(1);
    });

    test("孤儿分片会被清理", () => {
        const kv = new MemoryKv();
        const store = collection(kv, () => 64 * 1024);
        store.save(song("orphan"));
        kv.set(`${PREFIX}d.ghost.zzz.0`, "AAAA");
        expect(store.pruneOrphans()).toBe(1);
        expect(kv.keys().some(key => key.includes(".ghost."))).toBe(false);
    });

    test("导出/导入整份存储不丢数据（拆琴搬运）", () => {
        const source = collection(new MemoryKv(), () => 64 * 1024);
        const entry = source.save(song("move", "搬走", 24));
        const raw = source.exportRaw();
        expect(source.verifyRaw(raw)).toBe(true);

        const target = collection(new MemoryKv(), () => 64 * 1024);
        const result = target.importRaw(raw);
        expect(result.songs).toBe(1);
        expect(target.get(entry.id)).toEqual(song("move", "搬走", 24));
    });
});

describe("队列引用身份", () => {
    test("同 id 不同来源/指纹使用不同缓存键", () => {
        expect(musicRefKey({ source: "piano", id: "abc", checksum: "1111" }))
            .not.toBe(musicRefKey({ source: "card", id: "abc", checksum: "1111" }));
        expect(musicRefKey({ source: "card", id: "abc", checksum: "1111" }))
            .not.toBe(musicRefKey({ source: "card", id: "abc", checksum: "2222" }));
    });
});
