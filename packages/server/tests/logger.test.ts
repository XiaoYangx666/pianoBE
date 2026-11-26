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

    test("任务状态轮询成功时降到 debug", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false, level: "debug" });
        log.http("GET", "/api/transcribe/jobs/abc", 200, 1);
        log.http("GET", "/api/transcribe/jobs/abc/code", 200, 1);

        const text = readFileSync(file, "utf8");
        expect(text).toContain("[DEBUG] GET /api/transcribe/jobs/abc 200 1ms");
        expect(text).toContain("[INFO] GET /api/transcribe/jobs/abc/code 200 1ms");
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

    test("scope 与结构化字段进入同一行", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false });
        log.scope("transcribe", { job: "abc" }).warn("下载失败", new Error("boom"), {
            attempt: 2,
            bvid: "BV1xx",
        });

        const text = readFileSync(file, "utf8");
        expect(text).toContain("[WARN] [transcribe] 下载失败 | job=abc attempt=2 bvid=BV1xx");
        expect(text).toContain("Error: boom");
    });

    test("按级别过滤，debug 默认不输出", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false, level: "warn" });
        log.debug("debug-line");
        log.info("info-line");
        log.warn("warn-line");
        log.error("error-line");

        const text = readFileSync(file, "utf8");
        expect(text).not.toContain("debug-line");
        expect(text).not.toContain("info-line");
        expect(text).toContain("warn-line");
        expect(text).toContain("error-line");
    });

    test("json 格式一行一条并保留错误结构", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false, format: "json" });
        log.error("失败", new Error("bad"), { req: "8f3c2a", song: "abc" });

        const lines = readFileSync(file, "utf8").trim().split("\n");
        expect(lines.length).toBe(1);
        const record = JSON.parse(lines[0]);
        expect(record.level).toBe("error");
        expect(record.msg).toBe("失败");
        expect(record.req).toBe("8f3c2a");
        expect(record.song).toBe("abc");
        expect(record.err.name).toBe("Error");
        expect(record.err.message).toBe("bad");
    });

    test("json 字段不能覆盖 time/level/msg 等保留字段", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false, format: "json" });
        log.info("启动完成", { level: "debug", msg: "假的", time: "假的", logLevel: "info" });

        const record = JSON.parse(readFileSync(file, "utf8").trim());
        expect(record.level).toBe("info");
        expect(record.msg).toBe("启动完成");
        expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2} /);
        expect(record.logLevel).toBe("info");
    });

    test("凭据类字段与文本会被打码", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false });
        log.info("Authorization: Bearer abcdefghijklmnop123456 SESSDATA=secret", {
            token: "should-not-leak",
            bvid: "BV1xx",
        });

        const text = readFileSync(file, "utf8");
        expect(text).toContain("Bearer ***");
        expect(text).toContain("SESSDATA=***");
        expect(text).toContain("token=***");
        expect(text).not.toContain("abcdefghijklmnop123456");
        expect(text).not.toContain("should-not-leak");
    });

    test("错误堆栈里的凭据也会被打码", () => {
        const file = tempLogFile();
        const log = createLogger({ file, console: false });
        log.error("请求失败", new Error("Bearer abcdefgh12345678"));

        const text = readFileSync(file, "utf8");
        expect(text).toContain("Bearer ***");
        expect(text).not.toContain("abcdefgh12345678");
    });
});
