import { Hono } from "hono";
import { logger } from "hono/logger";
import { existsSync } from "node:fs";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import type { PlaylistStore, SongStore } from "@piano/core";
import type { ServerConfig } from "./config.js";
import { authMiddleware, type AppVariables } from "./auth.js";
import { songsRoutes } from "./routes/songs.js";
import { playlistsRoutes } from "./routes/playlists.js";
import { tokensRoutes } from "./routes/tokens.js";

export interface AppDeps {
    db: Database;
    songStore: SongStore;
    playlistStore: PlaylistStore;
    config: ServerConfig;
}

export function createApp(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", logger());

    // 解析令牌（仅挂上下文，不拦截；角色门槛由具体路由决定）
    app.use("/api/*", async (c, next) => {
        c.set("db", deps.db);
        await authMiddleware(c, next);
    });

    const api = new Hono();
    api.route("/songs", songsRoutes(deps));
    api.route("/playlists", playlistsRoutes(deps));
    api.route("/tokens", tokensRoutes(deps));
    api.get("/health", (c) => c.json({ ok: true, name: "pianobe-server" }));
    app.route("/api", api);

    // 静态托管 web 构建产物（SPA fallback 到 index.html）
    if (deps.config.webRoot && existsSync(deps.config.webRoot)) {
        app.use("*", serveStatic({ root: deps.config.webRoot }));
        app.get("*", async (c) => {
            const file = Bun.file(`${deps.config.webRoot}/index.html`);
            if (await file.exists()) {
                return new Response(await file.text(), {
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }
            return c.text("PianoBE", 404);
        });
    }

    return app;
}