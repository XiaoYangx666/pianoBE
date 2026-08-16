import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { createApp, type AppDeps } from "../src/app";
import { createToken, ensureBootstrapToken, getTokenInfo } from "../src/auth";
import { SqlitePlaylistPort, SqliteSongPort } from "../src/drivers/sqlitePorts";
import { loadConfig } from "../src/config";
import { PlaylistStore, SongStore } from "@piano/core";

/** 最小 SMF：format 0、1 轨道、division 96 */
function minimalMidi(note = 0x3c): Uint8Array {
    const events = [
        0x00, 0x90, note, 0x64, 0x60, 0x80, note, 0x40, 0x00, 0xff, 0x2f, 0x00,
    ];
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60];
    const track = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, events.length, ...events];
    return new Uint8Array([...header, ...track]);
}

const ADMIN = "admin-token-abc";
let deps: AppDeps;
let app: ReturnType<typeof createApp>;
let writerToken = "";
let writer2Token = "";
let readerToken = "";
let songId = "";

/** 类型化 json 解析 */
async function j<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
}

function req(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    const { token: _t, ...rest } = init;
    return app.request(path, { ...rest, headers });
}

beforeAll(() => {
    const db = openDb(":memory:");
    ensureBootstrapToken(db, ADMIN);
    deps = {
        db,
        songStore: new SongStore(new SqliteSongPort(db)),
        playlistStore: new PlaylistStore(new SqlitePlaylistPort(db)),
        config: loadConfig({}),
    };
    app = createApp(deps);
    writerToken = createToken(db, "writer", "write").token;
    writer2Token = createToken(db, "writer2", "write").token;
    readerToken = createToken(db, "reader", "read").token;
});

afterAll(() => {
    deps.db.close();
});

describe("健康检查与鉴权", () => {
    test("health 公开可用", async () => {
        const res = await req("/api/health");
        expect(res.status).toBe(200);
    });

    test("无令牌访问受保护接口 → 401", async () => {
        expect((await req("/api/songs")).status).toBe(401);
        expect((await req("/api/playlists")).status).toBe(401);
    });

    test("错误令牌 → 401", async () => {
        const res = await req("/api/songs", { token: "bad-token" });
        expect(res.status).toBe(401);
    });

    test("read 令牌只读，写操作 → 403", async () => {
        expect((await req("/api/songs", { token: readerToken })).status).toBe(200);
        const res = await req("/api/songs", {
            token: readerToken,
            method: "POST",
            body: minimalMidi(),
        });
        expect(res.status).toBe(403);
    });

    test("getTokenInfo 哈希校验", () => {
        expect(getTokenInfo(deps.db, ADMIN)?.label).toBe("bootstrap");
        expect(getTokenInfo(deps.db, "wrong")).toBeUndefined();
    });
});

describe("曲库 API", () => {
    test("上传 .mid → 201 返回 meta；重复上传幂等", async () => {
        const res = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            headers: { "X-File-Name": encodeURIComponent("测试曲.mid") },
            body: minimalMidi(),
        });
        expect(res.status).toBe(201);
        const meta = await j<{ id: string; name: string }>(res);
        expect(meta.name).toBe("测试曲");
        songId = meta.id;

        // 同内容重复上传：仍只有一条
        await req("/api/songs", {
            token: writerToken,
            method: "POST",
            headers: { "X-File-Name": encodeURIComponent("测试曲.mid") },
            body: minimalMidi(),
        });
        const list = await j<{ total: number }>(await req("/api/songs", { token: readerToken }));
        expect(list.total).toBe(1);
    });

    test("无文件名时 name 回退为 id", async () => {
        const res = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            body: minimalMidi(0x3e),
        });
        const meta = await j<{ id: string; name: string }>(res);
        expect(meta.name).toBe(meta.id);
        expect(meta.id).not.toBe(songId);
    });

    test("无效 MIDI → 400；空文件 → 400", async () => {
        const bad = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            body: new Uint8Array([1, 2, 3, 4]),
        });
        expect(bad.status).toBe(400);
        const empty = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            body: new Uint8Array(0),
        });
        expect(empty.status).toBe(400);
    });

    test("列表搜索 + 获取完整曲目 + 删除", async () => {
        const q = await j<{ total: number }>(await req(`/api/songs?q=测试`, { token: readerToken }));
        expect(q.total).toBe(1);

        const song = await j<{ id: string; tracks: unknown[] }>(await req(`/api/songs/${songId}`, { token: readerToken }));
        expect(song.id).toBe(songId);
        expect(song.tracks.length).toBeGreaterThan(0);

        expect((await req(`/api/songs/${songId}`, { token: readerToken, method: "DELETE" })).status).toBe(403);
        expect((await req(`/api/songs/${songId}`, { token: writerToken, method: "DELETE" })).status).toBe(204);
        expect((await req(`/api/songs/${songId}`, { token: readerToken })).status).toBe(404);
    });
});

