import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
    id         TEXT PRIMARY KEY,      -- crc32(内容) 内容寻址
    name       TEXT NOT NULL,
    duration   INTEGER NOT NULL,      -- 已按 TIME_SCALE 缩放
    note_count INTEGER NOT NULL DEFAULT 0,  -- 音符总数（列表/统计用）
    data_size  INTEGER NOT NULL DEFAULT 0,  -- .mid 源文件字节数
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
    migrateSongsColumns(db);
    return db;
}

/** 老库升级：songs 表去掉 content 列（曲目内容迁到文件系统 data/midis/），补统计列 */
function migrateSongsColumns(db: Database): void {
    const cols = db.query(`PRAGMA table_info(songs)`).all() as { name: string }[];
    if (cols.some((c) => c.name === "data")) {
        // 旧库：曲目内容 JSON 存于 data 列。v2 起内容存文件，删列
        db.exec(`ALTER TABLE songs DROP COLUMN data`);
    }
    // 统计列缺失则补充（v1 老库）
    if (!cols.some((c) => c.name === "note_count")) {
        db.exec(`ALTER TABLE songs ADD COLUMN note_count INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => c.name === "data_size")) {
        db.exec(`ALTER TABLE songs ADD COLUMN data_size INTEGER NOT NULL DEFAULT 0`);
    }
    // 旧 data 列内容已无法还原为源文件，仅保留 meta（曲目内容按需重传/重新导入）
}