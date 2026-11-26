import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { createApp, type AppDeps } from "../src/app";
import { createToken, ensureBootstrapToken, revokeToken } from "../src/auth";
import { SqliteSongPort } from "../src/drivers/sqlitePorts";
import { loadConfig } from "../src/config";

const ADMIN = "static-auth-admin";
let deps: AppDeps;
let app: ReturnType<typeof createApp>;
let tempRoot = "";
let adminTokenId = 0;
let adminToken = "";

beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "piano-static-auth-"));
    const webRoot = join(tempRoot, "web");
    mkdirSync(join(webRoot, "assets"), { recursive: true });
    writeFileSync(join(webRoot, "index.html"), "<html><body>studio-app</body></html>");
    writeFileSync(join(webRoot, "assets", "app.js"), "console.log('studio');\n");
    writeFileSync(join(webRoot, "template.mcaddon"), "MCADDON-BYTES");

    const db = openDb(":memory:");
    ensureBootstrapToken(db, ADMIN);
    const created = createToken(db, "static-auth", "user");
    adminTokenId = created.id;
    adminToken = created.token;
    const config = loadConfig({
        WEB_ROOT: webRoot,
        PLUGINS_DIR: join(tempRoot, "plugins"),
    });
    deps = { db, songPort: new SqliteSongPort(db), config };
    app = createApp(deps);
});

afterAll(() => {
    deps.db.close();
    rmSync(tempRoot, { recursive: true, force: true });
});

function get(path: string, headers: Record<string, string> = {}) {
    return app.request(path, { headers });
}

async function login(): Promise<string> {
    const res = await app.request("/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pianobe_studio=");
    return cookie.split(";")[0]!;
}

describe("静态资源鉴权：没有令牌连前端文件都不给", () => {
    test("未登录访问前端产物返回 401", async () => {
        expect((await get("/assets/app.js")).status).toBe(401);
        expect((await get("/template.mcaddon")).status).toBe(401);
    });

    test("未登录用浏览器打开时只给内联登录页", async () => {
        const res = await get("/", { Accept: "text/html" });
        expect(res.status).toBe(200);
        expect(res.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
        const html = await res.text();
        expect(html).toContain("需要访问令牌");
        expect(html).not.toContain("studio-app");
    });

    test("无效令牌不能换会话", async () => {
        const res = await app.request("/api/session", {
            method: "POST",
            headers: { Authorization: "Bearer nope" },
        });
        expect(res.status).toBe(401);
    });

    test("有效令牌换取 HttpOnly 会话后可读静态文件", async () => {
        const cookie = await login();
        const asset = await get("/assets/app.js", { Cookie: cookie });
        expect(asset.status).toBe(200);
        expect(asset.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
        expect(await asset.text()).toContain("studio");
        expect((await get("/template.mcaddon", { Cookie: cookie })).status).toBe(200);
        const shell = await get("/", { Cookie: cookie, Accept: "text/html" });
        expect(await shell.text()).toContain("studio-app");
    });

    test("Bearer 令牌也能直接读静态文件（方便脚本/自动化）", async () => {
        const res = await get("/assets/app.js", { Authorization: `Bearer ${adminToken}` });
        expect(res.status).toBe(200);
    });

    test("吊销令牌后会话立即失效", async () => {
        const cookie = await login();
        expect(revokeToken(deps.db, adminTokenId)).toBe(true);
        expect((await get("/assets/app.js", { Cookie: cookie })).status).toBe(401);
    });
});
