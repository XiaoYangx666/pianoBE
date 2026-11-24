import { Hono } from "hono";
import { packLibraryAsPlugin } from "@piano/assembly";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";

export function librariesRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);
    const writeRole = () => requireRole("write");

    app.get("/", readRole(), (c) => {
        return c.json({
            items: deps.songPort.listLibraries(),
            catalogVersion: deps.songPort.getCatalogVersion(),
        });
    });

    app.post("/", writeRole(), async (c) => {
        const body = await c.req.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) return c.json({ error: "曲库名称不能为空" }, 400);
        try {
            const lib = deps.songPort.createLibrary({
                id: typeof body?.id === "string" ? body.id : undefined,
                name,
                description: typeof body?.description === "string" ? body.description : undefined,
                kind: "user",
                songIds: Array.isArray(body?.songIds) ? body.songIds : undefined,
            });
            return c.json(lib, 201);
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });

    app.patch("/:id", writeRole(), async (c) => {
        const id = c.req.param("id") ?? "";
        const existing = deps.songPort.getLibrary(id);
        if (!existing) return c.json({ error: "曲库不存在" }, 404);
        if (existing.readonly) return c.json({ error: "插件曲库只读，不可修改" }, 403);
        const body = await c.req.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) return c.json({ error: "曲库名称不能为空" }, 400);
        const updated = deps.songPort.renameLibrary(
            id,
            name,
            typeof body?.description === "string" ? body.description : undefined,
        );
        return c.json(updated);
    });

    app.delete("/:id", writeRole(), (c) => {
        const id = c.req.param("id") ?? "";
        if (id === "default") return c.json({ error: "默认曲库不可删除" }, 403);
        const existing = deps.songPort.getLibrary(id);
        if (!existing) return c.json({ error: "曲库不存在" }, 404);
        if (existing.readonly) return c.json({ error: "插件曲库请通过卸载插件移除" }, 403);
        deps.songPort.deleteLibrary(id);
        return c.body(null, 204);
    });

    app.post("/:id/songs", writeRole(), async (c) => {
        const id = c.req.param("id") ?? "";
        const existing = deps.songPort.getLibrary(id);
        if (!existing) return c.json({ error: "曲库不存在" }, 404);
        if (existing.readonly) return c.json({ error: "插件曲库只读，不可添加歌曲" }, 403);
        const body = await c.req.json().catch(() => null);
        const songIds = Array.isArray(body?.songIds)
            ? body.songIds.filter((item: unknown): item is string => typeof item === "string")
            : [];
        const added = deps.songPort.addSongsToLibrary(id, songIds);
        return c.json({ added, library: deps.songPort.getLibrary(id) });
    });

    app.delete("/:id/songs/:songId", writeRole(), (c) => {
        const id = c.req.param("id") ?? "";
        const songId = c.req.param("songId") ?? "";
        const existing = deps.songPort.getLibrary(id);
        if (!existing) return c.json({ error: "曲库不存在" }, 404);
        if (existing.readonly) return c.json({ error: "插件曲库只读，不可移除歌曲" }, 403);
        deps.songPort.removeSongFromLibrary(id, songId);
        return c.body(null, 204);
    });

    app.delete("/:id/songs", writeRole(), (c) => {
        const id = c.req.param("id") ?? "";
        const existing = deps.songPort.getLibrary(id);
        if (!existing) return c.json({ error: "曲库不存在" }, 404);
        if (existing.readonly) return c.json({ error: "插件曲库只读，不可清空曲库" }, 403);
        deps.songPort.clearLibrary(id);
        return c.body(null, 204);
    });

    app.get("/:id/export-plugin", readRole(), (c) => {
        const id = c.req.param("id") ?? "";
        const lib = deps.songPort.getLibrary(id);
        if (!lib) return c.json({ error: "曲库不存在" }, 404);
        const songs = lib.songIds
            .map((songId) => {
                const meta = deps.songPort.getMeta(songId);
                const bytes = deps.songPort.getPbe3(songId);
                if (!meta || !bytes) return null;
                const perfs = deps.songPort
                    .listSongPerformances(songId, true)
                    .filter((p) => p.cues?.length)
                    .map((p) => ({
                        id: p.id,
                        name: p.name,
                        author: p.author,
                        description: p.description,
                        cues: p.cues!,
                    }));
                return { id: meta.id, name: meta.name, bytes, performances: perfs };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

        const { bytes, manifest } = packLibraryAsPlugin({
            name: lib.name,
            description: lib.description,
            songs,
        });
        const fileName = encodeURIComponent(`${manifest.id}.pbeplugin`);
        return new Response(Uint8Array.from(bytes), {
            status: 200,
            headers: {
                "content-type": "application/octet-stream",
                "content-disposition": `attachment; filename*=UTF-8''${fileName}`,
            },
        });
    });

    return app;
}
