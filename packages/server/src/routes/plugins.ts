import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";
import { SongConflictError } from "../drivers/sqlitePorts.js";
import { PluginConflictError, type PluginService } from "../services/plugins.js";
import type { DeploymentService } from "../services/deployment.js";

const MAX_PLUGIN_BYTES = 64 * 1024 * 1024;

export function pluginsRoutes(
    deps: AppDeps,
    pluginService: PluginService,
    deploymentService: DeploymentService,
): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);
    const adminRole = () => requireRole("admin");

    app.get("/", readRole(), (c) => {
        const status = deploymentService.getStatus();
        return c.json({
            items: pluginService.listCatalog(status.deployedPlugins, status.loadedPlugins),
            deployment: status,
        });
    });

    app.post("/", adminRole(), async (c) => {
        const contentType = c.req.header("Content-Type") ?? "";
        if (contentType.includes("application/json")) {
            const body = await c.req.json().catch(() => null);
            const builtinId = typeof body?.builtinId === "string" ? body.builtinId.trim() : "";
            if (!builtinId) return c.json({ error: "请提供 builtinId 或上传 .pbeplugin 文件" }, 400);
            try {
                const record = pluginService.installBuiltin(builtinId);
                return c.json(record, 201);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return c.json({ error: message }, error instanceof SongConflictError ? 409 : 400);
            }
        }

        const length = Number(c.req.header("Content-Length") ?? 0);
        if (length > MAX_PLUGIN_BYTES) {
            return c.json({ error: "插件包超过大小限制" }, 413);
        }
        const buf = await c.req.arrayBuffer();
        if (!buf || buf.byteLength === 0) {
            return c.json({ error: "插件文件为空" }, 400);
        }
        try {
            const record = pluginService.installPluginBytes(new Uint8Array(buf), "upload");
            return c.json(record, 201);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const status = error instanceof SongConflictError || error instanceof PluginConflictError ? 409 : 400;
            return c.json({ error: message }, status);
        }
    });

    app.post("/:id/trust", adminRole(), (c) => {
        try {
            const record = pluginService.trustPlugin(c.req.param("id") ?? "");
            return c.json(record);
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
        }
    });

    app.patch("/:id", adminRole(), async (c) => {
        const body = await c.req.json().catch(() => null);
        if (typeof body?.enabled !== "boolean") {
            return c.json({ error: "请提供 enabled 布尔值" }, 400);
        }
        try {
            const record = pluginService.setPluginEnabled(c.req.param("id") ?? "", body.enabled);
            return c.json(record);
        } catch (error) {
            const status = error instanceof PluginConflictError ? 409 : 400;
            return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
        }
    });

    app.delete("/:id", adminRole(), (c) => {
        try {
            pluginService.uninstallPlugin(c.req.param("id") ?? "");
            return c.body(null, 204);
        } catch (error) {
            const status = error instanceof PluginConflictError ? 409 : 404;
            return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
        }
    });

    return app;
}
