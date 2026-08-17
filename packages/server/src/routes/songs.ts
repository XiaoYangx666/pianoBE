import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function songsRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);

    // GET /api/songs?q=&page=&pageSize=
    app.get("/", readRole(), (c) => {
        const q = c.req.query("q")?.trim() ?? "";
        const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50) || 50));

        let metas = deps.songPort.listMetasWithStats();
        if (q) {
            const lower = q.toLowerCase();
            metas = metas.filter((m) => m.name.toLowerCase().includes(lower));
        }
        const total = metas.length;
        const items = metas.slice((page - 1) * pageSize, page * pageSize);
        return c.json({ items, total, page, pageSize });
    });

    // GET /api/songs/:id/raw —— 原始 .mid 字节（前端直接解析播放）
    app.get("/:id/raw", readRole(), (c) => {
        const raw = deps.songPort.getRaw(c.req.param("id") ?? "");
        if (!raw) return c.json({ error: "曲目内容不存在" }, 404);
        return c.body(raw, 200, { "content-type": "audio/midi" });
    });

    // GET /api/songs/:id —— 完整曲目 JSON（server-net 拉取用，按需从 .mid 转换）
    app.get("/:id", readRole(), (c) => {
        const song = deps.songPort.getSong(c.req.param("id") ?? "");
        if (!song) return c.json({ error: "曲目不存在" }, 404);
        return c.json(song);
    });

    // POST /api/songs —— 上传 .mid（原始字节存 data/midis/{id}.mid；文件名走 X-File-Name 头）
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
        const name = fileName.replace(/\.midi?$/i, "") || undefined;

        let meta;
        try {
            meta = deps.songPort.saveMidiFile(new Uint8Array(buffer), name ?? "");
        } catch {
            return c.json({ error: "无法解析 MIDI 文件" }, 400);
        }

        return c.json(meta, 201);
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