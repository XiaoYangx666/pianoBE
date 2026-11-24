import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { requireRole, type AppVariables } from "../auth.js";
import type { DeploymentService } from "../services/deployment.js";

export function addonRoutes(
    deps: AppDeps,
    deploymentService: DeploymentService,
): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const readRole = () => requireRole("read", deps.config.allowPublicRead);
    const adminRole = () => requireRole("admin");

    app.get("/status", readRole(), (c) => {
        return c.json(deploymentService.getStatus());
    });

    app.put("/config", adminRole(), async (c) => {
        const body = await c.req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return c.json({ error: "配置格式无效" }, 400);
        }
        const config = deploymentService.updateBdsConfig({
            bdsDir: typeof body.bdsDir === "string" ? body.bdsDir : undefined,
            bdsWorld: typeof body.bdsWorld === "string" ? body.bdsWorld : undefined,
            bdsBpName: typeof body.bdsBpName === "string" ? body.bdsBpName : undefined,
            bdsRpName: typeof body.bdsRpName === "string" ? body.bdsRpName : undefined,
        });
        return c.json({ bdsConfig: config, status: deploymentService.getStatus() });
    });

    app.post("/template", adminRole(), async (c) => {
        const buf = await c.req.arrayBuffer();
        if (!buf || buf.byteLength === 0) {
            return c.json({ error: "模板文件为空" }, 400);
        }
        deploymentService.saveServerTemplate(new Uint8Array(buf));
        return c.json(deploymentService.getStatus());
    });

    app.post("/deploy", adminRole(), async (c) => {
        try {
            const status = await deploymentService.deployToBds();
            return c.json(status);
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });

    app.get("/download", adminRole(), async (c) => {
        try {
            const bytes = await deploymentService.buildDownloadBytes();
            return new Response(Uint8Array.from(bytes), {
                status: 200,
                headers: {
                    "content-type": "application/octet-stream",
                    "content-disposition": 'attachment; filename="pianobe-server.mcaddon"',
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
        return c.json(deploymentService.reportLoaded({ configHash, installedPlugins }));
    });

    return app;
}
