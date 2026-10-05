ALTER TABLE song_stats
ADD COLUMN adds INTEGER NOT NULL DEFAULT 0 CHECK (adds >= 0);

-- “添加”与“试听”是两个独立行为，各自维护去重状态。
CREATE TABLE IF NOT EXISTS add_guard (
    song_id TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    last_counted_at INTEGER NOT NULL,
    PRIMARY KEY (song_id, visitor_hash)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_add_guard_last_counted_at
ON add_guard(last_counted_at);

CREATE TRIGGER IF NOT EXISTS add_guard_count_insert
AFTER INSERT ON add_guard
BEGIN
    UPDATE song_stats
    SET adds = adds + 1
    WHERE song_id = NEW.song_id;
END;

CREATE TRIGGER IF NOT EXISTS add_guard_count_update
AFTER UPDATE OF last_counted_at ON add_guard
WHEN NEW.last_counted_at > OLD.last_counted_at
BEGIN
    UPDATE song_stats
    SET adds = adds + 1
    WHERE song_id = NEW.song_id;
END;
