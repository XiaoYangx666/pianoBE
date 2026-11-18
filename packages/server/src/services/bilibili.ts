/**
 * B 站音频解析：不依赖浏览器、登录或第三方下载器。
 *
 * 流程与 muscriptor 的 tools/bili_audio.py 一致：
 *   finger/spi 取 buvid → view 取 cid/title → playurl(DASH) 取音频轨 →
 *   带 Referer 下载 fMP4(.m4s) → 交给 amt-cli 原生解码。
 * 普通 64K/132K/192K 音轨无需登录；杜比/ Hi-Res 需要 SESSDATA。
 */

import { writeFileSync } from "node:fs";

const API = "https://api.bilibili.com";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const REFERER = "https://www.bilibili.com/";
const QUALITY: Record<number, string> = {
    30216: "64K",
    30232: "132K",
    30280: "192K",
    30250: "Dolby",
    30251: "Hi-Res",
};
/** 数值越大优先级越高（30280 的数字比 30251 大，但 Hi-Res 更好） */
const QUALITY_RANK: Record<number, number> = {
    30216: 1,
    30232: 2,
    30280: 3,
    30250: 4,
    30251: 5,
};

export class BiliError extends Error {
    constructor(
        message: string,
        readonly code?: number
    ) {
        super(message);
    }
}

export interface BiliSearchItem {
    bvid: string;
    title: string;
    author: string;
    duration: string;
    play: number;
}

export interface BiliVideo {
    bvid: string;
    aid: number;
    cid: number;
    title: string;
    page: number;
    pageCount: number;
    part: string;
    trackUrl: string;
    quality: string;
    codecs: string;
    bandwidth: number;
    /** 当前分 P 的时长（秒）；接口未提供时缺省 */
    durationSec?: number;
}

interface BiliAudioTrack {
    id?: number;
    baseUrl?: string;
    codecs?: string;
    bandwidth?: number;
}

interface BiliViewData {
    bvid?: string;
    aid?: number;
    cid?: number;
    title?: string;
    duration?: number;
    pages?: Array<{ page?: number; cid?: number; part?: string; duration?: number }>;
}

/* ---------------- 会话与限速 ---------------- */

let cookiePromise: Promise<string> | undefined;
let lastCall = 0;
let callChain: Promise<unknown> = Promise.resolve();

const SESSION_TTL = 30 * 60 * 1000;
let sessionAt = 0;

async function getBuvidCookie(): Promise<string> {
    if (cookiePromise && Date.now() - sessionAt < SESSION_TTL) return cookiePromise;
    sessionAt = Date.now();
    cookiePromise = (async () => {
        try {
            const res = await fetch(`${API}/x/frontend/finger/spi`, {
                headers: { "User-Agent": UA, Referer: REFERER },
            });
            const json = (await res.json()) as {
                code?: number;
                data?: { b_3?: string; b_4?: string };
            };
            if (json.code === 0 && json.data?.b_3) {
                const parts = [`buvid3=${json.data.b_3}`];
                if (json.data.b_4) parts.push(`buvid4=${json.data.b_4}`);
                return parts.join("; ");
            }
        } catch {
            // 拿不到指纹时仍尝试直接请求
        }
        return "";
    })();
    return cookiePromise;
}

/** B 站对单 IP 的接口频率很敏感：所有请求串行并至少间隔 1 秒 */
function throttle<T>(task: () => Promise<T>): Promise<T> {
    const run = callChain.then(async () => {
        const wait = 1000 - (Date.now() - lastCall);
        if (wait > 0) await Bun.sleep(wait);
        lastCall = Date.now();
        return task();
    });
    callChain = run.catch(() => {});
    return run;
}

async function fetchJson<T>(
    url: string,
    params: Record<string, string | number>,
    sessdata?: string,
    retries = 3
): Promise<T> {
    const buvid = await getBuvidCookie();
    const cookie = [buvid, sessdata ? `SESSDATA=${sessdata}` : ""].filter(Boolean).join("; ");
    const query = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();

    const attempt = (async () => {
        let lastError: unknown;
        for (let i = 0; i < retries; i++) {
            try {
                const res = await fetch(`${url}?${query}`, {
                    headers: {
                        "User-Agent": UA,
                        Referer: REFERER,
                        ...(cookie ? { Cookie: cookie } : {}),
                    },
                });
                return (await res.json()) as T;
            } catch (error) {
                lastError = error;
                await Bun.sleep(1200 * (i + 1));
            }
        }
        throw new BiliError(`B 站接口请求失败：${String(lastError)}`);
    })();

    return throttle(() => attempt);
}

/* ---------------- 解析 ---------------- */

/** 从 BV 号 / av 号 / 链接 / 关键词中提取视频标识；关键词返回 undefined */
export function parseBiliInput(input: string): { kind: "bvid" | "aid"; id: string } | undefined {
    const bv = input.match(/BV[0-9A-Za-z]{10}/);
    if (bv) return { kind: "bvid", id: bv[0] };
    const av = input.match(/(?:^|\/)av(\d+)/i) ?? input.match(/^(\d+)$/);
    if (av) return { kind: "aid", id: av[1] };
    return undefined;
}

