import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../src/atomic";

let dir = "";

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
});

test("覆盖写入且不残留临时文件", () => {
    dir = mkdtempSync(join(tmpdir(), "pianobe-atomic-"));
    const file = join(dir, "song.mid");
    writeFileAtomic(file, new Uint8Array([1, 2, 3]));
    writeFileAtomic(file, new Uint8Array([4, 5]));

    expect([...readFileSync(file)]).toEqual([4, 5]);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toHaveLength(0);
});
