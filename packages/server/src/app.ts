import { Hono } from "hono";
import { logger } from "hono/logger";
import { existsSync } from "node:fs";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import type { SqliteSongPort } from "./drivers/sqlitePorts.js";
import type { ServerConfig } from "./config.js";
import { authMiddleware, requireRole, type AppVariables } from "./auth.js";
import { songsRoutes } from "./routes/songs.js";
import { tokensRoutes } from "./routes/tokens.js";
import { transcribeRoutes } from "./routes/transcribe.js";
import { librariesRoutes } from "./routes/libraries.js";
import { pluginsRoutes } from "./routes/plugins.js";
import { addonRoutes } from "./routes/addon.js";
import type { AmtService } from "./services/amt.js";
import { PluginService } from "./services/plugins.js";
import { DeploymentService } from "./services/deployment.js";

export interface AppDeps {
    db: Database;
    songPort: SqliteSongPort;
    config: ServerConfig;
    /** AMT 转录服务；未配置时相关接口返回 503 */
    amt?: AmtService;
    pluginService?: PluginService;
    deploymentService?: DeploymentService;
}

export function createApp(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", logger());

    const pluginService = deps.pluginService ?? new PluginService(deps.songPort, deps.config);
    const deploymentService = deps.deploymentService ?? new DeploymentService(deps.songPort, pluginService, deps.config);
    const readRole = () => requireRole("read", deps.config.allowPublicRead);

    // 解析令牌（仅挂上下文，不拦截；角色门槛由具体路由决定）
    app.use("/api/*", async (c, next) => {
        c.set("db", deps.db);
        await authMiddleware(c, next);
    });

    const api = new Hono<{ Variables: AppVariables }>();
    api.route("/songs", songsRoutes(deps));
    api.route("/libraries", librariesRoutes(deps));
    api.route("/plugins", pluginsRoutes(deps, pluginService, deploymentService));
    api.route("/addon", addonRoutes(deps, deploymentService));
    api.route("/tokens", tokensRoutes(deps));
    api.route("/transcribe", transcribeRoutes(deps));

    api.get("/performances/:perfId", readRole(), (c) => {
        const perf = deps.songPort.getPerformance(c.req.param("perfId") ?? "");
        if (!perf) return c.json({ error: "演出不存在" }, 404);
        return c.json(perf);
    });

    api.delete("/performances/:perfId", requireRole("write"), (c) => {
        const removed = deps.songPort.deletePerformance(c.req.param("perfId") ?? "");
        if (!removed) return c.json({ error: "演出不存在" }, 404);
        return c.body(null, 204);
    });

    api.get("/catalog/version", readRole(), (c) => {
        const status = deploymentService.getStatus();
        return c.json({
            version: deps.songPort.getCatalogVersion(),
            deployedConfigHash: status.deployedConfigHash ?? null,
            loadedConfigHash: status.loadedConfigHash ?? null,
        });
    });

    api.get("/health", (c) => c.json({ ok: true, name: "pianobe-server", studio: true }));
    app.route("/api", api);

    // 静态托管 Studio / Web 构建产物（SPA fallback 到 index.html）
    if (deps.config.webRoot && existsSync(deps.config.webRoot)) {
        app.use(
            "*",
            serveStatic({
                root: deps.config.webRoot,
                mimes: { ogg: "audio/ogg", wasm: "application/wasm", onnx: "application/octet-stream" },
            }),
        );
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
