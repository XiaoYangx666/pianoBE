import { describe, expect, test } from "bun:test";
import { isUnloadedChunkError } from "../src/platform/errors";

describe("isUnloadedChunkError", () => {
    test("按 name 识别引擎错误", () => {
        const error = Object.assign(new Error("Trying to access location (1, 2, 3)"), {
            name: "LocationInUnloadedChunkError",
        });
        expect(isUnloadedChunkError(error)).toBe(true);
        expect(isUnloadedChunkError({ name: "LocationInUnloadedChunkError" })).toBe(true);
    });

    test("name 丢失时按 message 兜底", () => {
        expect(isUnloadedChunkError(
            new Error("Trying to access location (1, 2, 3) which is not in a chunk currently loaded and ticking."),
        )).toBe(true);
    });

    test("不误判其它错误", () => {
        expect(isUnloadedChunkError(new Error("boom"))).toBe(false);
        expect(isUnloadedChunkError(undefined)).toBe(false);
        expect(isUnloadedChunkError("LocationInUnloadedChunkError")).toBe(false);
    });
});
