import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";

let dir = "";

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
});

test("openDb 开启 WAL 与 busy_timeout", () => {
    dir = mkdtempSync(join(tmpdir(), "pianobe-db-"));
    const db = openDb(join(dir, "piano.db"));
    expect(db.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
    });
    expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    db.close();
});
