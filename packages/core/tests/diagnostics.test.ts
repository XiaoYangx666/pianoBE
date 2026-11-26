import { afterEach, describe, expect, test, vi } from "vitest";
import { reportDiagnostic, setDiagnosticSink } from "../src/diagnostics.js";

afterEach(() => {
    setDiagnosticSink(undefined);
    vi.restoreAllMocks();
});

describe("diagnostics", () => {
    test("未注入 sink 时使用统一前缀输出到 console", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        reportDiagnostic("warn", "songCache", "校验失败", new Error("bad"), { key: "abc" });

        expect(warn).toHaveBeenCalledTimes(1);
        const text = String(warn.mock.calls[0][0]);
        expect(text).toContain("[PBE][songCache][WARN] 校验失败 | key=abc");
        expect(text).toContain("Error: bad");
    });

    test("注入 sink 后由宿主接管", () => {
        const sink = vi.fn();
        setDiagnosticSink(sink);
        const error = new Error("x");
        reportDiagnostic("error", "vfx", "失败", error, { effect: "a" });

        expect(sink).toHaveBeenCalledWith("error", "vfx", "失败", error, { effect: "a" });
    });
});
