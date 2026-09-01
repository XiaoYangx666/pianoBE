import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { getToken, requireRole, type AppVariables } from "../auth.js";
import type { TokenInfo } from "../auth.js";
import type { PlaylistMeta } from "@piano/core";

const MAX_ITEMS = 1000;

function canManage(token: TokenInfo | undefined, meta: PlaylistMeta): boolean {
    return !!token && (token.role === "admin" || meta.owner === token.label);
}

export function playlistsRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);

    // GET /api/playlists?owner=&public=1
    app.get("/", readRole(), (c) => {
        const owner = c.req.query("owner");
        const onlyPublic = c.req.query("public") === "1";
        let metas;
        if (onlyPublic) {
            metas = deps.playlistStore.getPublicMetas();
        } else if (owner) {
            metas = deps.playlistStore.getMetasByOwner(owner);
        } else {
            metas = deps.playlistStore.listAll();
        }
        return c.json({ items: metas, total: metas.length });
    });

    // GET /api/playlists/:id —— meta + items
    app.get("/:id", readRole(), (c) => {
        const id = Number(c.req.param("id") ?? "");
        if (!Number.isInteger(id)) return c.json({ error: "无效 id" }, 400);
        const meta = deps.playlistStore.getMeta(id);
        if (!meta) return c.json({ error: "列表不存在" }, 404);
        return c.json({ ...meta, items: deps.playlistStore.getContent(id) });
    });

    // POST /api/playlists {name, owner?}
    // owner 可选：游戏内以玩家临时 id（player.id，视为永久）作为拥有者；
    // 不传则默认令牌 label（网页管理页行为不变）。
    app.post("/", requireRole("write"), async (c) => {
        const token = getToken(c)!;
        const body = await c.req.json().catch(() => null);
        const name = (body?.name ?? "").toString().trim();
        if (name.length < 2 || name.length > 24) {
            return c.json({ error: "名称长度需在 2~24 之间" }, 400);
        }
        let owner = token.label;
        if (typeof body?.owner === "string") {
            const o = body.owner.trim().slice(0, 64);
            if (o) owner = o;
        }
        const meta = deps.playlistStore.create(owner, name);
        return c.json(meta, 201);
    });

    // PATCH /api/playlists/:id {name?, public?} —— 仅 owner/admin
    app.patch("/:id", requireRole("write"), async (c) => {
        const id = Number(c.req.param("id") ?? "");
        const meta = deps.playlistStore.getMeta(id);
        if (!meta) return c.json({ error: "列表不存在" }, 404);
        if (!canManage(getToken(c), meta)) return c.json({ error: "无权操作" }, 403);

        const body = await c.req.json().catch(() => null);
        const patch: Record<string, unknown> = {};
        if (body?.name !== undefined) {
            const name = body.name.toString().trim();
            if (name.length < 2 || name.length > 24) {
                return c.json({ error: "名称长度需在 2~24 之间" }, 400);
            }
            patch.name = name;
        }
        if (body?.public !== undefined) patch.public = !!body.public;
        if (Object.keys(patch).length === 0) return c.json({ error: "无有效字段" }, 400);

        const updated = deps.playlistStore.updateMeta(id, patch);
        return c.json(updated);
    });

    // PUT /api/playlists/:id/items {items: string[]} —— 仅 owner/admin，整体替换
    app.put("/:id/items", requireRole("write"), async (c) => {
        const id = Number(c.req.param("id") ?? "");
        const meta = deps.playlistStore.getMeta(id);
        if (!meta) return c.json({ error: "列表不存在" }, 404);
        if (!canManage(getToken(c), meta)) return c.json({ error: "无权操作" }, 403);

        const body = await c.req.json().catch(() => null);
        const items = body?.items;
        if (!Array.isArray(items) || items.length > MAX_ITEMS) {
            return c.json({ error: "items 需为数组且不超过 1000 项" }, 400);
        }
        for (const item of items) {
            if (typeof item !== "string") return c.json({ error: "items 元素必须为字符串" }, 400);
        }
        deps.playlistStore.setContent(id, items);
        return c.json({ items: deps.playlistStore.getContent(id) });
    });

    // POST /api/playlists/:id/play —— 播放计数（每令牌每日一次）
    app.post("/:id/play", readRole(), (c) => {
        const id = Number(c.req.param("id") ?? "");
        const meta = deps.playlistStore.getMeta(id);
        if (!meta) return c.json({ error: "列表不存在" }, 404);
        const playerId = getToken(c)?.label ?? "anonymous";
        deps.playlistStore.incPlayCount(id, playerId);
        return c.json({ playCount: deps.playlistStore.getMeta(id)?.playCount ?? 0 });
    });

    // DELETE /api/playlists/:id —— 仅 owner/admin
    app.delete("/:id", requireRole("write"), (c) => {
        const id = Number(c.req.param("id") ?? "");
        const meta = deps.playlistStore.getMeta(id);
        if (!meta) return c.json({ error: "列表不存在" }, 404);
        if (!canManage(getToken(c), meta)) return c.json({ error: "无权操作" }, 403);
        deps.playlistStore.delete(id);
        return c.body(null, 204);
    });

    return app;
}