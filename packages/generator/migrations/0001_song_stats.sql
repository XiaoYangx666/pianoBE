CREATE TABLE IF NOT EXISTS song_stats (
    song_id TEXT PRIMARY KEY,
    plays INTEGER NOT NULL DEFAULT 0 CHECK (plays >= 0)
);

-- 每个“歌曲 + 访客”最多一行，避免按时间桶永久堆积历史去重记录。
-- visitor_hash 是 Worker 使用私有 secret 对 CF-Connecting-IP 做 HMAC-SHA256 的结果，
-- 数据库中不保存明文 IP。
CREATE TABLE IF NOT EXISTS play_guard (
    song_id TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    last_counted_at INTEGER NOT NULL,
    PRIMARY KEY (song_id, visitor_hash)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_play_guard_last_counted_at
ON play_guard(last_counted_at);

-- recordPlay 先确保 song_stats 行存在，再写 play_guard。
-- 由 trigger 把“是否真正通过 15 分钟去重”与 plays + 1 放在同一数据库事务中。
CREATE TRIGGER IF NOT EXISTS play_guard_count_insert
AFTER INSERT ON play_guard
BEGIN
    UPDATE song_stats
    SET plays = plays + 1
    WHERE song_id = NEW.song_id;
END;

CREATE TRIGGER IF NOT EXISTS play_guard_count_update
AFTER UPDATE OF last_counted_at ON play_guard
WHEN NEW.last_counted_at > OLD.last_counted_at
BEGIN
    UPDATE song_stats
    SET plays = plays + 1
    WHERE song_id = NEW.song_id;
END;
