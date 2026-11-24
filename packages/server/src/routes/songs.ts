import { Hono } from "hono";
import { encodeBase64Url, PBE3_MAGIC, planImportChunks, type PerformanceCue } from "@piano/core";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";
import { SongConflictError } from "../drivers/sqlitePorts.js";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

function isPbe3Bytes(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 4 &&
        bytes[0] === PBE3_MAGIC[0] &&
        bytes[1] === PBE3_MAGIC[1] &&
        bytes[2] === PBE3_MAGIC[2] &&
        bytes[3] === PBE3_MAGIC[3]
    );
}

export function songsRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);

    // GET /api/songs?q=&page=&pageSize=&libraryId=
    app.get("/", readRole(), (c) => {
        const q = c.req.query("q")?.trim() ?? "";
        const libraryId = c.req.query("libraryId")?.trim() || undefined;
        const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50) || 50));

        const metas = deps.songPort.listMetasWithStats({ libraryId, q });
        const total = metas.length;
        const items = metas.slice((page - 1) * pageSize, page * pageSize);
        return c.json({
            items,
            total,
            page,
            pageSize,
            catalogVersion: deps.songPort.getCatalogVersion(),
        });
    });

    // GET /api/songs/:id/raw —— 原始 .mid 或 .pbe3 字节
    app.get("/:id/raw", readRole(), (c) => {
        const id = c.req.param("id") ?? "";
        const raw = deps.songPort.getRaw(id);
        if (raw) return c.body(raw, 200, { "content-type": "audio/midi" });
        const pbe3 = deps.songPort.getPbe3(id);
        if (pbe3) return c.body(Uint8Array.from(pbe3), 200, { "content-type": "application/octet-stream" });
        return c.json({ error: "曲目内容不存在" }, 404);
    });

    // GET /api/songs/:id/code —— 游戏内导入码（PBE3 分段）
    app.get("/:id/code", readRole(), (c) => {
        const id = c.req.param("id") ?? "";
        const pbe3 = deps.songPort.getPbe3(id);
        if (!pbe3) return c.json({ error: "曲目不存在" }, 404);
        const meta = deps.songPort.getMeta(id);
        return c.json({
            name: meta?.name ?? id,
            chunks: planImportChunks(pbe3),
            bytes: pbe3.byteLength,
        });
    });

    // GET /api/songs/:id/performances
    app.get("/:id/performances", readRole(), (c) => {
        const id = c.req.param("id") ?? "";
        if (!deps.songPort.has(id)) return c.json({ error: "曲目不存在" }, 404);
        return c.json({ items: deps.songPort.listSongPerformances(id, true) });
    });

    // POST /api/songs/:id/performances
    app.post("/:id/performances", requireRole("write"), async (c) => {
        const songId = c.req.param("id") ?? "";
        const meta = deps.songPort.getDetailedMeta(songId);
        if (!meta) return c.json({ error: "曲目不存在" }, 404);
        const body = await c.req.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const cues = Array.isArray(body?.cues) ? (body.cues as PerformanceCue[]) : null;
        if (!name || !cues?.length) {
            return c.json({ error: "演出名称与 cues 不能为空" }, 400);
        }
        const id =
            typeof body?.id === "string" && body.id.trim()
                ? body.id.trim()
                : `user:${songId}:${Date.now().toString(36)}`;
        try {
            const saved = deps.songPort.savePerformance({
                id,
                songId,
                musicFingerprint: meta.musicFingerprint,
                name,
                author: typeof body?.author === "string" ? body.author : undefined,
                description: typeof body?.description === "string" ? body.description : undefined,
                cues,
                origin: { kind: "user" },
            });
            return c.json(saved, 201);
        } catch (error) {
            const status = error instanceof SongConflictError ? 409 : 400;
            return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
        }
    });

    // GET /api/songs/:id —— 游戏播放器曲目（统一 PBE3，Base64URL 传输）
    app.get("/:id", readRole(), (c) => {
        const id = c.req.param("id") ?? "";
        const pbe3 = deps.songPort.getPbe3(id);
        if (!pbe3) return c.json({ error: "曲目不存在" }, 404);
        const meta = deps.songPort.getDetailedMeta(id);
        return c.json({
            id,
            name: meta?.name ?? id,
            duration: meta?.duration ?? 0,
            performanceEntries: meta?.performanceEntries ?? [],
            data: encodeBase64Url(pbe3),
        });
    });

    // POST /api/songs —— 上传 .mid 或 .pbe3
    app.post("/", requireRole("write"), async (c) => {
        const length = Number(c.req.header("Content-Length") ?? 0);
        if (length > MAX_UPLOAD_BYTES) {
            return c.json({ error: "文件超过大小限制" }, 413);
        }
        const buffer = await c.req.arrayBuffer();
        if (!buffer || buffer.byteLength === 0) {
            return c.json({ error: "空文件" }, 400);
        }

        let fileName = c.req.header("X-File-Name") ?? "";
        try {
            fileName = decodeURIComponent(fileName);
        } catch {}
        const libraryId = c.req.header("X-Library-Id")?.trim() || undefined;
        const bytes = new Uint8Array(buffer);

        try {
            if (isPbe3Bytes(bytes) || /\.pbe3$/i.test(fileName)) {
                const name = fileName ? fileName.replace(/\.pbe3$/i, "") : undefined;
                const meta = deps.songPort.savePbe3File(bytes, {
                    name,
                    libraryId,
                    origin: { kind: "user" },
                });
                return c.json(meta, 201);
            }

            const name = fileName.replace(/\.midi?$/i, "") || undefined;
            const meta = deps.songPort.saveMidiFile(bytes, name ?? "", {
                libraryId,
                origin: { kind: "user" },
            });
            return c.json(meta, 201);
        } catch (error) {
            if (error instanceof SongConflictError) {
                return c.json({ error: error.message }, 409);
            }
            return c.json({ error: "无法解析曲目文件" }, 400);
        }
    });

    // PATCH /api/songs/:id —— 改曲名 { name }
    app.patch("/:id", requireRole("write"), async (c) => {
        const id = c.req.param("id") ?? "";
        const body = await c.req.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) return c.json({ error: "曲名不能为空" }, 400);
        const meta = deps.songPort.rename(id, name);
        if (!meta) return c.json({ error: "曲目不存在" }, 404);
        return c.json(meta);
    });

    // DELETE /api/songs/:id
    app.delete("/:id", requireRole("write"), (c) => {
        deps.songPort.remove(c.req.param("id") ?? "");
        return c.body(null, 204);
    });

    return app;
}
