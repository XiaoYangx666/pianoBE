import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { extname } from "node:path";
import type { AppDeps } from "../app.js";
import { getToken, requireRole, type AppVariables } from "../auth.js";
import {
    TranscribeJobStore,
    type TranscribeJobSnapshot,
} from "../services/transcribeJobs.js";
import { searchBiliVideos } from "../services/bilibili.js";

/** 音频上传上限：B 站无损音频通常不到 30 MB，100 MB 足够覆盖长录音 */
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set([
    ".mp3",
    ".m4a",
    ".mp4",
    ".m4s",
    ".aac",
    ".wav",
    ".flac",
    ".ogg",
    ".opus",
    ".wma",
]);

const AUDIO_MIME: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".m4s": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wma": "audio/x-ms-wma",
};

function decodeHeader(raw: string | undefined): string {
    const value = raw ?? "";
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function cleanName(raw: string | undefined, fallback = "未命名转录"): string {
    let value = decodeHeader(raw);
    value = value.replace(/\.(mp3|m4a|mp4|m4s|aac|wav|flac|ogg|opus|wma|mid|midi)$/i, "");
    value = value.replace(/[\\/:*?"<>|\r\n\t§]/g, "_").trim().slice(0, 100);
    return value || fallback;
}

function audioExtension(name: string | undefined, contentType: string | undefined): string {
    const ext = extname(name ?? "").toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) return ext;
    if (contentType?.includes("wav")) return ".wav";
    if (contentType?.includes("flac")) return ".flac";
    if (contentType?.includes("ogg")) return ".ogg";
    if (contentType?.includes("mp4")) return ".m4a";
    if (contentType?.includes("mpeg")) return ".mp3";
    return ".audio";
}

function audioMime(ext: string, contentType: string | undefined): string {
    if (contentType && /^(audio|video)\//.test(contentType)) return contentType;
    return AUDIO_MIME[ext] ?? "application/octet-stream";
}

export function transcribeRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("user", deps.config.allowPublicRead);
    const jobRole = () => requireRole("user");
    const jobs = new TranscribeJobStore({
        songPort: deps.songPort,
        config: deps.config,
        amt: deps.amt,
    });

    // 任务产物不跟随 ALLOW_PUBLIC_READ：必须带令牌，且只能看自己发起的（admin 除外）。
    const jobOr404 = (c: Context<{ Variables: AppVariables }>, id: string) =>
        jobs.visible(id, getToken(c)) ? jobs.get(id) : undefined;

    // GET /api/transcribe/status —— 前端据此提示 AMT 是否部署完成
    app.get("/status", readRole(), (c) => {
        if (!deps.amt) {
            return c.json({ available: false, message: "服务端未启用 AMT" });
        }
        const status = deps.amt.status();
        return c.json({
            ...status,
            bilibili: true,
            maxAudioBytes: MAX_AUDIO_BYTES,
            queued: jobs.pendingCount,
            active: jobs.activeCount,
            queueLimit: deps.config.amtMaxQueue,
            queueFull: jobs.isQueueFull,
        });
    });

    // GET /api/transcribe/bilibili/search?q= —— 关键词搜索（需要 buvid 指纹）
    app.get("/bilibili/search", readRole(), async (c) => {
        const q = c.req.query("q")?.trim() ?? "";
        if (!q) return c.json({ error: "缺少搜索关键词" }, 400);
        const limit = Math.min(20, Math.max(1, Number(c.req.query("limit") ?? 10) || 10));
        try {
            const items = await searchBiliVideos(q, limit, deps.config.biliSessdata);
            return c.json({ items });
        } catch (error) {
            return c.json(
                { error: error instanceof Error ? error.message : String(error) },
                502
            );
        }
    });

    // POST /api/transcribe/jobs —— 上传音频，返回任务（不写入曲目库）
    // 上传最多 100 MB，保持管理员限定，避免普通令牌占内存/临时盘。
    app.post("/jobs", requireRole("admin"), async (c) => {
        if (!deps.amt?.status().available) {
            return c.json({ error: deps.amt?.status().message ?? "服务端未启用 AMT" }, 503);
        }
        if (jobs.isQueueFull) {
            return c.json({ error: "转录队列已满，请稍后再试" }, 429);
        }

        const length = Number(c.req.header("Content-Length") ?? 0);
        if (length > MAX_AUDIO_BYTES) {
            return c.json({ error: "音频超过大小限制（100 MB）" }, 413);
        }
        const buffer = await c.req.arrayBuffer();
        if (!buffer || buffer.byteLength === 0) {
            return c.json({ error: "空音频" }, 400);
        }
        if (buffer.byteLength > MAX_AUDIO_BYTES) {
            return c.json({ error: "音频超过大小限制（100 MB）" }, 413);
        }

        const rawName = decodeHeader(c.req.header("X-File-Name"));
        const contentType = c.req.header("Content-Type");
        const ext = audioExtension(rawName, contentType);
        const durationRaw = Number(c.req.header("X-Audio-Duration") ?? 0);
        const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;

        const job = jobs.startUpload({
            buffer: new Uint8Array(buffer),
            ext,
            mime: audioMime(ext, contentType),
            name: cleanName(rawName, "上传转录"),
            durationSec,
            fileName: rawName || undefined,
            ownerId: getToken(c)?.id,
        });
        return c.json(job, 201);
    });

    // POST /api/transcribe/jobs/bilibili —— { input, page?, name? }
    // 普通令牌即可创建临时任务；结果只有显式 save 才会进入曲库（要求管理员）。
    app.post("/jobs/bilibili", requireRole("user"), async (c) => {
        if (!deps.amt?.status().available) {
            return c.json({ error: deps.amt?.status().message ?? "服务端未启用 AMT" }, 503);
        }
        if (jobs.isQueueFull) {
            return c.json({ error: "转录队列已满，请稍后再试" }, 429);
        }
        const body = (await c.req.json().catch(() => null)) as
            | { input?: unknown; page?: unknown; name?: unknown }
            | null;
        const input = typeof body?.input === "string" ? body.input.trim() : "";
        if (!input) return c.json({ error: "缺少视频链接或 BV 号" }, 400);
        const page = Math.max(1, Number(body?.page ?? 1) || 1);
        const name = typeof body?.name === "string" ? cleanName(body.name) : undefined;

        const job = jobs.startBilibili({ url: input, page, name, ownerId: getToken(c)?.id });
        return c.json(job, 201);
    });

    // GET /api/transcribe/jobs/:id —— 任务状态（轮询/刷新后恢复）
    app.get("/jobs/:id", jobRole(), (c) => {
        const job = jobOr404(c, c.req.param("id") ?? "");
        if (!job) return c.json({ error: "任务不存在或已过期" }, 404);
        return c.json(job);
    });

    // GET /api/transcribe/jobs/:id/events —— SSE 进度
    app.get("/jobs/:id/events", jobRole(), async (c) => {
        const id = c.req.param("id") ?? "";
        const initial = jobOr404(c, id);
        if (!initial) return c.json({ error: "任务不存在或已过期" }, 404);

        c.header("Cache-Control", "no-cache");
        c.header("X-Accel-Buffering", "no");

        return streamSSE(c, async (stream) => {
            let closed = false;
            let writeChain = Promise.resolve();
            let finish!: () => void;
            const finished = new Promise<void>((resolve) => {
                finish = resolve;
            });

            const send = (snapshot: TranscribeJobSnapshot) => {
                if (closed) return;
                writeChain = writeChain
                    .then(() =>
                        stream.writeSSE({ event: "progress", data: JSON.stringify(snapshot) })
                    )
                    .catch(() => {
                        closed = true;
                    });
            };

            send(initial);
            if (initial.stage === "done" || initial.stage === "error") {
                await writeChain;
                return;
            }

            const unsubscribe = jobs.subscribe(id, (snapshot) => {
                send(snapshot);
                if (snapshot.stage === "done" || snapshot.stage === "error") finish();
            });
            const heartbeat = setInterval(() => {
                if (closed) return;
                writeChain = writeChain
                    .then(() => stream.writeSSE({ event: "ping", data: "1" }))
                    .catch(() => {
                        closed = true;
                    });
            }, 15000);
            (heartbeat as unknown as { unref?: () => void }).unref?.();

            const stop = () => {
                clearInterval(heartbeat);
                unsubscribe();
                finish();
            };
            stream.onAbort(stop);

            await finished;
            await writeChain;
            stop();
        });
    });

    // PATCH /api/transcribe/jobs/:id —— { name } 改任务名
    app.patch("/jobs/:id", jobRole(), async (c) => {
        const id = c.req.param("id") ?? "";
        if (!jobs.visible(id, getToken(c))) return c.json({ error: "任务不存在或已过期" }, 404);
        const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
        const name = typeof body?.name === "string" ? cleanName(body.name, "") : "";
        if (!name) return c.json({ error: "曲名不能为空" }, 400);
        const job = jobs.rename(id, name);
        if (!job) return c.json({ error: "任务不存在或已过期" }, 404);
        return c.json(job);
    });

    // POST /api/transcribe/jobs/:id/save —— 显式保存到曲目库
    app.post("/jobs/:id/save", requireRole("admin"), async (c) => {
        const id = c.req.param("id") ?? "";
        const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
        const name = typeof body?.name === "string" ? body.name.trim() : undefined;
        if (name !== undefined && !name) return c.json({ error: "曲名不能为空" }, 400);
        const job = jobs.save(id, name);
        if (!job) return c.json({ error: "任务不存在、尚未转录完成或曲名无效" }, 404);
        return c.json(job);
    });

    // GET /api/transcribe/jobs/:id/code —— 游戏内导入码
    app.get("/jobs/:id/code", jobRole(), (c) => {
        const id = c.req.param("id") ?? "";
        if (!jobs.visible(id, getToken(c))) return c.json({ error: "任务不存在或尚未转录完成" }, 404);
        const code = jobs.code(id);
        if (!code) return c.json({ error: "任务不存在或尚未转录完成" }, 404);
        return c.json(code);
    });

    // GET /api/transcribe/jobs/:id/song —— 转录结果的 PBE3（BDS 直接写入存储卡）
    app.get("/jobs/:id/song", jobRole(), (c) => {
        const id = c.req.param("id") ?? "";
        if (!jobs.visible(id, getToken(c))) {
            return c.json({ error: "任务不存在、尚未转录完成或已过期" }, 404);
        }
        const song = jobs.song(id);
        if (!song) return c.json({ error: "任务不存在、尚未转录完成或已过期" }, 404);
        return c.json(song);
    });

    // GET /api/transcribe/jobs/:id/audio —— 原始音频（支持 Range，用于试听）
    app.get("/jobs/:id/audio", jobRole(), async (c) => {
        const id = c.req.param("id") ?? "";
        if (!jobs.visible(id, getToken(c))) return c.json({ error: "任务不存在或音频未就绪" }, 404);
        const audio = jobs.audio(id);
        if (!audio) return c.json({ error: "任务不存在或音频未就绪" }, 404);

        const file = Bun.file(audio.path);
        const size = file.size;
        const headers = new Headers({
            "content-type": audio.mime,
            "accept-ranges": "bytes",
            "cache-control": "no-store",
        });

        const range = c.req.header("range");
        if (!range) {
            headers.set("content-length", String(size));
            return new Response(file, { headers });
        }

        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!match) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (!Number.isFinite(start) || start >= size || end < start) {
            return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        }
        const blob = file.slice(start, end + 1);
        headers.set("content-length", String(end - start + 1));
        headers.set("content-range", `bytes ${start}-${end}/${size}`);
        return new Response(blob, { status: 206, headers });
    });

    // GET /api/transcribe/jobs/:id/midi —— 转录结果原始 MIDI（试听）
    app.get("/jobs/:id/midi", jobRole(), (c) => {
        const id = c.req.param("id") ?? "";
        if (!jobs.visible(id, getToken(c))) return c.json({ error: "任务不存在或尚未转录完成" }, 404);
        const midi = jobs.midi(id);
        if (!midi) return c.json({ error: "任务不存在或尚未转录完成" }, 404);
        return c.body(midi, 200, { "content-type": "audio/midi", "cache-control": "no-store" });
    });

    // DELETE /api/transcribe/jobs/:id —— 放弃任务并清理临时文件
    app.delete("/jobs/:id", jobRole(), (c) => {
        const id = c.req.param("id") ?? "";
        if (!jobs.visible(id, getToken(c))) return c.json({ error: "任务不存在或已过期" }, 404);
        const removed = jobs.remove(id);
        if (!removed) return c.json({ error: "任务不存在或已过期" }, 404);
        return c.body(null, 204);
    });

    return app;
}
