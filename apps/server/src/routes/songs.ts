import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";
import { midiBufferToSong } from "@piano/core/convert";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function songsRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);

    // GET /api/songs?q=&page=&pageSize=
    app.get("/", readRole(), (c) => {
        const q = c.req.query("q")?.trim() ?? "";
        const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50) || 50));

        let metas = deps.songStore.list();
        if (q) {
            const lower = q.toLowerCase();
            metas = metas.filter((m) => m.name.toLowerCase().includes(lower));
        }
        const total = metas.length;
        const items = metas.slice((page - 1) * pageSize, page * pageSize);
        return c.json({ items, total, page, pageSize });
    });

    // GET /api/songs/:id —— 完整曲目 JSON（server-net 拉取用）
    app.get("/:id", readRole(), (c) => {
        const song = deps.songStore.getSong(c.req.param("id") ?? "");
        if (!song) return c.json({ error: "曲目不存在" }, 404);
        return c.json(song);
    });

    // POST /api/songs —— 上传 .mid（原始字节；文件名走 X-File-Name 头）
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

        let song;
        try {
            song = midiBufferToSong(new Uint8Array(buffer), name ?? "");
        } catch {
            return c.json({ error: "无法解析 MIDI 文件" }, 400);
        }

        deps.songStore.add({ ...song, name: name ?? song.id });
        return c.json(deps.songStore.getMeta(song.id), 201);
    });

    // DELETE /api/songs/:id
    app.delete("/:id", requireRole("write"), (c) => {
        deps.songStore.remove(c.req.param("id") ?? "");
        return c.body(null, 204);
    });

    return app;
}