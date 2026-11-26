import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import type { SqliteSongPort } from "./drivers/sqlitePorts.js";
import type { ServerConfig } from "./config.js";
import { NOOP_LOGGER, type Logger } from "./logger.js";
import {
    authMiddleware,
    getTokenInfo,
    requireRole,
    sha256Hex,
    type AppVariables,
} from "./auth.js";
import { loginPageResponse } from "./loginPage.js";
import { songsRoutes } from "./routes/songs.js";
import { tokensRoutes } from "./routes/tokens.js";
import { transcribeRoutes } from "./routes/transcribe.js";
import { librariesRoutes } from "./routes/libraries.js";
import { pluginsRoutes } from "./routes/plugins.js";
import { addonRoutes } from "./routes/addon.js";
import type { AmtService } from "./services/amt.js";
import { AmtInstaller } from "./services/amtInstaller.js";
import { TranscribeJobStore } from "./services/transcribeJobs.js";
import { PluginService } from "./services/plugins.js";
import { DeploymentService } from "./services/deployment.js";

/** 静态资源会话 Cookie：值存令牌的 SHA-256，不存明文令牌。 */
const STUDIO_SESSION_COOKIE = "pianobe_studio";
const STUDIO_SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const SESSION_HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface AppDeps {
    db: Database;
    songPort: SqliteSongPort;
    config: ServerConfig;
    /** AMT 转录服务；未配置时相关接口返回 503 */
    amt?: AmtService;
    /** AMT 组件在线安装器；不传且存在 amt 时自动创建 */
    amtInstaller?: AmtInstaller;
    /** 转录任务管理器；不传时由 createApp 创建（调用方需要生命周期控制时应显式传入） */
    transcribeJobs?: TranscribeJobStore;
    pluginService?: PluginService;
    deploymentService?: DeploymentService;
    /** 文件/控制台日志；测试未传时静默 */
    logger?: Logger;
}

