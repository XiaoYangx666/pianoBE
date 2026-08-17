import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { MidiSong, MidiSongMeta, PlaylistMeta, PlaylistPort, SongPort } from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

/**
 * SQLite 存储驱动：实现 core 的 SongPort / PlaylistPort。
 * 单记录 = 单行原子读写（sqlite 单语句自带原子性），无显式事务；
 * 播放列表 meta 与 items 同记录（JSON 列），天然消除孤儿残留。
 *
 * 曲目内容策略（v2）：完整曲目不落库，存为磁盘文件：
 *   data/midis/{id}.mid   —— 原始 .mid 源文件（内容寻址，上传主路径）
 *   data/midis/{id}.json  —— 契约兜底（core SongPort.add 传入已解析 MidiSong 时）
 * SQLite songs 表仅存 meta（id/name/duration/noteCount/dataSize），列表/搜索/统计。
 * getSong 优先读 .mid 按需转换，回退 .json；避免重复存同一曲目的两份内容。
 */

interface SongRow {
    id: string;
    name: string;
    duration: number;
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
    constructor(
        private readonly db: Database,
        private readonly contentDir = "./data/midis"
    ) {
        mkdirSync(contentDir, { recursive: true });
    }

    private midiPath(id: string): string {
        return join(this.contentDir, `${id}.mid`);
    }
    private jsonPath(id: string): string {
        return join(this.contentDir, `${id}.json`);
    }

    /** 上传主路径：保存 .mid 源文件，解析 meta 落表（内容寻址，幂等） */
    saveMidiFile(buffer: Uint8Array, name: string): MidiSongMeta {
        const song = midiBufferToSong(buffer, name);
        writeFileSync(this.midiPath(song.id), buffer);
        this.upsertMeta(song.id, name || song.id, song.duration, song, buffer.byteLength);
        return { id: song.id, name: name || song.id, duration: song.duration };
    }

    /** 契约路径：传入已解析 MidiSong，序列化为 JSON 文件兜底（无法还原 .mid） */
    add(song: MidiSong): void {
        const data = JSON.stringify(song);
        writeFileSync(this.jsonPath(song.id), data);
        this.upsertMeta(
            song.id,
            song.name,
            song.duration,
            song,
            Buffer.byteLength(data, "utf8")
        );
    }

    private upsertMeta(
        id: string,
        name: string,
        duration: number,
        song: MidiSong,
        dataSize: number
    ): void {
        this.db
            .prepare(
                `INSERT INTO songs(id,name,duration,note_count,data_size,created_at)
                 VALUES(?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name, duration=excluded.duration,
                     note_count=excluded.note_count, data_size=excluded.data_size`
            )
            .run(id, name, duration, countNotes(song), dataSize, Date.now());
    }

    getMeta(id: string): MidiSongMeta | undefined {
        const r = this.db
            .prepare(`SELECT id,name,duration FROM songs WHERE id=?`)
            .get(id) as Pick<SongRow, "id" | "name" | "duration"> | null;
        return r ?? undefined;
    }

    /** 重命名曲目，返回更新后的 meta；不存在返回 undefined */
    rename(id: string, name: string): MidiSongMeta | undefined {
        const clean = name.trim().slice(0, 200);
        if (!clean) return undefined;
        const res = this.db
            .prepare(`UPDATE songs SET name=? WHERE id=?`)
            .run(clean, id);
        if (res.changes === 0) return undefined;
        return this.getMeta(id);
    }

    /** 原始 .mid 字节（存在则返回；供前端直接解析播放） */
    getRaw(id: string): Uint8Array<ArrayBuffer> | undefined {
        const p = this.midiPath(id);
        if (!existsSync(p)) return undefined;
        return new Uint8Array(readFileSync(p).buffer);
    }

    getSong(id: string): MidiSong | undefined {
        // 优先 .mid 源文件按需转换
        const raw = this.getRaw(id);
        if (raw) {
            const meta = this.getMeta(id);
            try {
                return midiBufferToSong(raw, meta?.name ?? id);
            } catch {
                // 转换失败回退 JSON
            }
        }
        const json = this.jsonPath(id);
        if (existsSync(json)) {
            try {
                return JSON.parse(readFileSync(json, "utf8")) as MidiSong;
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    has(id: string): boolean {
        return !!this.db.prepare(`SELECT 1 FROM songs WHERE id=?`).get(id);
    }

    listMetas(): MidiSongMeta[] {
        return this.db
            .prepare(`SELECT id,name,duration FROM songs ORDER BY rowid`)
            .all() as MidiSongMeta[];
    }

    /** 带统计的列表（noteCount + dataSize），管理页展示用 */
    listMetasWithStats(): Array<MidiSongMeta & { noteCount: number; dataSize: number }> {
        return this.db
            .prepare(
                `SELECT id,name,duration,note_count AS noteCount,data_size AS dataSize
                 FROM songs ORDER BY rowid`
            )
            .all() as Array<MidiSongMeta & { noteCount: number; dataSize: number }>;
    }

    remove(id: string): void {
        this.db.prepare(`DELETE FROM songs WHERE id=?`).run(id);
        for (const p of [this.midiPath(id), this.jsonPath(id)]) {
            if (existsSync(p)) rmSync(p);
        }
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

/** 音符总数：各轨道 notes 四元组数之和 */
function countNotes(song: MidiSong): number {
    return song.tracks.reduce((sum, t) => sum + Math.floor((t.notes?.length ?? 0) / 4), 0);
}