import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { SqliteSongPort } from "../src/drivers/sqlitePorts";
import { encodeSong, readPbe3Header, type MidiSong } from "@piano/core";
import { songPortCases } from "../../core/tests/conformance.ts";

function makeSongPort() {
    return { port: new SqliteSongPort(openDb(":memory:")), cleanup: () => {} };
}

/** SQLite 驱动复用 core 契约用例（与内存驱动同一套） */
describe("SongPort 契约（SqliteSongPort）", () => {
    for (const c of songPortCases(() => makeSongPort().port)) {
        test(c.name, c.fn);
    }
});

describe("SQLite 驱动专有行为", () => {
    test("持久化：磁盘文件重开后可读（模拟重启）", () => {
        const dbDir = mkdtempSync(join(tmpdir(), "piano-db-"));
        const tmp = join(dbDir, "piano-test.db");
        const db1 = openDb(tmp);
        const s1 = new SqliteSongPort(db1);
        s1.add({ id: "aaa", name: "A", duration: 10, tracks: [] });
        db1.close();

        const db2 = openDb(tmp);
        const s2 = new SqliteSongPort(db2);
        expect(s2.getMeta("aaa")).toEqual({ id: "aaa", name: "A", duration: 10 });
        db2.close();
        rmSync(dbDir, { recursive: true, force: true });
    });

    test("saveMidiFile 写库，getRaw 读回，getSong 按需转换", () => {
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

    test("rename 同步更新持久化 PBE3 的文件头曲名", () => {
        const { port, cleanup } = makeSongPort();
        const bytes = new Uint8Array([
            0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
            0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0x00, 0x90, 0x3c, 0x64,
            0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00,
        ]);
        const meta = port.saveMidiFile(bytes, "Old Name");
        // 先读一次，让 PBE3 持久化到 song_files
        expect(readPbe3Header(port.getPbe3(meta.id)!).name).toBe("Old Name");

        port.rename(meta.id, "New Name");
        expect(readPbe3Header(port.getPbe3(meta.id)!).name).toBe("New Name");
        cleanup();
    });

    test("只有 PBE3 时改名失败也不能删除内容", () => {
        const db = openDb(":memory:");
        const port = new SqliteSongPort(db);
        const song: MidiSong = {
            id: "onlypbe3",
            name: "Only PBE3",
            duration: 10,
            tracks: [
                {
                    instrument: { family: "piano", number: 0, name: "Piano" },
                    notes: [60, 0, 40, 100],
                },
            ],
        };
        port.savePbe3File(encodeSong(song));
        // 模拟 BLOB 损坏导致 renameSong 抛错；此时没有 MIDI/JSON 可回退
        const corrupt = new Uint8Array([1, 2, 3]);
        db.query(`UPDATE song_files SET bytes=? WHERE song_id=? AND kind='pbe3'`).run(corrupt, song.id);

        port.rename(song.id, "New Name");
        expect(port.getPbe3(song.id)).toEqual(corrupt);

        db.close();
    });
});
