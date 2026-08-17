import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { SqlitePlaylistPort, SqliteSongPort } from "../src/drivers/sqlitePorts";
import { playlistPortCases, songPortCases } from "../../core/tests/conformance.ts";

/** 每个用例独立的临时内容目录（测试曲目文件不落真实 data/） */
function makeSongPort() {
    const dir = mkdtempSync(join(tmpdir(), "piano-midis-"));
    const port = new SqliteSongPort(openDb(":memory:"), dir);
    return { port, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** SQLite 驱动复用 core 契约用例（与内存驱动同一套） */
describe("SongPort 契约（SqliteSongPort）", () => {
    for (const c of songPortCases(() => makeSongPort().port)) {
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
        const dir = mkdtempSync(join(tmpdir(), "piano-midis-"));
        const db1 = openDb(tmp);
        const p1 = new SqlitePlaylistPort(db1);
        const s1 = new SqliteSongPort(db1, dir);
        p1.setMeta({ id: 1, owner: "o", name: "n", public: false, playCount: 0, createdAt: 1, updatedAt: 1 });
        p1.setContent(1, ["aaa"]);
        s1.add({ id: "aaa", name: "A", duration: 10, tracks: [] });
        db1.close();

        const db2 = openDb(tmp);
        const p2 = new SqlitePlaylistPort(db2);
        const s2 = new SqliteSongPort(db2, dir);
        expect(p2.getMeta(1)?.name).toBe("n");
        expect(p2.getContent(1)).toEqual(["aaa"]);
        expect(s2.getMeta("aaa")).toEqual({ id: "aaa", name: "A", duration: 10 });
        expect(p2.nextId()).toBe(2);
        db2.close();
        rmSync(tmp, { force: true });
        rmSync(dir, { recursive: true, force: true });
    });

    test("saveMidiFile 写 .mid 文件，getRaw 读回，getSong 按需转换", () => {
        const { port, cleanup } = makeSongPort();
        // 最小 SMF：format 0、1 轨道、division 96，含一个 C4 音符
        const bytes = new Uint8Array([
            0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
            0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0x00, 0x90, 0x3c, 0x64,
            0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00,
        ]);
        const meta = port.saveMidiFile(bytes, "TestSong");
        expect(meta.name).toBe("TestSong");
        expect(port.getRaw(meta.id)).toEqual(bytes);
        const song = port.getSong(meta.id)!;
        expect(song.tracks.length).toBeGreaterThan(0);
        expect(song.tracks[0].notes.length).toBeGreaterThan(0);
        // remove 后文件也删除
        port.remove(meta.id);
        expect(port.getRaw(meta.id)).toBeUndefined();
        expect(port.getSong(meta.id)).toBeUndefined();
        cleanup();
    });
});