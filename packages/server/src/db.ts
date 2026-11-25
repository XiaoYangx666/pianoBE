import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
    id                TEXT PRIMARY KEY,      -- crc32(内容) 内容寻址
    name              TEXT NOT NULL,
    duration          INTEGER NOT NULL,      -- 已按 TIME_SCALE 缩放
    note_count        INTEGER NOT NULL DEFAULT 0,  -- 音符总数（列表/统计用）
    data_size         INTEGER NOT NULL DEFAULT 0,  -- 源文件字节数
    music_fingerprint TEXT,                  -- 规范化音乐本体指纹
    format            TEXT NOT NULL DEFAULT 'mid', -- mid | pbe3 | json
    origin_kind       TEXT NOT NULL DEFAULT 'user',
    origin_id         TEXT,
    aliases_json      TEXT,
    owner             TEXT,                  -- 上传者令牌身份
    created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    kind        TEXT NOT NULL DEFAULT 'user', -- user | plugin | server | official
    plugin_id   TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_songs (
    library_id  TEXT NOT NULL,
    song_id     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (library_id, song_id)
);

CREATE TABLE IF NOT EXISTS performances (
    id                    TEXT PRIMARY KEY,
    song_id               TEXT NOT NULL,
    music_fingerprint     TEXT,
    name                  TEXT NOT NULL,
    author                TEXT,
    description           TEXT,
    cues_json             TEXT NOT NULL,
    required_effects_json TEXT NOT NULL,
    origin_kind           TEXT NOT NULL DEFAULT 'user',
    origin_id             TEXT,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugins (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    size          INTEGER NOT NULL DEFAULT 0,
    source        TEXT NOT NULL DEFAULT 'upload', -- builtin | upload
    enabled       INTEGER NOT NULL DEFAULT 1,
    trusted       INTEGER NOT NULL DEFAULT 0,
    has_code      INTEGER NOT NULL DEFAULT 0,
    installed_at  INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 曲目原始内容（mid/pbe3/json）。与 songs 元数据分开存，列表查询不碰大字段。
CREATE TABLE IF NOT EXISTS song_files (
    song_id TEXT NOT NULL,
    kind    TEXT NOT NULL,       -- mid | pbe3 | json
    bytes   BLOB NOT NULL,
    PRIMARY KEY (song_id, kind)
);

CREATE TABLE IF NOT EXISTS tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL UNIQUE,  -- 身份名（如 bootstrap / my-uploader）
    token_hash TEXT NOT NULL,         -- SHA-256(明文令牌)
    role       TEXT NOT NULL,         -- user | admin（旧 read/write 读取时按 user 处理）
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0
);
`;

/** 打开数据库并确保表结构存在（幂等迁移） */
export function openDb(path: string): Database {
    const db = new Database(path);
    // WAL + 忙等：部署批量写库与 BDS 拉曲并发时，避免直接 SQLITE_BUSY
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(SCHEMA);
    migrateSongsColumns(db);
    seedDefaults(db);
    return db;
}

/** 老库升级：songs 表去掉旧 data 列，补统计与领域字段 */
function migrateSongsColumns(db: Database): void {
    const cols = db.query(`PRAGMA table_info(songs)`).all() as { name: string }[];
    if (cols.some((c) => c.name === "data")) {
        db.exec(`ALTER TABLE songs DROP COLUMN data`);
    }
    const addCol = (name: string, ddl: string) => {
        if (!cols.some((c) => c.name === name)) {
            db.exec(`ALTER TABLE songs ADD COLUMN ${name} ${ddl}`);
        }
    };
    addCol("note_count", "INTEGER NOT NULL DEFAULT 0");
    addCol("data_size", "INTEGER NOT NULL DEFAULT 0");
    addCol("music_fingerprint", "TEXT");
    addCol("format", "TEXT NOT NULL DEFAULT 'mid'");
    addCol("origin_kind", "TEXT NOT NULL DEFAULT 'user'");
    addCol("origin_id", "TEXT");
    addCol("aliases_json", "TEXT");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_songs_fingerprint ON songs(music_fingerprint)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_performances_song ON performances(song_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_library_songs_song ON library_songs(song_id)`);
}

function seedDefaults(db: Database): void {
    const now = Date.now();
    db.query(
        `INSERT OR IGNORE INTO libraries(id,name,description,kind,plugin_id,created_at,updated_at)
         VALUES('default','默认曲库','服务器默认公共曲库','server',NULL,?,?)`
    ).run(now, now);
    db.query(
        `INSERT OR IGNORE INTO server_state(key,value,updated_at) VALUES('catalog_version','1',?)`
    ).run(now);
}
