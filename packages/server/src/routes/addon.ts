import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";
import type { DeploymentService } from "../services/deployment.js";

export function addonRoutes(
    deps: AppDeps,
    deploymentService: DeploymentService,
): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("user", deps.config.allowPublicRead);
    const adminRole = () => requireRole("admin");

    app.get("/status", readRole(), (c) => {
        return c.json(deploymentService.getStatus());
    });

    app.put("/config", adminRole(), async (c) => {
        const body = await c.req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return c.json({ error: "配置格式无效" }, 400);
        }
        try {
            const config = deploymentService.updateBdsConfig({
                bdsDir: typeof body.bdsDir === "string" ? body.bdsDir : undefined,
                bdsWorld: typeof body.bdsWorld === "string" ? body.bdsWorld : undefined,
                bdsBpName: typeof body.bdsBpName === "string" ? body.bdsBpName : undefined,
                bdsRpName: typeof body.bdsRpName === "string" ? body.bdsRpName : undefined,
                bdsPackMode: body.bdsPackMode === "release" || body.bdsPackMode === "development"
                    ? body.bdsPackMode
                    : undefined,
                packName: typeof body.packName === "string" ? body.packName : undefined,
                packDescription: typeof body.packDescription === "string" ? body.packDescription : undefined,
            });
            deps.logger?.scope("deploy").info("BDS 部署配置已更新", {
                req: c.get("requestId"),
                dir: config.bdsDir,
                world: config.bdsWorld,
                mode: config.bdsPackMode,
            });
            return c.json({ bdsConfig: config, status: deploymentService.getStatus() });
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });

    app.get("/scores", readRole(), (c) => {
        return c.json({ items: deploymentService.listScores() });
    });

    app.post("/scores", adminRole(), async (c) => {
        const body = await c.req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return c.json({ error: "曲谱数据格式无效" }, 400);
        }
        try {
            const items = deploymentService.addScore({
                id: typeof body.id === "string" ? body.id : "",
                title: typeof body.title === "string" ? body.title : "",
                pages: Array.isArray(body.pages)
                    ? body.pages.filter((p: unknown): p is string => typeof p === "string")
                    : [],
                pageCount: typeof body.pageCount === "number" ? body.pageCount : undefined,
                assets: body.assets && typeof body.assets === "object"
                    ? (body.assets as Record<string, string>)
                    : {},
            });
            return c.json({ items, status: deploymentService.getStatus() }, 201);
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });

    app.delete("/scores/:id", adminRole(), (c) => {
        const items = deploymentService.removeScore(c.req.param("id") ?? "");
        return c.json({ items, status: deploymentService.getStatus() });
    });

    app.get("/scores/asset/*", readRole(), (c) => {
        const rel = c.req.path.replace(/^.*\/scores\/asset\//, "");
        const bytes = deploymentService.getScoreAsset(decodeURIComponent(rel));
        if (!bytes) return c.json({ error: "曲谱资源不存在" }, 404);
        return new Response(Uint8Array.from(bytes), {
            status: 200,
            headers: { "content-type": "image/png" },
        });
    });

    app.post("/template", adminRole(), async (c) => {
        const buf = await c.req.arrayBuffer();
        if (!buf || buf.byteLength === 0) {
            return c.json({ error: "模板文件为空" }, 400);
        }
        deploymentService.saveServerTemplate(new Uint8Array(buf));
        deps.logger?.scope("deploy").info("服务器模板已更新", {
            req: c.get("requestId"),
            bytes: buf.byteLength,
        });
        return c.json(deploymentService.getStatus());
    });

    app.post("/deploy", adminRole(), async (c) => {
        const log = deps.logger?.scope("deploy");
        try {
            const status = await deploymentService.deployToBds();
            log?.info("BDS 部署完成", {
                req: c.get("requestId"),
                status: status.status,
                configHash: status.deployedConfigHash,
                issues: status.issues.length,
                warnings: status.warnings.length,
            });
            return c.json(status);
        } catch (error) {
            log?.error("BDS 部署失败", error, { req: c.get("requestId") });
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });

    app.get("/download", adminRole(), async (c) => {
        try {
            const bytes = await deploymentService.buildDownloadBytes();
            const fileName = deploymentService.getDownloadFileName();
            return new Response(Uint8Array.from(bytes), {
                status: 200,
                headers: {
                    "content-type": "application/octet-stream",
                    "content-disposition": `attachment; filename="pianobe-server.mcaddon"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
                },
            });
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });

    // BDS 行为包启动后上报实际加载的部署哈希与插件清单
    app.post("/loaded", readRole(), async (c) => {
        const body = await c.req.json().catch(() => null);
        const configHash = typeof body?.configHash === "string" ? body.configHash : undefined;
        const installedPlugins = Array.isArray(body?.installedPlugins)
            ? body.installedPlugins.filter((item: unknown): item is string => typeof item === "string")
            : undefined;
        const result = deploymentService.reportLoaded({ configHash, installedPlugins });
        deps.logger?.scope("deploy").info("BDS 已上报加载状态", {
            req: c.get("requestId"),
            configHash,
            plugins: installedPlugins?.length,
            status: result.status,
        });
        return c.json(result);
    });

    return app;
}
