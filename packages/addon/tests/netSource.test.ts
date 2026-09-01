import { describe, expect, test } from "bun:test";
import {
    CachedRemoteSource,
    type NetFetch,
} from "../src/serverAdmin/netSource";

const SONG_A = {
    id: "aaa",
    name: "A",
    duration: 100,
    tracks: [{ instrument: { family: "piano", number: 0, name: "x" }, notes: [60, 0, 50, 100] }],
};

function makeFetch(
    routes: Record<string, { status: number; body: unknown }>,
    log?: { method: string; url: string; headers?: Record<string, unknown> }[]
): NetFetch {
    return async (url, init) => {
        log?.push({ method: init.method ?? "GET", url, headers: init.headers });
        const r = routes[url];
        if (!r) return { status: 404, json: async () => ({}) };
        return { status: r.status, json: async () => r.body };
    };
}

const BASE = "http://test:3000";

describe("CachedRemoteSource", () => {
    test("list：远程源不提供全量列表，返回空数组且不发起请求", async () => {
        let calls = 0;
        const fetch: NetFetch = async () => {
            calls++;
            return { status: 200, json: async () => ({ items: [] }) };
        };
        const src = new CachedRemoteSource({ baseUrl: BASE, fetch });
        expect(await src.list()).toEqual([]);
        expect(calls).toBe(0);
    });

    test("get：miss → 网络拉取写内存；再次 get 走内存不重复请求", async () => {
        const log: string[] = [];
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs/aaa`]: { status: 200, body: SONG_A } },
                log as never
            ),
        });

        expect(await src.get("aaa")).toEqual(SONG_A);
        expect(log).toHaveLength(1);

        expect(await src.get("aaa")).toEqual(SONG_A); // 内存命中
        expect(log).toHaveLength(1);
    });

    test("get：内存命中的歌曲在断网时仍可返回（离线播放）", async () => {
        let fail = false;
        const fetch: NetFetch = async (url) => {
            if (fail) throw new Error("network down");
            return { status: 200, json: async () => SONG_A };
        };
        const src = new CachedRemoteSource({ baseUrl: BASE, fetch });
        expect(await src.get("aaa")).toEqual(SONG_A);

        fail = true;
        expect(await src.get("aaa")).toEqual(SONG_A); // 内存命中，无需联网
    });

    test("get 404 / 网络失败且无缓存 → undefined", async () => {
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch({}),
        });
        expect(await src.get("missing")).toBeUndefined();

        const src2 = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: async () => {
                throw new Error("down");
            },
        });
        expect(await src2.get("missing")).toBeUndefined();
    });

    test("page：单请求返回该页 items + total（URL 带 pageSize/page）", async () => {
        const log: { method: string; url: string }[] = [];
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=8&page=3`]: { status: 200, body: { items: [SONG_A], total: 225 } } },
                log
            ),
        });
        const { items, total } = await src.page(3, 8);
        expect(items).toEqual([SONG_A]);
        expect(total).toBe(225);
        expect(log).toHaveLength(1);
        expect(log[0].url).toBe(`${BASE}/api/songs?pageSize=8&page=3`);
    });

    test("page：带 q 时走服务端搜索（URL 编码）", async () => {
        const log: { method: string; url: string }[] = [];
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=8&page=1&q=%E5%91%A8%E6%9D%B0%E4%BC%A6`]: { status: 200, body: { items: [SONG_A], total: 1 } } },
                log
            ),
        });
        const { total } = await src.page(1, 8, "周杰伦");
        expect(total).toBe(1);
        expect(log[0].url).toBe(`${BASE}/api/songs?pageSize=8&page=1&q=%E5%91%A8%E6%9D%B0%E4%BC%A6`);
    });

    test("metaAll：按 q 分页取全（多页合并）", async () => {
        const log: { method: string; url: string }[] = [];
        const song = (id: string) => ({ id, name: `J-${id}`, duration: 10, tracks: [] });
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                {
                    [`${BASE}/api/songs?pageSize=100&page=1&q=J`]: { status: 200, body: { items: [song("a")], total: 1 } },
                },
                log
            ),
        });
        const all = await src.metaAll("J");
        expect(all).toEqual([song("a")]);
        expect(log).toHaveLength(1);
        expect(log[0].url).toBe(`${BASE}/api/songs?pageSize=100&page=1&q=J`);
    });

    test("内存单曲缓存上限 10 首：最久未使用被淘汰，命中会刷新热度", async () => {
        const hitLog: string[] = [];
        const song = (id: string) => ({
            id,
            name: `Song-${id}`,
            duration: 10,
            tracks: [],
        });
        const routes: Record<string, { status: number; body: unknown }> = {};
        for (let i = 1; i <= 100; i++) {
            routes[`${BASE}/api/songs/s${i}`] = { status: 200, body: song(`s${i}`) };
        }
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(routes, hitLog as never),
        });

        // 拉取 11 首 → 第 1 首（最久未使用）应被淘汰
        for (let i = 1; i <= 11; i++) await src.get(`s${i}`);
        expect(hitLog).toHaveLength(11);

        // 命中 s11（最近使用）→ 仍走内存
        const before = hitLog.length;
        await src.get("s11");
        expect(hitLog).toHaveLength(before);

        // s1 已被淘汰 → 重新走网络
        await src.get("s1");
        expect(hitLog).toHaveLength(before + 1);
    });

    test("extraHeaders 透传（SecretString 形状，脚本不可读不校验内容）", async () => {
        const log: { method: string; url: string; headers?: Record<string, unknown> }[] = [];
        const secret = { value: "Bearer secret-token" }; // SecretString 形状
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=8&page=1`]: { status: 200, body: { items: [], total: 0 } } },
                log
            ),
            extraHeaders: () => ({ Authorization: secret }),
        });
        await src.page(1, 8);
        expect(log[0].headers?.Authorization).toBe(secret); // 原对象透传，未读取
    });

    test("无 token 时不带 Authorization 头", async () => {
        const log: { method: string; url: string; headers?: Record<string, unknown> }[] = [];
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=8&page=1`]: { status: 200, body: { items: [], total: 0 } } },
                log
            ),
        });
        await src.page(1, 8);
        expect(log[0].headers?.Authorization).toBeUndefined();
    });

    test("baseUrl 尾部斜杠归一化 + id 编码", async () => {
        const log: { method: string; url: string }[] = [];
        const src = new CachedRemoteSource({
            baseUrl: "http://test:3000///",
            fetch: makeFetch(
                { "http://test:3000/api/songs/a%20b": { status: 200, body: SONG_A } },
                log
            ),
        });
        expect(await src.get("a b")).toEqual(SONG_A);
        expect(log[0].url).toBe("http://test:3000/api/songs/a%20b");
    });
});