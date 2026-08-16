import { describe, expect, it } from "vitest";
import type { PlaylistPort, SongPort, PlaylistMeta, MidiSong } from "../src/index.js";

/**
 * 存储端口契约测试：任何驱动（内存/SQLite/游戏内动态属性）都必须通过这些用例。
 * 覆盖：单记录原子语义、派生全扫、幂等删除、返回值副本语义。
 */

export function runSongPortSuite(name: string, make: () => SongPort) {
    describe(`SongPort 契约（${name}）`, () => {
        const song: MidiSong = {
            id: "aaa",
            name: "A",
            duration: 100,
            tracks: [{ instrument: { family: "piano", number: 0, name: "x" }, notes: [60, 0, 50, 100] }],
        };

        it("add + getMeta/getSong/has", () => {
            const p = make();
            expect(p.has("aaa")).toBe(false);
            p.add(song);
            expect(p.has("aaa")).toBe(true);
            expect(p.getMeta("aaa")).toEqual({ id: "aaa", name: "A", duration: 100 });
            expect(p.getSong("aaa")?.tracks[0].notes).toEqual([60, 0, 50, 100]);
        });

        it("同 id 幂等写入（内容寻址语义：重复 add 不产生重复记录）", () => {
            const p = make();
            p.add(song);
            p.add(song);
            expect(p.listMetas()).toHaveLength(1);
        });

        it("remove 后不可见", () => {
            const p = make();
            p.add(song);
            p.remove("aaa");
            expect(p.has("aaa")).toBe(false);
            expect(p.getMeta("aaa")).toBeUndefined();
            expect(p.getSong("aaa")).toBeUndefined();
            expect(p.listMetas()).toHaveLength(0);
        });
    });
}

export function runPlaylistPortSuite(name: string, make: () => PlaylistPort) {
    describe(`PlaylistPort 契约（${name}）`, () => {
        function meta(id: number, owner = "o1"): PlaylistMeta {
            return { id, owner, name: `n${id}`, public: false, playCount: 0, createdAt: id, updatedAt: id };
        }

        it("setMeta/getMeta/listAllMetas 主记录读写", () => {
            const p = make();
            p.setMeta(meta(1));
            expect(p.getMeta(1)).toEqual(meta(1));
            expect(p.listAllMetas()).toEqual([meta(1)]);
            // 返回副本：外部变更不污染存储
            const got = p.getMeta(1)!;
            got.name = "changed";
            expect(p.getMeta(1)!.name).toBe("n1");
        });

        it("setContent 整体替换（原子）；getContent 返回副本", () => {
            const p = make();
            p.setContent(1, ["a", "b"]);
            const arr = p.getContent(1);
            arr.push("c");
            expect(p.getContent(1)).toEqual(["a", "b"]);
            p.setContent(1, ["z"]);
            expect(p.getContent(1)).toEqual(["z"]);
        });

        it("deletePlaylist 幂等，删除后 meta/content 均无残留", () => {
            const p = make();
            p.setMeta(meta(5));
            p.setContent(5, ["a"]);
            p.deletePlaylist(5);
            p.deletePlaylist(5); // 再次删除不抛错
            expect(p.getMeta(5)).toBeUndefined();
            expect(p.getContent(5)).toEqual([]);
            expect(p.listAllMetas()).toHaveLength(0);
        });

        it("崩溃残留自愈：只有 content 没有 meta 时，派生视图不可见、全扫不含孤儿", () => {
            const p = make();
            p.setContent(99, ["a"]); // 模拟 create 中途崩溃：content 已写、meta 未写
            expect(p.listAllMetas()).toEqual([]);
            p.deletePlaylist(99); // 幂等清理不抛错
            expect(p.getContent(99)).toEqual([]);
        });
    });
}