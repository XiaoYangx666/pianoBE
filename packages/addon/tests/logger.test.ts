import { afterEach, describe, expect, test } from "bun:test";
import { createLogger, setLogLevel } from "../src/runtime/log";

const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
};

function capture(run: () => void): string[] {
    const lines: string[] = [];
    const push = (...args: unknown[]) => {
        lines.push(args.map((item) => String(item)).join(" "));
    };
    console.log = push;
    console.warn = push;
    console.error = push;
    try {
        run();
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }
    return lines;
}

afterEach(() => {
    setLogLevel("info");
});

describe("addon logger", () => {
    test("统一前缀、级别、scope 与字段", () => {
        const lines = capture(() => {
            createLogger("playback", { song: "abc" }).warn("加载失败", new Error("boom"), {
                player: "Steve",
            });
        });

        expect(lines.length).toBe(1);
        expect(lines[0]).toContain("[PBE][playback][WARN] 加载失败 | song=abc player=Steve");
        expect(lines[0]).toContain("Error: boom");
    });

    test("info 默认输出，debug 默认不输出", () => {
        const lines = capture(() => {
            const log = createLogger("app");
            log.debug("debug-line");
            log.info("info-line");
        });

        expect(lines.some((line) => line.includes("debug-line"))).toBe(false);
        expect(lines.some((line) => line.includes("info-line"))).toBe(true);
    });

    test("重复 warn 在窗口内只输出一次", () => {
        const lines = capture(() => {
            const log = createLogger("net");
            log.warn("连接失败");
            log.warn("连接失败");
            log.warn("连接失败");
        });

        expect(lines.filter((line) => line.includes("连接失败")).length).toBe(1);
    });

    test("不同曲目的同名错误分别保留", () => {
        const lines = capture(() => {
            const log = createLogger("playback");
            log.warn("加载失败", undefined, { song: "a" });
            log.warn("加载失败", undefined, { song: "b" });
        });

        expect(lines.filter((line) => line.includes("加载失败")).length).toBe(2);
    });

    test("凭据不会进入控制台", () => {
        const lines = capture(() => {
            createLogger("net").warn("请求失败", undefined, {
                url: "http://host/api?token=secret",
                authorization: "Bearer abc123",
            });
        });

        expect(lines[0]).toContain("token=***");
        expect(lines[0]).not.toContain("secret");
        expect(lines[0]).not.toContain("abc123");
    });
});
