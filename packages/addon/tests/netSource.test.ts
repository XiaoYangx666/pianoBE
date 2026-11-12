import { describe, expect, test } from "bun:test";
import { encodeBase64Url, encodePbe2, readPbe2Header } from "@piano/core";
import {
    RemoteMidiSource,
    type NetFetch,
} from "../src/platform/server/admin/netSource";

const SONG_META = { id: "aaa", name: "A", duration: 100 };
const PBE2 = encodePbe2({
    ...SONG_META,
    tracks: [{ instrument: { family: "piano", number: 0, name: "x" }, notes: [60, 0, 50, 100] }],
});
const REMOTE_SONG = {
    id: SONG_META.id,
    name: SONG_META.name,
    duration: SONG_META.duration,
    data: encodeBase64Url(PBE2),
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

describe("RemoteMidiSource", () => {
    test("list：远程源不提供全量列表，返回空数组且不发起请求", async () => {
        let calls = 0;
        const fetch: NetFetch = async () => {
            calls++;
            return { status: 200, json: async () => ({ items: [] }) };
        };
        const src = new RemoteMidiSource({ baseUrl: BASE, fetch });
        expect(await src.list()).toEqual([]);
        expect(calls).toBe(0);
    });

    test("get：拉取 PBE2（Base64URL 解码后字节一致）", async () => {
        const src = new RemoteMidiSource({
            baseUrl: BASE,
            fetch: makeFetch({ [`${BASE}/api/songs/aaa`]: { status: 200, body: REMOTE_SONG } }),
        });
        const bytes = await src.get("aaa");
        expect(bytes).toBeDefined();
        expect(readPbe2Header(bytes!).id).toBe(SONG_META.id);
        expect(Array.from(bytes!)).toEqual(Array.from(PBE2));
    });

    test("远程源不做单曲缓存：每次 get 都请求，缓存统一交给 SongCache", async () => {
        const log: string[] = [];
        const src = new RemoteMidiSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs/aaa`]: { status: 200, body: REMOTE_SONG } },
                log as never
            ),
        });
        await src.get("aaa");
        await src.get("aaa");
        expect(log).toHaveLength(2);
    });

    test("get 404 / 网络失败 → undefined", async () => {
        const src = new RemoteMidiSource({
            baseUrl: BASE,
            fetch: makeFetch({}),
        });
        expect(await src.get("missing")).toBeUndefined();

        const src2 = new RemoteMidiSource({
            baseUrl: BASE,
            fetch: async () => {
                throw new Error("down");
            },
        });
        expect(await src2.get("missing")).toBeUndefined();
    });

    test("page：单请求返回该页 items + total（URL 带 pageSize/page）", async () => {
        const log: { method: string; url: string }[] = [];
        const src = new RemoteMidiSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=8&page=3`]: { status: 200, body: { items: [SONG_META], total: 225 } } },
                log
            ),
        });
        const { items, total } = await src.page(3, 8);
        expect(items).toEqual([SONG_META]);
        expect(total).toBe(225);
        expect(log).toHaveLength(1);
        expect(log[0].url).toBe(`${BASE}/api/songs?pageSize=8&page=3`);
    });

    test("page：带 q 时走服务端搜索（URL 编码）", async () => {
        const log: { method: string; url: string }[] = [];
        const src = new RemoteMidiSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=8&page=1&q=%E5%91%A8%E6%9D%B0%E4%BC%A6`]: { status: 200, body: { items: [SONG_META], total: 1 } } },
                log
            ),
        });
        const { total } = await src.page(1, 8, "周杰伦");
        expect(total).toBe(1);
        expect(log[0].url).toBe(`${BASE}/api/songs?pageSize=8&page=1&q=%E5%91%A8%E6%9D%B0%E4%BC%A6`);
    });

    test("metaAll：按 q 分页取全（多页合并）", async () => {
        const log: { method: string; url: string }[] = [];
        const song = (id: string) => ({ id, name: `J-${id}`, duration: 10 });
        const src = new RemoteMidiSource({
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

    test("extraHeaders 透传（SecretString 形状，脚本不可读不校验内容）", async () => {
        const log: { method: string; url: string; headers?: Record<string, unknown> }[] = [];
        const secret = { value: "Bearer secret-token" }; // SecretString 形状
        const src = new RemoteMidiSource({
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
        const src = new RemoteMidiSource({
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
        const src = new RemoteMidiSource({
            baseUrl: "http://test:3000///",
            fetch: makeFetch(
                { "http://test:3000/api/songs/a%20b": { status: 200, body: REMOTE_SONG } },
                log
            ),
        });
        expect(await src.get("a b")).toBeDefined();
        expect(log[0].url).toBe("http://test:3000/api/songs/a%20b");
    });
});