describe("播放列表 API", () => {
    let listId = 0;

    test("创建 → 列表 → 详情", async () => {
        const res = await req("/api/playlists", {
            token: writerToken,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "我的歌单" }),
        });
        expect(res.status).toBe(201);
        listId = (await j<{ id: number }>(res)).id;

        const own = await j<{ items: { id: number }[] }>(await req("/api/playlists?owner=writer", { token: readerToken }));
        expect(own.items).toHaveLength(1);

        const detail = await j<{ items: string[] }>(await req(`/api/playlists/${listId}`, { token: readerToken }));
        expect(detail.items).toEqual([]);
    });

    test("改名/设公开（仅 owner 或 admin）", async () => {
        const otherRes = await req("/api/playlists", {
            token: writer2Token, method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "他人列表" }),
        });
        expect(otherRes.status).toBe(201);
        const other = (await otherRes.json()) as { id: number };
        // writer2 改 writer 的列表 → 403（非 owner）
        const forbidden = await req(`/api/playlists/${listId}`, {
            token: writer2Token, method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "x" }),
        });
        expect(forbidden.status).toBe(403);
        // writer 自己改 → 200
        const ok = await req(`/api/playlists/${listId}`, {
            token: writerToken, method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "新名字", public: true }),
        });
        expect(ok.status).toBe(200);
        // admin 可改任何人的
        const adminOk = await req(`/api/playlists/${other.id}`, {
            token: ADMIN, method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "管理员改名" }),
        });
        expect(adminOk.status).toBe(200);
    });

    test("公开广场可见 + items 整体替换", async () => {
        const pub = await j<{ items: { id: number }[] }>(await req("/api/playlists?public=1", { token: readerToken }));
        expect(pub.items.map((m: { id: number }) => m.id)).toContain(listId);

        const items = await req(`/api/playlists/${listId}/items`, {
            token: writerToken, method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ items: ["aaa", "bbb"] }),
        });
        expect((await j<{ items: string[] }>(items)).items).toEqual(["aaa", "bbb"]);
        const detail = await j<{ items: string[] }>(await req(`/api/playlists/${listId}`, { token: readerToken }));
        expect(detail.items).toEqual(["aaa", "bbb"]);
    });

    test("播放计数：同令牌每日一次", async () => {
        const p1 = await j<{ playCount: number }>(await req(`/api/playlists/${listId}/play`, { token: readerToken, method: "POST" }));
        await req(`/api/playlists/${listId}/play`, { token: readerToken, method: "POST" });
        const p2 = await j<{ playCount: number }>(await req(`/api/playlists/${listId}/play`, { token: writerToken, method: "POST" }));
        expect(p1.playCount).toBe(1);
        expect(p2.playCount).toBe(2); // 不同令牌再计一次
    });

    test("删除（他人 403 / owner 204）", async () => {
        const other = await j<{ items: { id: number }[] }>(await req("/api/playlists?owner=writer", { token: readerToken }));
        const otherId = other.items[0].id;
        expect((await req(`/api/playlists/${otherId}`, { token: readerToken, method: "DELETE" })).status).toBe(403);
        expect((await req(`/api/playlists/${otherId}`, { token: writerToken, method: "DELETE" })).status).toBe(204);
        expect((await req(`/api/playlists/${otherId}`, { token: readerToken })).status).toBe(404);
    });
});

describe("令牌管理 API", () => {
    test("非 admin 访问 → 403", async () => {
        expect((await req("/api/tokens", { token: writerToken })).status).toBe(403);
    });

    test("创建 read 令牌 → 明文一次；新令牌可用；吊销后失效", async () => {
        const created = await req("/api/tokens", {
            token: ADMIN, method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: "external-bot", role: "read" }),
        });
        expect(created.status).toBe(201);
        const { token, id } = await j<{ token: string; id: number }>(created);
        expect(token.length).toBeGreaterThan(30);

        const before = await req("/api/songs", { token });
        expect(before.status).toBe(200);

        // 重复 label → 409
        const dup = await req("/api/tokens", {
            token: ADMIN, method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: "external-bot", role: "read" }),
        });
        expect(dup.status).toBe(409);

        expect((await req(`/api/tokens/${id}`, { token: ADMIN, method: "DELETE" })).status).toBe(204);
        expect((await req("/api/songs", { token })).status).toBe(401);
    });

    test("非法 role → 400", async () => {
        const res = await req("/api/tokens", {
            token: ADMIN, method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: "x", role: "superadmin" }),
        });
        expect(res.status).toBe(400);
    });
});