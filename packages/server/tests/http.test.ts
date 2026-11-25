import { expect, test } from "bun:test";
import { fetchWithTimeout } from "../src/services/http";

test("超时后中止请求，不会永久挂起", async () => {
    const server = Bun.serve({
        port: 0,
        fetch: () => new Promise<Response>(() => {}),
    });
    try {
        const url = `http://127.0.0.1:${server.port}/`;
        const started = Date.now();
        await expect(fetchWithTimeout(url, {}, 50)).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(2000);
    } finally {
        server.stop(true);
    }
});
