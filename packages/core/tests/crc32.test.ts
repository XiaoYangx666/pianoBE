import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { crc32Hex } from "../src/index.js";

describe("crc32", () => {
    it("标准校验向量：ASCII '123456789' → 0xCBF43926", () => {
        const bytes = new TextEncoder().encode("123456789");
        expect(crc32Hex(bytes)).toBe("cbf43926");
    });

    it("与历史曲目 id 一致（文件存在时）", () => {
        const p = "midis/files/Beyond - 海阔天空.mid";
        if (!existsSync(p)) return; // midis/files 为 git 忽略目录，CI 缺省跳过
        const buf = readFileSync(p);
        expect(crc32Hex(new Uint8Array(buf))).toBe("4beea226");
    });

    it("空输入 → 0", () => {
        expect(crc32Hex(new Uint8Array(0))).toBe("0");
    });
});