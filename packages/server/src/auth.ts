import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Context, Next } from "hono";

/**
 * 只有两种令牌：
 * - user：普通令牌，可读曲库、创建临时转录任务，不能修改曲库；
 * - admin：管理员令牌，可管理曲库、插件、部署与令牌。
 *
 * 旧库里的 read/write 在读取时统一按 user 处理（write 的曲库写权限不再保留）。
 */
export type Role = "user" | "admin";

export interface TokenInfo {
    id: number;
    label: string;
    role: Role;
}

function normalizeRole(raw: string): Role {
    return raw === "admin" ? "admin" : "user";
}

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
    role: string;
    revoked: number;
}

export function getTokenInfo(db: Database, token: string): TokenInfo | undefined {
    const r = db
        .prepare(`SELECT id,label,role FROM tokens WHERE token_hash=? AND revoked=0`)
        .get(sha256Hex(token)) as Pick<TokenRow, "id" | "label" | "role"> | null;
    return r ? { id: r.id, label: r.label, role: normalizeRole(r.role) } : undefined;
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
    const rows = db
        .prepare(`SELECT id,label,role,created_at,revoked FROM tokens ORDER BY id`)
        .all() as Array<Omit<TokenRow, "token_hash">>;
    return rows.map((row) => ({ ...row, role: normalizeRole(row.role) }));
}

/** 把旧库的 read/write 一次性迁移为 user；返回迁移数量。 */
export function migrateLegacyRoles(db: Database): number {
    const result = db.prepare(`UPDATE tokens SET role='user' WHERE role IN ('read','write')`).run();
    return result.changes;
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

/** 令牌门槛：user 只需有效令牌，admin 额外要求管理员令牌 */
export function requireRole(require: Role, allowPublic = false) {
    return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
        const token = getToken(c);
        if (!token) {
            if (allowPublic) return next();
            return c.json({ error: "缺少有效令牌" }, 401);
        }
        if (require === "admin" && token.role !== "admin") {
            return c.json({ error: "需要管理员令牌" }, 403);
        }
        return next();
    };
}