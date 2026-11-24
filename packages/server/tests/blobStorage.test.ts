import { expect, test } from "bun:test";
import {
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { SqliteSongPort } from "../src/drivers/sqlitePorts";

/** 最小 SMF：format 0、1 轨道、division 96，含一个 C4 音符 */
function minimalMidi(): Uint8Array {
    return new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
        0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0x00, 0x90, 0x3c, 0x64,
        0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00,
    ]);
}

test("旧版 data/midis 文件启动时导入数据库并删除原文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "piano-migrate-"));
    writeFileSync(join(dir, "abc12345.mid"), new Uint8Array([1, 2, 3]));
    writeFileSync(join(dir, "abc12345.pbe3"), new Uint8Array([4, 5]));

    const db = openDb(":memory:");
    const port = new SqliteSongPort(db, dir);

    expect(port.legacyImported).toBe(2);
    expect([...port.getRaw("abc12345")!]).toEqual([1, 2, 3]);
    expect([...port.getPbe3("abc12345")!]).toEqual([4, 5]);
    expect(readdirSync(dir)).toHaveLength(0);

    // 已迁移过的目录再启动不会重复导入
    expect(new SqliteSongPort(db, dir).legacyImported).toBe(0);
    db.close();
    rmSync(dir, { recursive: true, force: true });
});

test("上传 MIDI 只写数据库，删除曲目同时清掉内容", () => {
    const dir = mkdtempSync(join(tmpdir(), "piano-blob-"));
    const db = openDb(":memory:");
    const port = new SqliteSongPort(db, dir);
    const bytes = minimalMidi();

    const meta = port.saveMidiFile(bytes, "TestSong");
    expect([...port.getRaw(meta.id)!]).toEqual([...bytes]);
    // mid 与 pbe3 都进了库，目录里没有新文件
    expect(readdirSync(dir)).toHaveLength(0);

    const rows = db
        .query(`SELECT kind FROM song_files WHERE song_id=?`)
        .all(meta.id) as { kind: string }[];
    expect(rows.map((r) => r.kind).sort()).toEqual(["mid", "pbe3"]);

    // 模拟重启：同一数据库、内容目录为空仍能读回
    const reopened = new SqliteSongPort(db, dir);
    expect([...reopened.getRaw(meta.id)!]).toEqual([...bytes]);
    expect(reopened.getPbe3(meta.id)?.byteLength).toBeGreaterThan(0);

    port.remove(meta.id);
    expect(port.getRaw(meta.id)).toBeUndefined();
    const left = db
        .query(`SELECT COUNT(*) AS count FROM song_files WHERE song_id=?`)
        .get(meta.id) as { count: number };
    expect(left.count).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
});