function decodeEntities(text: string): string {
    return text
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

export async function searchBiliVideos(
    keyword: string,
    limit = 10,
    sessdata?: string
): Promise<BiliSearchItem[]> {
    const q = keyword.trim();
    if (!q) return [];
    const json = await fetchJson<{
        code?: number;
        message?: string;
        data?: { result?: Array<Record<string, unknown>> };
    }>(`${API}/x/web-interface/search/type`, { search_type: "video", keyword: q, page: 1 }, sessdata);

    if (json.code !== 0) {
        throw new BiliError(`B 站搜索失败：${json.message ?? json.code}`, json.code);
    }
    const result = json.data?.result ?? [];
    return result
        .filter((item) => typeof item.bvid === "string" && item.bvid.length > 0)
        .slice(0, limit)
        .map((item) => ({
            bvid: String(item.bvid),
            title: decodeEntities(String(item.title ?? "")),
            author: String(item.author ?? ""),
            duration: String(item.duration ?? ""),
            play: Number(item.play ?? 0) || 0,
        }));
}

export async function resolveBiliVideo(
    input: string,
    page = 1,
    sessdata?: string
): Promise<BiliVideo> {
    const parsed = parseBiliInput(input);
    if (!parsed) {
        throw new BiliError("请填写 BV 号或 B 站视频链接；关键词请先搜索再选择");
    }

    const view = await fetchJson<{
        code?: number;
        message?: string;
        data?: BiliViewData;
    }>(
        `${API}/x/web-interface/view`,
        parsed.kind === "bvid" ? { bvid: parsed.id } : { aid: parsed.id },
        sessdata
    );
    if (view.code !== 0 || !view.data) {
        throw new BiliError(`无法获取视频信息：${view.message ?? view.code}`, view.code);
    }
    const info = view.data;
    const pages = info.pages?.length
        ? info.pages
        : [{ page: 1, cid: info.cid, part: info.title }];
    if (page < 1 || page > pages.length) {
        throw new BiliError(`分 P 超出范围（1..${pages.length}）`);
    }
    const selected = pages[page - 1];
    const cid = selected.cid ?? info.cid;
    if (!cid) throw new BiliError("视频没有可用的 cid");

    const bvid = info.bvid ?? (parsed.kind === "bvid" ? parsed.id : "");
    const playurl = await fetchJson<{
        code?: number;
        message?: string;
        data?: {
            dash?: {
                audio?: BiliAudioTrack[];
                flac?: { audio?: BiliAudioTrack | BiliAudioTrack[] };
                dolby?: { audio?: BiliAudioTrack | BiliAudioTrack[] };
            };
        };
    }>(
        `${API}/x/player/playurl`,
        { bvid, cid, qn: 0, fnval: 16, fnver: 0, fourk: 1 },
        sessdata
    );
    if (playurl.code !== 0) {
        throw new BiliError(`无法获取音频流：${playurl.message ?? playurl.code}`, playurl.code);
    }

    const dash = playurl.data?.dash ?? {};
    const tracks: BiliAudioTrack[] = [...(dash.audio ?? [])];
    for (const extra of [dash.flac, dash.dolby]) {
        const audio = extra?.audio;
        if (Array.isArray(audio)) tracks.push(...audio);
        else if (audio) tracks.push(audio);
    }
    const usable = tracks.filter((track) => typeof track.baseUrl === "string");
    if (usable.length === 0) throw new BiliError("该视频没有可用的音频轨");
    const rank = (track: BiliAudioTrack) =>
        QUALITY_RANK[track.id ?? 0] ?? (track.id ?? 0) / 100_000;
    const best = usable.reduce((a, b) => (rank(b) > rank(a) ? b : a));

    const title =
        pages.length === 1
            ? String(info.title ?? bvid)
            : `${info.title ?? bvid} - P${selected.page ?? page} ${selected.part ?? ""}`;

    const duration = Number(selected.duration ?? info.duration ?? 0);

    return {
        bvid,
        aid: info.aid ?? 0,
        cid,
        title: title.trim(),
        page: selected.page ?? page,
        pageCount: pages.length,
        part: selected.part ?? String(info.title ?? ""),
        trackUrl: best.baseUrl!,
        quality: QUALITY[best.id ?? 0] ?? String(best.id ?? "?"),
        codecs: best.codecs ?? "",
        bandwidth: best.bandwidth ?? 0,
        durationSec: duration > 0 ? duration : undefined,
    };
}

export async function downloadBiliAudio(
    video: BiliVideo,
    dest: string,
    sessdata?: string
): Promise<number> {
    const buvid = await getBuvidCookie();
    const cookie = [buvid, sessdata ? `SESSDATA=${sessdata}` : ""].filter(Boolean).join("; ");
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(video.trackUrl, {
                headers: {
                    "User-Agent": UA,
                    Referer: REFERER,
                    ...(cookie ? { Cookie: cookie } : {}),
                },
            });
            if (!res.ok) {
                throw new BiliError(`音频下载失败（HTTP ${res.status}）`, res.status);
            }
            // 不直接 Bun.write(res)：部分 CDN 会中断流式写入，先完整读入内存更稳
            const buffer = await res.arrayBuffer();
            if (buffer.byteLength === 0) throw new BiliError("下载到的音频为空");
            writeFileSync(dest, new Uint8Array(buffer));
            return buffer.byteLength;
        } catch (error) {
            lastError = error;
            console.warn(`[bilibili] 音频下载失败（第 ${attempt + 1} 次）`, error);
            if (attempt < 2) await Bun.sleep(1000 * (attempt + 1));
        }
    }
    throw new BiliError(
        `音频下载失败：${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
}
