import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, formatError, formatTimestamp } from "../src/logger";

let dir = "";

function tempLogFile(name = "server.log"): string {
    dir = mkdtempSync(join(tmpdir(), "pianobe-log-"));
    return join(dir, "logs", name);
}

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
});

describe("logger", () => {
    test("写入时间戳、级别和错误堆栈", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false });
        log.info("hello");
        log.warn("careful");
        log.error("boom", new Error("bad"));

        const text = readFileSync(file, "utf8");
        expect(text).toMatch(
            /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] hello$/m
        );
        expect(text).toContain("[WARN] careful");
        expect(text).toContain("[ERROR] boom\nError: bad");
    });

    test("超过上限时轮转并限制历史文件数量", () => {
        const file = tempLogFile();
        const log = createLogger({
            file,
            console: false,
            maxBytes: 300,
            maxFiles: 2,
        });
        for (let i = 0; i < 40; i++) {
            log.info(`line-${i}-${"x".repeat(60)}`);
        }

        expect(existsSync(file)).toBe(true);
        expect(existsSync(`${file}.1`)).toBe(true);
        expect(existsSync(`${file}.2`)).toBe(true);
        expect(existsSync(`${file}.3`)).toBe(false);
    });

    test("只记录 API 请求和失败请求", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false });
        log.http("GET", "/piano/a.ogg", 200, 1);
        log.http("GET", "/assets/index.js", 304, 1);
        log.http("GET", "/api/health", 200, 2);
        log.http("GET", "/missing.js", 404, 1);

        const text = readFileSync(file, "utf8");
        expect(text).not.toContain("a.ogg");
        expect(text).not.toContain("index.js");
        expect(text).toContain("/api/health 200 2ms");
        expect(text).toContain("/missing.js 404 1ms");
    });

    test("不传文件时只输出控制台，不创建文件", () => {
        const log = createLogger({ console: false });
        log.info("console only");
        expect(log.file).toBeUndefined();
    });

    test("时间戳与错误格式化可独立使用", () => {
        expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe(
            "2026-01-02 03:04:05.006"
        );
        expect(formatError("plain")).toBe("plain");
        expect(formatError(new Error("x"))).toContain("Error: x");
    });
});
