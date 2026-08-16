import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { SqlitePlaylistPort, SqliteSongPort } from "../src/drivers/sqlitePorts";
import { playlistPortCases, songPortCases } from "../../../packages/core/tests/conformance.ts";

/** SQLite 驱动复用 core 契约用例（与内存驱动同一套） */
describe("SongPort 契约（SqliteSongPort）", () => {
    for (const c of songPortCases(() => new SqliteSongPort(openDb(":memory:")))) {
        test(c.name, c.fn);
    }
});

describe("PlaylistPort 契约（SqlitePlaylistPort）", () => {
    for (const c of playlistPortCases(() => new SqlitePlaylistPort(openDb(":memory:")))) {
        test(c.name, c.fn);
    }
});

describe("SQLite 驱动专有行为", () => {
    test("setMeta 不触碰 items（meta 与内容同记录但独立更新）", () => {
        const db = openDb(":memory:");
        const p = new SqlitePlaylistPort(db);
        p.setMeta({ id: 1, owner: "o", name: "n", public: false, playCount: 0, createdAt: 1, updatedAt: 1 });
        p.setContent(1, ["a", "b"]);
        p.setMeta({ id: 1, owner: "o", name: "n2", public: true, playCount: 3, createdAt: 1, updatedAt: 9 });
        expect(p.getMeta(1)).toEqual({ id: 1, owner: "o", name: "n2", public: true, playCount: 3, createdAt: 1, updatedAt: 9 });
        expect(p.getContent(1)).toEqual(["a", "b"]);
    });

    test("持久化：磁盘文件重开后可读（模拟重启）", () => {
        const tmp = `/tmp/piano-test-${Date.now()}.db`;
        const db1 = openDb(tmp);
        const p1 = new SqlitePlaylistPort(db1);
        const s1 = new SqliteSongPort(db1);
        p1.setMeta({ id: 1, owner: "o", name: "n", public: false, playCount: 0, createdAt: 1, updatedAt: 1 });
        p1.setContent(1, ["aaa"]);
        s1.add({ id: "aaa", name: "A", duration: 10, tracks: [] });
        db1.close();

        const db2 = openDb(tmp);
        const p2 = new SqlitePlaylistPort(db2);
        const s2 = new SqliteSongPort(db2);
        expect(p2.getMeta(1)?.name).toBe("n");
        expect(p2.getContent(1)).toEqual(["aaa"]);
        expect(s2.getMeta("aaa")).toEqual({ id: "aaa", name: "A", duration: 10 });
        expect(p2.nextId()).toBe(2);
        db2.close();
        Bun.spawnSync(["rm", "-f", tmp]);
    });
});