export function createApp(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const log = deps.logger ?? NOOP_LOGGER;
    const httpLog = log.scope("http");

    const sessionStmt = deps.db.prepare(`SELECT id FROM tokens WHERE token_hash=? AND revoked=0`);
    const bearerOf = (c: Context<{ Variables: AppVariables }>): string => {
        const raw = c.req.header("authorization") ?? "";
        return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
    };
    /** 静态资源（含 Studio 前端文件）的访问凭证：会话 Cookie 或 Bearer 令牌。 */
    const hasStaticAccess = (c: Context<{ Variables: AppVariables }>): boolean => {
        const session = getCookie(c, STUDIO_SESSION_COOKIE);
        if (session && SESSION_HASH_PATTERN.test(session) && sessionStmt.get(session)) return true;
        const token = bearerOf(c);
        return Boolean(token && getTokenInfo(deps.db, token));
    };

    // 请求 ID + 访问日志：一条一行，带耗时；静态资源成功请求不落盘
    app.use("*", async (c, next) => {
        const incoming = c.req.header("x-request-id")?.trim();
        const requestId =
            incoming && /^[A-Za-z0-9._:-]{1,64}$/.test(incoming)
                ? incoming
                : randomUUID().slice(0, 12);
        c.set("requestId", requestId);

        const start = Date.now();
        await next();
        // 响应已产生后再写头：静态文件/登录页返回的是原始 Response，
        // 在 next() 之前设置的 header 不会合并进去。
        c.header("x-request-id", requestId);
        // 上传的曲目/插件归档都走同源下载，禁止浏览器按内容嗅探成 HTML
        c.header("X-Content-Type-Options", "nosniff");
        // 入口 HTML 每次回源，避免部署后仍拿旧页面
        if ((c.res.headers.get("content-type") ?? "").startsWith("text/html")) {
            c.header("Cache-Control", "no-cache");
        }
        // 健康检查每 30 秒一次，成功请求降到 debug，避免把真正的问题冲掉
        if (c.req.path === "/api/health" && c.res.status < 400) {
            httpLog.debug(`${c.req.method} ${c.req.path} ${c.res.status}`, { req: requestId });
            return;
        }
        const token = c.get("token");
        httpLog.http(c.req.method, c.req.path, c.res.status, Date.now() - start, {
            req: requestId,
            auth: token ? `${token.role}#${token.id}` : undefined,
        });
    });

    const pluginService = deps.pluginService ?? new PluginService(deps.songPort, deps.config, deps.logger?.scope("plugins"));
    const deploymentService = deps.deploymentService ?? new DeploymentService(deps.songPort, pluginService, deps.config);
    const transcribeJobs =
        deps.transcribeJobs ??
        new TranscribeJobStore({
            songPort: deps.songPort,
            config: deps.config,
            amt: deps.amt,
            logger: deps.logger?.scope("transcribe"),
        });
    const amtInstaller =
        deps.amtInstaller ??
        (deps.amt
            ? new AmtInstaller({
                  config: deps.config,
                  amt: deps.amt,
                  logger: deps.logger?.scope("amt"),
              })
            : undefined);
    const readRole = () => requireRole("user", deps.config.allowPublicRead);

    // 解析令牌（仅挂上下文，不拦截；角色门槛由具体路由决定）
    app.use("/api/*", async (c, next) => {
        c.set("db", deps.db);
        await authMiddleware(c, next);
    });

    // 会话：把 Bearer 令牌换成静态资源用的 HttpOnly Cookie（值只存令牌哈希）。
    // 前端文件、模板、插件与采样都需要它；API 本身仍只认 Bearer。
    app.post("/api/session", (c) => {
        const token = bearerOf(c);
        const info = token ? getTokenInfo(deps.db, token) : undefined;
        if (!info) return c.json({ error: "令牌无效" }, 401);
        const forwarded = (c.req.header("x-forwarded-proto") ?? "").split(",")[0]?.trim();
        const secure = forwarded === "https" || new URL(c.req.url).protocol === "https:";
        setCookie(c, STUDIO_SESSION_COOKIE, sha256Hex(token), {
            httpOnly: true,
            sameSite: "Lax",
            path: "/",
            maxAge: STUDIO_SESSION_MAX_AGE,
            ...(secure ? { secure: true } : {}),
        });
        return c.json({ ok: true, role: info.role, label: info.label });
    });

    app.delete("/api/session", (c) => {
        deleteCookie(c, STUDIO_SESSION_COOKIE, { path: "/" });
        return c.body(null, 204);
    });

    const api = new Hono<{ Variables: AppVariables }>();
    api.route("/songs", songsRoutes(deps));
    api.route("/libraries", librariesRoutes(deps));
    api.route("/plugins", pluginsRoutes(deps, pluginService, deploymentService));
    api.route("/addon", addonRoutes(deps, deploymentService));
    api.route("/tokens", tokensRoutes(deps));
    api.route("/transcribe", transcribeRoutes({ ...deps, amtInstaller }, transcribeJobs));

    api.get("/performances/:perfId", readRole(), (c) => {
        const perf = deps.songPort.getPerformance(c.req.param("perfId") ?? "");
        if (!perf) return c.json({ error: "演出不存在" }, 404);
        return c.json(perf);
    });

    api.delete("/performances/:perfId", requireRole("admin"), (c) => {
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

    api.get("/health", (c) => {
        try {
            deps.db.query("SELECT 1").get();
        } catch {
            return c.json({ ok: false, name: "pianobe-server", error: "数据库不可用" }, 503);
        }
        return c.json({ ok: true, name: "pianobe-server", studio: true });
    });
    app.route("/api", api);

    // 未捕获的请求异常：记录堆栈后返回 JSON，而不是裸 500 文本
    app.onError((err, c) => {
        const requestId = c.get("requestId");
        httpLog.error(`${c.req.method} ${c.req.path} 处理异常`, err, { req: requestId });
        return c.json({ error: "服务器内部错误", requestId }, 500);
    });

    // 未匹配的 /api 路由必须返回 JSON 404，不能被 SPA 回退成 index.html
    app.notFound((c) => {
        if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
            return c.json({ error: "接口不存在" }, 404);
        }
        return c.text("Not Found", 404);
    });

    // 静态托管 Studio / Web 构建产物（SPA fallback 到 index.html）
    const webRoot = deps.config.webRoot;
    if (webRoot && existsSync(webRoot)) {
        // 所有静态文件（Studio 前端 bundle、模板、插件、采样）都要求令牌：
        // 未登录只返回内联登录页，公网无凭证拿不到任何前端文件。
        app.use("*", async (c, next) => {
            if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return next();
            if (hasStaticAccess(c)) return next();
            const accept = c.req.header("accept") ?? "";
            if ((c.req.method === "GET" || c.req.method === "HEAD") && accept.includes("text/html")) {
                return loginPageResponse();
            }
            return c.text("Unauthorized：需要访问令牌", 401);
        });
        // Vite 产物文件名带内容哈希，可以长期缓存；采样文件按天缓存
        app.use("/assets/*", async (c, next) => {
            await next();
            if (c.res.status === 200) {
                c.header("Cache-Control", "public, max-age=31536000, immutable");
            }
        });
        app.use("/piano/*", async (c, next) => {
            await next();
            if (c.res.status === 200) {
                c.header("Cache-Control", "public, max-age=86400");
            }
        });
        app.use(
            "*",
            serveStatic({
                root: webRoot,
                mimes: { ogg: "audio/ogg", wasm: "application/wasm", onnx: "application/octet-stream" },
            }),
        );
        app.get("*", async (c) => {
            if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
                return c.json({ error: "接口不存在" }, 404);
            }
            const file = Bun.file(join(webRoot, "index.html"));
            if (await file.exists()) {
                return new Response(await file.text(), {
                    headers: {
                        "content-type": "text/html; charset=utf-8",
                        "cache-control": "no-cache",
                    },
                });
            }
            return c.text("PianoBE", 404);
        });
    }

    return app;
}
