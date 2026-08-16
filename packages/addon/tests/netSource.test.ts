import { describe, expect, test } from "bun:test";
import {
    CachedRemoteSource,
    type CacheStorage,
    type NetFetch,
} from "../src/serverAdmin/netSource";

const SONG_A = {
    id: "aaa",
    name: "A",
    duration: 100,
    tracks: [{ instrument: { family: "piano", number: 0, name: "x" }, notes: [60, 0, 50, 100] }],
};

class MemStorage implements CacheStorage {
    private map = new Map<string, unknown>();
    getJSON(key: string) {
        return this.map.get(key);
    }
    setJSON(key: string, value: unknown) {
        this.map.set(key, value);
    }
}

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
    test("list 首次拉取并写缓存；TTL 内不重复请求", async () => {
        const log: { method: string; url: string }[] = [];
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=100`]: { status: 200, body: { items: [SONG_A] } } },
                log
            ),
            storage: new MemStorage(),
        });

        const first = await src.list();
        expect(first).toEqual([SONG_A]);
        expect(log).toHaveLength(1);

        const second = await src.list(); // TTL 内 → 内存缓存
        expect(second).toEqual([SONG_A]);
        expect(log).toHaveLength(1);
    });

    test("list 网络失败 → 持久缓存兜底（离线可用）", async () => {
        const storage = new MemStorage();
        // 先成功一次写入缓存
        let fail = false;
        const fetch: NetFetch = async (url) => {
            if (fail) throw new Error("network down");
            return { status: 200, json: async () => ({ items: [SONG_A] }) };
        };
        const src = new CachedRemoteSource({ baseUrl: BASE, fetch, storage });
        await src.list();

        // 断网 + 新实例（模拟重启）→ 从存储兜底
        fail = true;
        const src2 = new CachedRemoteSource({
            baseUrl: BASE,
            fetch,
            storage,
            metaTtlMs: 0,
        });
        expect(await src2.list()).toEqual([SONG_A]);
    });

    test("get：存储 miss → 网络拉取并写缓存；再次 get 走内存", async () => {
        const log: string[] = [];
        const storage = new MemStorage();
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs/aaa`]: { status: 200, body: SONG_A } },
                log as never
            ),
            storage,
        });

        expect(await src.get("aaa")).toEqual(SONG_A);
        expect(log).toHaveLength(1);
        expect(storage.getJSON("song:aaa")).toEqual(SONG_A);

        expect(await src.get("aaa")).toEqual(SONG_A); // 内存
        expect(log).toHaveLength(1);
    });

    test("get：存储有缓存时网络失败也能返回（离线播放）", async () => {
        const storage = new MemStorage();
        storage.setJSON("song:aaa", SONG_A);
        const fetch: NetFetch = async () => {
            throw new Error("network down");
        };
        const src = new CachedRemoteSource({ baseUrl: BASE, fetch, storage });
        expect(await src.get("aaa")).toEqual(SONG_A);
    });

    test("get 404 / 网络失败且无缓存 → undefined", async () => {
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch({}),
            storage: new MemStorage(),
        });
        expect(await src.get("missing")).toBeUndefined();

        const src2 = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: async () => {
                throw new Error("down");
            },
            storage: new MemStorage(),
        });
        expect(await src2.get("missing")).toBeUndefined();
    });

    test("extraHeaders 透传（SecretString 形状，脚本不可读不校验内容）", async () => {
        const log: { method: string; url: string; headers?: Record<string, unknown> }[] = [];
        const secret = { value: "Bearer secret-token" }; // SecretString 形状
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=100`]: { status: 200, body: { items: [] } } },
                log
            ),
            storage: new MemStorage(),
            extraHeaders: () => ({ Authorization: secret }),
        });
        await src.list();
        expect(log[0].headers?.Authorization).toBe(secret); // 原对象透传，未读取
    });

    test("无 token 时不带 Authorization 头", async () => {
        const log: { method: string; url: string; headers?: Record<string, unknown> }[] = [];
        const src = new CachedRemoteSource({
            baseUrl: BASE,
            fetch: makeFetch(
                { [`${BASE}/api/songs?pageSize=100`]: { status: 200, body: { items: [] } } },
                log
            ),
            storage: new MemStorage(),
        });
        await src.list();
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
            storage: new MemStorage(),
        });
        expect(await src.get("a b")).toEqual(SONG_A);
        expect(log[0].url).toBe("http://test:3000/api/songs/a%20b");
    });
});