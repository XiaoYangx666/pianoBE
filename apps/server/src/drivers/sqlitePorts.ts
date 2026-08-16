import type { Database } from "bun:sqlite";
import type { MidiSong, MidiSongMeta, PlaylistMeta, PlaylistPort, SongPort } from "@piano/core";

/**
 * SQLite 存储驱动：实现 core 的 SongPort / PlaylistPort。
 * 单记录 = 单行原子读写（sqlite 单语句自带原子性），无显式事务；
 * 播放列表 meta 与 items 同记录（JSON 列），天然消除孤儿残留。
 */

interface SongRow {
    id: string;
    name: string;
    duration: number;
    data: string;
    created_at: number;
}

interface PlaylistRow {
    id: number;
    owner: string;
    name: string;
    public: number;
    play_count: number;
    created_at: number;
    updated_at: number;
    items: string;
}

export class SqliteSongPort implements SongPort {
    constructor(private readonly db: Database) {}

    add(song: MidiSong): void {
        // 内容寻址：同 id 覆盖（改名/更新以最后一次写入为准），单语句原子
        this.db
            .prepare(
                `INSERT INTO songs(id,name,duration,data,created_at) VALUES(?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name, duration=excluded.duration, data=excluded.data`
            )
            .run(song.id, song.name, song.duration, JSON.stringify(song), Date.now());
    }

    getMeta(id: string): MidiSongMeta | undefined {
        const r = this.db
            .prepare(`SELECT id,name,duration FROM songs WHERE id=?`)
            .get(id) as Pick<SongRow, "id" | "name" | "duration"> | null;
        return r ?? undefined;
    }

    getSong(id: string): MidiSong | undefined {
        const r = this.db.prepare(`SELECT data FROM songs WHERE id=?`).get(id) as
            | Pick<SongRow, "data">
            | null;
        if (!r) return undefined;
        try {
            return JSON.parse(r.data) as MidiSong;
        } catch {
            return undefined;
        }
    }

    has(id: string): boolean {
        return !!this.db.prepare(`SELECT 1 FROM songs WHERE id=?`).get(id);
    }

    listMetas(): MidiSongMeta[] {
        return this.db
            .prepare(`SELECT id,name,duration FROM songs ORDER BY rowid`)
            .all() as MidiSongMeta[];
    }

    remove(id: string): void {
        this.db.prepare(`DELETE FROM songs WHERE id=?`).run(id);
    }
}

export class SqlitePlaylistPort implements PlaylistPort {
    constructor(private readonly db: Database) {}

    /** max(id)+1：顺序创建不碰撞，删除后可复用（与内存驱动契约一致） */
    nextId(): number {
        const r = this.db.prepare(`SELECT MAX(id) AS m FROM playlists`).get() as {
            m: number | null;
        };
        return (r.m ?? 0) + 1;
    }

    getMeta(id: number): PlaylistMeta | undefined {
        const r = this.db.prepare(`SELECT * FROM playlists WHERE id=?`).get(id) as
            | PlaylistRow
            | null;
        return r ? rowToMeta(r) : undefined;
    }

    listAllMetas(): PlaylistMeta[] {
        return (
            this.db.prepare(`SELECT * FROM playlists ORDER BY id`).all() as PlaylistRow[]
        ).map(rowToMeta);
    }

    setMeta(meta: PlaylistMeta): void {
        // UPSERT：items 列不参与更新（meta 更新不触碰列表内容），单语句原子
        this.db
            .prepare(
                `INSERT INTO playlists(id,owner,name,public,play_count,created_at,updated_at,items)
                 VALUES(?,?,?,?,?,?,?,'[]')
                 ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name, public=excluded.public,
                     play_count=excluded.play_count, updated_at=excluded.updated_at`
            )
            .run(
                meta.id,
                meta.owner,
                meta.name,
                meta.public ? 1 : 0,
                meta.playCount,
                meta.createdAt,
                meta.updatedAt
            );
    }

    deleteMeta(id: number): void {
        this.db.prepare(`DELETE FROM playlists WHERE id=?`).run(id);
    }

    getContent(id: number): string[] {
        const r = this.db.prepare(`SELECT items FROM playlists WHERE id=?`).get(id) as
            | Pick<PlaylistRow, "items">
            | null;
        if (!r) return [];
        try {
            const parsed = JSON.parse(r.items);
            return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
            return [];
        }
    }

    setContent(id: number, items: string[]): void {
        // 单行原子更新
        this.db.prepare(`UPDATE playlists SET items=? WHERE id=?`).run(
            JSON.stringify(items),
            id
        );
    }

    deleteContent(id: number): void {
        // meta 与 content 同记录：删除整行即清理两者
        this.deleteMeta(id);
    }

    deletePlaylist(id: number): void {
        this.deleteMeta(id);
    }
}

function rowToMeta(r: PlaylistRow): PlaylistMeta {
    return {
        id: r.id,
        owner: r.owner,
        name: r.name,
        public: !!r.public,
        playCount: r.play_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}