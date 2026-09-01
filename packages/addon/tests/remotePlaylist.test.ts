import { describe, expect, test } from "bun:test";
import { RemotePlaylistFacade } from "../src/serverAdmin/remotePlaylist";
import type { NetFetch } from "../src/serverAdmin/netSource";

const BASE = "http://test:3000";

interface Call {
    method: string;
    url: string;
    headers?: Record<string, unknown>;
    body?: string;
}

function makeFetch(
    routes: Record<string, (call: Call) => { status: number; body?: unknown }>,
    log: Call[]
): NetFetch {
    return async (url, init) => {
        const call: Call = {
            method: init.method ?? "GET",
            url,
            headers: init.headers,
            body: init.body,
        };
        log.push(call);
        const r = routes[url];
        if (!r) return { status: 404, json: async () => ({}) };
        const res = r(call);
        return {
            status: res.status,
            json: async () => (res.body === undefined ? {} : res.body),
        };
    };
}

const META = {
    id: 3,
    owner: "admin",
    name: "测试列表",
    public: true,
    playCount: 5,
    createdAt: 1,
    updatedAt: 2,
};

describe("RemotePlaylistFacade（后端纯前端，零存储）", () => {
    test("listMy：按 owner=玩家临时 id 过滤", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists?owner=player-abc`]: () => ({
                        status: 200,
                        body: { items: [{ ...META, id: 7 }] },
                    }),
                },
                log
            )
        );
        const list = await facade.listMy("player-abc");
        expect(list.map((m) => m.id)).toEqual([7]);
        expect(log[0].url).toBe(`${BASE}/api/playlists?owner=player-abc`);
    });

    test("listPublic：GET ?public=1 并按播放数排序", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists?public=1`]: () => ({
                        status: 200,
                        body: {
                            items: [
                                { ...META, id: 1, playCount: 1 },
                                { ...META, id: 2, playCount: 9 },
                            ],
                        },
                    }),
                },
                log
            )
        );
        const list = await facade.listPublic();
        expect(list.map((m) => m.id)).toEqual([2, 1]); // 播放数降序
        expect(log[0].method).toBe("Get");
        expect(log[0].url).toBe(`${BASE}/api/playlists?public=1`);
    });

    test("getContent：GET /api/playlists/:id 取 items", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists/3`]: () => ({
                        status: 200,
                        body: { ...META, items: ["aaa", "bbb"] },
                    }),
                },
                log
            )
        );
        expect(await facade.getContent(3)).toEqual(["aaa", "bbb"]);
        expect(log[0].url).toBe(`${BASE}/api/playlists/3`);
    });

    test("create：POST /api/playlists 携带 JSON body", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists`]: (call) => ({
                        status: 201,
                        body: { ...META, name: JSON.parse(call.body ?? "{}").name },
                    }),
                },
                log
            )
        );
        const meta = await facade.create("player1", "我的歌单");
        expect(meta?.name).toBe("我的歌单");
        expect(log[0].method).toBe("Post");
        expect(log[0].body).toBe(JSON.stringify({ name: "我的歌单", owner: "player1" }));
        expect(log[0].headers?.["Content-Type"]).toBe("application/json");
    });

    test("setContent：PUT /:id/items 整体替换", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists/3/items`]: () => ({ status: 200 }),
                },
                log
            )
        );
        await facade.setContent(3, ["a", "b"]);
        expect(log[0].method).toBe("Put");
        expect(log[0].url).toBe(`${BASE}/api/playlists/3/items`);
        expect(log[0].body).toBe(JSON.stringify({ items: ["a", "b"] }));
    });

    test("incPlayCount：POST /:id/play", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists/3/play`]: () => ({ status: 200 }),
                },
                log
            )
        );
        await facade.incPlayCount(3, "player1");
        expect(log[0].method).toBe("Post");
        expect(log[0].url).toBe(`${BASE}/api/playlists/3/play`);
    });

    test("remove：DELETE /:id（204 无 body）", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            BASE,
            makeFetch(
                {
                    [`${BASE}/api/playlists/3`]: () => ({ status: 204 }),
                },
                log
            )
        );
        await facade.remove(3);
        expect(log[0].method).toBe("Delete");
        expect(log[0].url).toBe(`${BASE}/api/playlists/3`);
    });

    test("失败静默降级：404 → undefined / []；网络错误 → []", async () => {
        const missing = new RemotePlaylistFacade(
            BASE,
            makeFetch({}, [])
        );
        expect(await missing.getMeta(999)).toBeUndefined();
        expect(await missing.listPublic()).toEqual([]);

        const down = new RemotePlaylistFacade(BASE, async () => {
            throw new Error("network down");
        });
        expect(await down.getContent(1)).toEqual([]);
        expect(await down.update(1, { public: true })).toBeUndefined();
    });

    test("baseUrl 尾部斜杠归一化", async () => {
        const log: Call[] = [];
        const facade = new RemotePlaylistFacade(
            "http://test:3000///",
            makeFetch(
                {
                    [`${BASE}/api/playlists?public=1`]: () => ({ status: 200, body: { items: [] } }),
                },
                log
            )
        );
        await facade.listPublic();
        expect(log[0].url).toBe(`${BASE}/api/playlists?public=1`);
    });
});