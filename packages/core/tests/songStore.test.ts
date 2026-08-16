import { describe, expect, it } from "vitest";
import { MemorySongPort, SongStore } from "../src/index.js";
import { runSongPortSuite } from "./conformance.js";

/** 契约测试：内存驱动必须全部通过（后续 SQLite 驱动复用同一套） */
runSongPortSuite("MemorySongPort", () => new MemorySongPort());

describe("SongStore 业务层", () => {
    it("add/getMeta/getSong/has/remove", () => {
        const store = new SongStore(new MemorySongPort());
        store.add({ id: "aaa", name: "A", duration: 100, tracks: [] });
        expect(store.has("aaa")).toBe(true);
        expect(store.getMeta("aaa")).toEqual({ id: "aaa", name: "A", duration: 100 });
        expect(store.list()).toHaveLength(1);
        store.remove("aaa");
        expect(store.has("aaa")).toBe(false);
    });

    it("fromIds 剔除找不到的，保持顺序", () => {
        const store = new SongStore(new MemorySongPort());
        store.add({ id: "a1", name: "A", duration: 1, tracks: [] });
        store.add({ id: "a2", name: "B", duration: 2, tracks: [] });
        const metas = store.fromIds(["a2", "missing", "a1"]);
        expect(metas.map((m) => m.id)).toEqual(["a2", "a1"]);
    });
});