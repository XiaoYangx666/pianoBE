import { describe, expect, it } from "vitest";
import { MemoryPlaylistPort, PlaylistStore } from "../src/index.js";
import { playlistPortCases } from "./conformance.js";

/** 契约测试：内存驱动必须全部通过（SQLite 驱动复用同一套） */
describe("PlaylistPort 契约（MemoryPlaylistPort）", () => {
    for (const c of playlistPortCases(() => new MemoryPlaylistPort())) {
        it(c.name, c.fn);
    }
});

describe("PlaylistStore 业务层", () => {
    function setup(now?: () => number) {
        const port = new MemoryPlaylistPort();
        const store = new PlaylistStore(port, now ? { now } : {});
        return { port, store };
    }

    it("create 顺序分配 id；nextId 从现有记录恢复（max+1）", () => {
        const { port, store } = setup();
        const a = store.create("p1", "歌单A");
        const b = store.create("p1", "歌单B");
        const c = store.create("p2", "歌单C");
        expect([a.id, b.id, c.id]).toEqual([1, 2, 3]);
        // 模拟崩溃后重启：新端口实例同样从记录恢复 id
        const port2 = new MemoryPlaylistPort();
        // 直接写入同数据
        port.listAllMetas().forEach((m) => port2.setMeta(m));
        const store2 = new PlaylistStore(port2);
        expect(store2.create("p9", "新").id).toBe(4);
    });

    it("delete 后 id 可复用（max+1 语义）", () => {
        const { store } = setup();
        store.create("p1", "A");
        const b = store.create("p1", "B");
        store.delete(b.id);
        expect(store.create("p1", "C").id).toBe(2);
    });

    it("getMetasByOwner 派生视图（读取即修复，不依赖索引键）", () => {
        const { store } = setup();
        store.create("p1", "A");
        store.create("p1", "B");
        store.create("p2", "C");
        expect(store.getMetasByOwner("p1").map((m) => m.name)).toEqual(["A", "B"]);
        expect(store.getMetasByOwner("nobody")).toEqual([]);
    });

    it("getPublicMetas：仅公开，可按键播放量排序", () => {
        const { store } = setup();
        const a = store.create("p1", "A");
        const b = store.create("p1", "B");
        const c = store.create("p2", "C");
        store.updateMeta(a.id, { public: true });
        store.updateMeta(c.id, { public: true });
        store.incPlayCount(a.id, "u1");
        store.incPlayCount(c.id, "u1");
        store.incPlayCount(c.id, "u2"); // c 播放数更高
        expect(store.getPublicMetas().map((m) => m.id).sort()).toEqual([a.id, c.id].sort());
        expect(store.getPublicMetas(true)[0].id).toBe(c.id); // 按播放数降序
    });

    it("updateMeta 部分更新并刷新 updatedAt", () => {
        let t = 1000;
        const { store } = setup(() => t);
        const a = store.create("p1", "A");
        t = 2000;
        const updated = store.updateMeta(a.id, { name: "B", public: true });
        expect(updated?.name).toBe("B");
        expect(updated?.public).toBe(true);
        expect(updated?.updatedAt).toBe(2000);
        expect(store.getMeta(a.id)?.createdAt).toBe(1000);
        // owner 不可被 patch 篡改
        store.updateMeta(a.id, { owner: "hacker" } as never);
        expect(store.getMeta(a.id)?.owner).toBe("p1");
    });

    it("setContent 整体替换 + 刷新 updatedAt", () => {
        let t = 1000;
        const { store } = setup(() => t);
        const a = store.create("p1", "A");
        store.setContent(a.id, ["s1", "s2"]);
        expect(store.getContent(a.id)).toEqual(["s1", "s2"]);
        t = 3000;
        store.setContent(a.id, ["s3"]);
        expect(store.getContent(a.id)).toEqual(["s3"]);
        expect(store.getMeta(a.id)?.updatedAt).toBe(3000);
    });

    it("incPlayCount：同玩家同列表每日去重；跨天重置", () => {
        let t = new Date(2026, 0, 1, 10).getTime();
        const { store } = setup(() => t);
        const a = store.create("p1", "A");
        store.incPlayCount(a.id, "u1");
        store.incPlayCount(a.id, "u1"); // 同日重复不计
        store.incPlayCount(a.id, "u2"); // 不同玩家计入
        expect(store.getMeta(a.id)?.playCount).toBe(2);
        t = new Date(2026, 0, 2, 10).getTime(); // 跨天
        store.incPlayCount(a.id, "u1");
        expect(store.getMeta(a.id)?.playCount).toBe(3);
    });

    it("崩溃残留：孤儿 content 不出现在任何视图，delete 幂等清理", () => {
        const { port, store } = setup();
        port.setContent(99, ["s1"]); // 只有 content，无 meta
        expect(store.getMeta(99)).toBeUndefined();
        expect(store.getMetasByOwner("any")).toHaveLength(0);
        expect(store.getPublicMetas()).toHaveLength(0);
        store.delete(99); // 幂等
        expect(port.getContent(99)).toEqual([]);
    });

    it("delete 完整清理 meta + content", () => {
        const { port, store } = setup();
        const a = store.create("p1", "A");
        store.setContent(a.id, ["s1"]);
        store.delete(a.id);
        expect(port.getMeta(a.id)).toBeUndefined();
        expect(port.getContent(a.id)).toEqual([]);
        expect(store.getMetasByOwner("p1")).toHaveLength(0);
    });
});