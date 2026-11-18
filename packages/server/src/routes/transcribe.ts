import { Hono } from "hono";
import type { Context } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";
import { AmtBusyError, AmtTimeoutError, AmtUnavailableError } from "../services/amt.js";
import {
    BiliError,
    downloadBiliAudio,
    resolveBiliVideo,
    searchBiliVideos,
} from "../services/bilibili.js";

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

function cleanName(raw: string | undefined, fallback = "未命名转录"): string {
    let value = raw ?? "";
    try {
        value = decodeURIComponent(value);
    } catch {
        // 保留原始值
    }
    value = value.replace(/\.(mp3|m4a|mp4|m4s|aac|wav|flac|ogg|opus|wma|mid|midi)$/i, "");
    value = value.replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim().slice(0, 100);
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

function mapError(c: Context<{ Variables: AppVariables }>, error: unknown) {
    if (error instanceof AmtUnavailableError) {
        return c.json({ error: error.message }, 503);
    }
    if (error instanceof AmtBusyError) {
        return c.json({ error: error.message }, 429);
    }
    if (error instanceof AmtTimeoutError) {
        return c.json({ error: error.message }, 504);
    }
    if (error instanceof BiliError) {
        return c.json({ error: error.message }, 502);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[transcribe]", error);
    return c.json({ error: `转录失败：${message}` }, 500);
}

export function transcribeRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);

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
            return mapError(c, error);
        }
    });

    // POST /api/transcribe/bilibili —— { input, page?, name? }
    app.post("/bilibili", requireRole("write"), async (c) => {
        if (!deps.amt) return c.json({ error: "服务端未启用 AMT" }, 503);
        const body = (await c.req.json().catch(() => null)) as
            | { input?: unknown; page?: unknown; name?: unknown }
            | null;
        const input = typeof body?.input === "string" ? body.input.trim() : "";
        if (!input) return c.json({ error: "缺少视频链接或 BV 号" }, 400);
        const page = Math.max(1, Number(body?.page ?? 1) || 1);

        const work = mkdtempSync(join(tmpdir(), "pianobe-bili-"));
        try {
            const video = await resolveBiliVideo(input, page, deps.config.biliSessdata);
            const audioPath = join(work, "audio.m4s");
            await downloadBiliAudio(video, audioPath, deps.config.biliSessdata);

            const result = await deps.amt.transcribe(audioPath);
            const name = cleanName(
                typeof body?.name === "string" ? body.name : video.title,
                "B站转录"
            );
            const song = deps.songPort.saveMidiFile(result.midi, name);
            const meta = deps.songPort
                .listMetasWithStats()
                .find((item) => item.id === song.id) ?? song;

            return c.json({
                song: meta,
                source: {
                    kind: "bilibili",
                    bvid: video.bvid,
                    cid: video.cid,
                    title: video.title,
                    page: video.page,
                    pageCount: video.pageCount,
                    quality: video.quality,
                    codecs: video.codecs,
                    bandwidth: video.bandwidth,
                },
                elapsedMs: result.elapsedMs,
            }, 201);
        } catch (error) {
            return mapError(c, error);
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    });

    // POST /api/transcribe —— 原始音频字节；文件名走 X-File-Name 头
    app.post("/", requireRole("write"), async (c) => {
        if (!deps.amt) return c.json({ error: "服务端未启用 AMT" }, 503);

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

        const rawName = c.req.header("X-File-Name") ?? "";
        const ext = audioExtension(rawName, c.req.header("Content-Type"));
        const name = cleanName(rawName, "上传转录");
        const work = mkdtempSync(join(tmpdir(), "pianobe-audio-"));

        try {
            const audioPath = join(work, `audio${ext}`);
            writeFileSync(audioPath, new Uint8Array(buffer));
            const result = await deps.amt.transcribe(audioPath);
            const song = deps.songPort.saveMidiFile(result.midi, name);
            const meta = deps.songPort
                .listMetasWithStats()
                .find((item) => item.id === song.id) ?? song;
            return c.json(
                {
                    song: meta,
                    source: { kind: "upload", fileName: name },
                    elapsedMs: result.elapsedMs,
                },
                201
            );
        } catch (error) {
            return mapError(c, error);
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    });

    return app;
}
