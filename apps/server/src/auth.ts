import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Context, Next } from "hono";

export type Role = "read" | "write" | "admin";

export interface TokenInfo {
    id: number;
    label: string;
    role: Role;
}

const ROLE_LEVEL: Record<Role, number> = { read: 1, write: 2, admin: 3 };

export function sha256Hex(s: string): string {
    return createHash("sha256").update(s).digest("hex");
}

/** 生成高熵明文令牌（64 hex 字符） */
export function newToken(): string {
    return randomBytes(32).toString("hex");
}

interface TokenRow {
    id: number;
    label: string;
    token_hash: string;
    role: Role;
    revoked: number;
}

export function getTokenInfo(db: Database, token: string): TokenInfo | undefined {
    const r = db
        .prepare(`SELECT id,label,role FROM tokens WHERE token_hash=? AND revoked=0`)
        .get(sha256Hex(token)) as Pick<TokenRow, "id" | "label" | "role"> | null;
    return r ?? undefined;
}

/** 创建令牌，返回明文（仅此一次可见） */
export function createToken(
    db: Database,
    label: string,
    role: Role
): { id: number; token: string } {
    const token = newToken();
    const info = db
        .prepare(
            `INSERT INTO tokens(label,token_hash,role,created_at) VALUES(?,?,?,?)`
        )
        .run(label, sha256Hex(token), role, Date.now());
    return { id: Number(info.lastInsertRowid), token };
}

export function listTokens(db: Database) {
    return db
        .prepare(`SELECT id,label,role,created_at,revoked FROM tokens ORDER BY id`)
        .all() as Omit<TokenRow, "token_hash">[];
}

export function revokeToken(db: Database, id: number): boolean {
    const r = db.prepare(`UPDATE tokens SET revoked=1 WHERE id=? AND revoked=0`).run(id);
    return r.changes > 0;
}

/**
 * 确保 bootstrap 管理员令牌存在：
 * - 配置了 BOOTSTRAP_TOKEN → upsert（可随时重置管理员钥匙）
 * - 未配置且尚无 bootstrap → 自动生成并返回明文（打印到日志）
 */
export function ensureBootstrapToken(
    db: Database,
    envToken?: string
): { token?: string; generated?: string } {
    const existing = db
        .prepare(`SELECT id FROM tokens WHERE label='bootstrap'`)
        .get() as Pick<TokenRow, "id"> | null;

    if (envToken) {
        db.prepare(
            `INSERT INTO tokens(label,token_hash,role,created_at,revoked) VALUES('bootstrap',?, 'admin', ?, 0)
             ON CONFLICT(label) DO UPDATE SET token_hash=excluded.token_hash, role='admin', revoked=0`
        ).run(sha256Hex(envToken), Date.now());
        return { token: envToken };
    }

    if (!existing) {
        const { token } = createToken(db, "bootstrap", "admin");
        return { generated: token };
    }
    return {};
}

/* ================== Hono 中间件 ================== */

/** Hono 上下文变量（app/routes 共用） */
export interface AppVariables {
    db: Database;
    token?: TokenInfo;
}

export function getToken(c: Context<{ Variables: AppVariables }>): TokenInfo | undefined {
    return c.get("token");
}

/** 解析 Authorization: Bearer，挂到上下文（不拦截） */
export async function authMiddleware(c: Context<{ Variables: AppVariables }>, next: Next) {
    const header = c.req.header("Authorization") ?? "";
    let tokenInfo: TokenInfo | undefined;
    if (header.startsWith("Bearer ")) {
        tokenInfo = getTokenInfo(c.get("db"), header.slice(7).trim());
    }
    c.set("token", tokenInfo);
    await next();
}

/** 角色门槛：至少 require 级别；allowPublic 时公开接口放行未登录 */
export function requireRole(require: Role, allowPublic = false) {
    return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
        const token = getToken(c);
        if (!token) {
            if (allowPublic) return next();
            return c.json({ error: "缺少有效令牌" }, 401);
        }
        if (ROLE_LEVEL[token.role] < ROLE_LEVEL[require]) {
            return c.json({ error: "令牌权限不足" }, 403);
        }
        return next();
    };
}