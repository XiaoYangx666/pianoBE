import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { createToken, listTokens, requireRole, revokeToken, type AppVariables, type Role } from "../auth.js";

const ROLES: Role[] = ["read", "write", "admin"];

export function tokensRoutes(deps: AppDeps): Hono<{ Variables: AppVariables }> {
    const app = new Hono<{ Variables: AppVariables }>();
    const admin = () => requireRole("admin");

    // GET /api/tokens —— 令牌列表（不含哈希与明文）
    app.get("/", admin(), (c) => {
        return c.json({ items: listTokens(deps.db) });
    });

    // POST /api/tokens {label, role} —— 创建令牌，明文仅返回一次
    app.post("/", admin(), async (c) => {
        const body = await c.req.json().catch(() => null);
        const label = (body?.label ?? "").toString().trim();
        const role = (body?.role ?? "").toString() as Role;
        if (!label || label.length > 32) {
            return c.json({ error: "label 必填且不超过 32 字符" }, 400);
        }
        if (!ROLES.includes(role)) {
            return c.json({ error: "role 需为 read/write/admin 之一" }, 400);
        }
        try {
            const { id, token } = createToken(deps.db, label, role);
            return c.json({ id, label, role, token }, 201);
        } catch {
            return c.json({ error: "label 已存在" }, 409);
        }
    });

    // DELETE /api/tokens/:id —— 吊销
    app.delete("/:id", admin(), (c) => {
        const id = Number(c.req.param("id") ?? "");
        if (!revokeToken(deps.db, id)) {
            return c.json({ error: "令牌不存在或已吊销" }, 404);
        }
        return c.body(null, 204);
    });

    return app;
}