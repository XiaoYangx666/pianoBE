import { describe, expect, test } from "bun:test";
import { encodeBase64Url, encodePbe3, readPbe3Header } from "@piano/core";
import type { NetFetch } from "../src/platform/server/admin/netSource";
import { OnlineTranscribeClient, OnlineTranscribeError } from "../src/platform/server/admin/transcribeClient";

const SONG_META = { id: "abc12345", name: "转录曲目", duration: 400 };
const PBE3 = encodePbe3({
    ...SONG_META,
    tracks: [{ instrument: { family: "piano", number: 0, name: "x" }, notes: [60, 0, 50, 100] }],
});
const BASE = "http://test:3000";

interface Call {
    method: string;
    url: string;
    headers?: Record<string, unknown>;
    body?: string;
}

function makeFetch(
    routes: Record<string, { status: number; body: unknown }>,
    calls: Call[] = []
): NetFetch {
    return async (url, init) => {
        calls.push({
            method: init.method ?? "Get",
            url,
            headers: init.headers,
            body: init.body,
        });
        const route = routes[`${init.method ?? "Get"} ${url}`] ?? routes[url];
        if (!route) return { status: 404, json: async () => ({}) };
        return { status: route.status, json: async () => route.body };
    };
}

describe("OnlineTranscribeClient", () => {
    test("startBilibili：POST input/name，并透传附加头", async () => {
        const calls: Call[] = [];
        const client = new OnlineTranscribeClient({
            baseUrl: `${BASE}/`,
            fetch: makeFetch(
                { [`Post ${BASE}/api/transcribe/jobs/bilibili`]: { status: 201, body: { id: "job-1" } } },
                calls
            ),
            extraHeaders: () => ({ Authorization: "Bearer secret" }),
        });
        expect(await client.startBilibili("BV1xx411c7mD", "测试")).toEqual({ id: "job-1" });
        expect(calls[0]?.url).toBe(`${BASE}/api/transcribe/jobs/bilibili`);
        expect(calls[0]?.method).toBe("Post");
        expect(calls[0]?.headers?.Authorization).toBe("Bearer secret");
        expect(JSON.parse(calls[0]!.body!)).toEqual({ input: "BV1xx411c7mD", name: "测试" });
    });

    test("getJob：读取 percent/stage，服务端错误转成可读消息", async () => {
        const client = new OnlineTranscribeClient({
            baseUrl: BASE,
            fetch: makeFetch({
                [`${BASE}/api/transcribe/jobs/job-1`]: {
                    status: 200,
                    body: { id: "job-1", stage: "transcribing", name: "曲目", percent: 42, noteCount: 3 },
                },
                [`${BASE}/api/transcribe/jobs/full`]: {
                    status: 429,
                    body: { error: "转录队列已满，请稍后再试" },
                },
            }),
        });
        const job = await client.getJob("job-1");
        expect(job.stage).toBe("transcribing");
        expect(job.percent).toBe(42);
        await expect(client.getJob("full")).rejects.toThrow("转录队列已满");
    });

    test("getSong：Base64URL 解码为 PBE3 并校验头部", async () => {
        const client = new OnlineTranscribeClient({
            baseUrl: BASE,
            fetch: makeFetch({
                [`${BASE}/api/transcribe/jobs/job-1/song`]: {
                    status: 200,
                    body: {
                        id: SONG_META.id,
                        name: SONG_META.name,
                        duration: SONG_META.duration,
                        noteCount: 1,
                        bytes: PBE3.byteLength,
                        expiresAt: 123,
                        data: encodeBase64Url(PBE3),
                    },
                },
            }),
        });
        const song = await client.getSong("job-1");
        expect(readPbe3Header(song.pbe3).id).toBe(SONG_META.id);
        expect(song.name).toBe(SONG_META.name);
        expect(song.bytes).toBe(PBE3.byteLength);
    });

    test("getSong：缺少 data 时报错", async () => {
        const client = new OnlineTranscribeClient({
            baseUrl: BASE,
            fetch: makeFetch({
                [`${BASE}/api/transcribe/jobs/job-1/song`]: { status: 200, body: {} },
            }),
        });
        await expect(client.getSong("job-1")).rejects.toThrow("缺少曲目数据");
    });

    test("错误保留 HTTP 状态，供上层区分任务过期(404)", async () => {
        const client = new OnlineTranscribeClient({
            baseUrl: BASE,
            fetch: makeFetch({}),
        });
        const error = await client.getJob("missing").catch((reason) => reason);
        expect(error).toBeInstanceOf(OnlineTranscribeError);
        expect((error as OnlineTranscribeError).status).toBe(404);
    });
});
