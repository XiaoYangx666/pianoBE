import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
    id         TEXT PRIMARY KEY,      -- crc32(内容) 内容寻址
    name       TEXT NOT NULL,
    duration   INTEGER NOT NULL,      -- 已按 TIME_SCALE 缩放
    data       TEXT NOT NULL,         -- MidiSong JSON
    owner      TEXT,                  -- 上传者令牌身份
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner      TEXT NOT NULL,         -- 创建者令牌身份
    name       TEXT NOT NULL,
    public     INTEGER NOT NULL DEFAULT 0,
    play_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    items      TEXT NOT NULL DEFAULT '[]'  -- song id 数组 JSON（与 meta 同记录原子更新）
);

CREATE TABLE IF NOT EXISTS tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL UNIQUE,  -- 身份名（如 bootstrap / my-uploader）
    token_hash TEXT NOT NULL,         -- SHA-256(明文令牌)
    role       TEXT NOT NULL,         -- read | write | admin
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0
);
`;

/** 打开数据库并确保表结构存在（幂等迁移） */
export function openDb(path: string): Database {
    const db = new Database(path);
    db.exec(SCHEMA);
    return db;
}