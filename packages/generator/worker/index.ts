const STAT_DEDUP_SECONDS = 15 * 60;

interface Env {
    DB?: any;
    ASSETS: {
        fetch(input: Request | URL | string): Promise<Response>;
    };
    IP_HASH_SECRET?: string;
}

type StatKind = "play" | "add";

let libraryIdsPromise: Promise<Set<string>> | null = null;
let hmacKeyPromise: Promise<CryptoKey> | null = null;
let hmacKeySecret: string | null = null;

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

async function getLibraryIds(request: Request, env: Env): Promise<Set<string>> {
    if (!libraryIdsPromise) {
        const indexUrl = new URL("/library/index.json", request.url);
        libraryIdsPromise = env.ASSETS.fetch(indexUrl)
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error("library index unavailable: HTTP " + response.status);
                }
                const rows = (await response.json()) as Array<{ id?: string }>;
                return new Set(
                    rows
                        .map((row) => row.id)
                        .filter((id): id is string => typeof id === "string")
                );
            })
            .catch((error) => {
                libraryIdsPromise = null;
                throw error;
            });
    }
    return libraryIdsPromise;
}

async function hashIp(ip: string, secret: string): Promise<string> {
    if (!hmacKeyPromise || hmacKeySecret !== secret) {
        hmacKeySecret = secret;
        hmacKeyPromise = crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
    }

    const key = await hmacKeyPromise;
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(ip)
    );
    return Array.from(new Uint8Array(signature), (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");
}

async function getStats(env: Env): Promise<Response> {
    if (!env.DB) {
        return json({ error: "d1_not_configured" }, 503);
    }

    const result = await env.DB
        .prepare("SELECT song_id, plays, adds FROM song_stats")
        .all();

    const plays: Record<string, number> = {};
    const adds: Record<string, number> = {};
    for (const row of result.results ?? []) {
        if (typeof row.song_id !== "string") continue;
        if (typeof row.plays === "number") plays[row.song_id] = row.plays;
        if (typeof row.adds === "number") adds[row.song_id] = row.adds;
    }
    return json({ plays, adds });
}

async function recordStat(
    request: Request,
    env: Env,
    songId: string,
    kind: StatKind
): Promise<Response> {
    if (!env.DB) {
        return json({ error: "d1_not_configured" }, 503);
    }
    if (!env.IP_HASH_SECRET) {
        return json({ error: "ip_hash_secret_not_configured" }, 503);
    }
    if (!/^[0-9a-f]{1,8}$/i.test(songId)) {
        return json({ error: "invalid_song_id" }, 400);
    }

    const libraryIds = await getLibraryIds(request, env);
    if (!libraryIds.has(songId)) {
        return json({ error: "song_not_found" }, 404);
    }

    // 只信任 Cloudflare 注入的访客地址，不接受前端自己传 IP。
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) {
        return json({ error: "client_ip_unavailable" }, 400);
    }

    const visitorHash = await hashIp(ip, env.IP_HASH_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const guardTable = kind === "play" ? "play_guard" : "add_guard";

    // play 与 add 各自独立去重。每个 song + visitor + 事件类型永远最多一行。
    // trigger 负责在 INSERT / 有效 UPDATE 时原子增加对应计数。
    const results = await env.DB.batch([
        env.DB
            .prepare(
                "INSERT OR IGNORE INTO song_stats(song_id, plays, adds) VALUES (?, 0, 0)"
            )
            .bind(songId),
        env.DB
            .prepare(
                `INSERT INTO ${guardTable}(song_id, visitor_hash, last_counted_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(song_id, visitor_hash) DO UPDATE SET
                    last_counted_at = excluded.last_counted_at
                 WHERE excluded.last_counted_at - ${guardTable}.last_counted_at >= ?
                 RETURNING last_counted_at`
            )
            .bind(songId, visitorHash, now, STAT_DEDUP_SECONDS),
    ]);

    const guardResult = results[1];
    const counted =
        Array.isArray(guardResult?.results) && guardResult.results.length > 0;
    return json({ counted });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        try {
            if (url.pathname === "/api/stats") {
                if (request.method !== "GET") {
                    return json({ error: "method_not_allowed" }, 405);
                }
                return await getStats(env);
            }

            const statMatch = url.pathname.match(
                /^\/api\/songs\/([^/]+)\/(play|add)$/
            );
            if (statMatch) {
                if (request.method !== "POST") {
                    return json({ error: "method_not_allowed" }, 405);
                }
                return await recordStat(
                    request,
                    env,
                    decodeURIComponent(statMatch[1]),
                    statMatch[2] as StatKind
                );
            }

            if (url.pathname.startsWith("/api/")) {
                return json({ error: "not_found" }, 404);
            }

            return env.ASSETS.fetch(request);
        } catch (error) {
            console.error("[generator worker] request failed", error);
            return json({ error: "internal_error" }, 500);
        }
    },
};
