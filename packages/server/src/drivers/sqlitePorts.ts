import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { MidiSong, MidiSongMeta, PlaylistMeta, PlaylistPort, SongPort } from "@piano/core";
import { encodePbe2, readPbe2Header } from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

/**
 * SQLite 存储驱动：实现 core 的 SongPort / PlaylistPort。
 * 单记录 = 单行原子读写（sqlite 单语句自带原子性），无显式事务；
 * 播放列表 meta 与 items 同记录（JSON 列），天然消除孤儿残留。
 *
 * 曲目内容策略（v3）：SQLite 仅存元数据，完整曲目以 `.mid` 源文件保存；
 * 对游戏播放器统一按需编码为 PBE2（内存 LRU 缓存最近使用的曲目），
 * 管理页拉原始 `.mid` 走 /raw，不受影响。
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

/**
 * 统一使用 Database.query()（按 SQL 缓存的预编译语句）而不是每次 prepare()。
 * Bun 在 Windows 上 close() 后，临时 prepare() 语句可能延迟释放文件句柄，
 * 导致删除数据库目录时 EBUSY；query 的缓存在 close() 时统一释放。
 */
export class SqliteSongPort implements SongPort {
    /** PBE2 编码缓存（内容不变时避免重复解析/压缩） */
    private readonly pbe2Cache = new Map<string, Uint8Array>();
    private static readonly MAX_PBE2_CACHE = 32;

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
        this.pbe2Cache.delete(song.id);
        this.upsertMeta(song.id, name || song.id, song.duration, song, buffer.byteLength);
        return { id: song.id, name: name || song.id, duration: song.duration };
    }

    /** 契约路径：传入已解析 MidiSong，序列化为 JSON 文件兜底（无法还原 .mid） */
    add(song: MidiSong): void {
        const data = JSON.stringify(song);
        writeFileSync(this.jsonPath(song.id), data);
        this.pbe2Cache.delete(song.id);
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
            .query(
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
            .query(`SELECT id,name,duration FROM songs WHERE id=?`)
            .get(id) as Pick<SongRow, "id" | "name" | "duration"> | null;
        return r ?? undefined;
    }

    /** 重命名曲目，返回更新后的 meta；不存在返回 undefined */
    rename(id: string, name: string): MidiSongMeta | undefined {
        const clean = name.trim().slice(0, 200);
        if (!clean) return undefined;
        const res = this.db
            .query(`UPDATE songs SET name=? WHERE id=?`)
            .run(clean, id);
        if (res.changes === 0) return undefined;
        this.pbe2Cache.delete(id);
        return this.getMeta(id);
    }

    /** 原始 .mid 字节（存在则返回；供前端直接解析播放） */
    getRaw(id: string): Uint8Array<ArrayBuffer> | undefined {
        const p = this.midiPath(id);
        if (!existsSync(p)) return undefined;
        return Uint8Array.from(readFileSync(p));
    }

    /**
     * 游戏播放器使用的 PBE2 数据。
     * 优先 `.mid` 源文件按需转换；兼容历史上通过 SongPort.add() 写入的 `.json`。
     */
    getPbe2(id: string): Uint8Array | undefined {
        const cached = this.pbe2Cache.get(id);
        if (cached) {
            // LRU：命中移到末尾
            this.pbe2Cache.delete(id);
            this.pbe2Cache.set(id, cached);
            return cached;
        }
        const raw = this.getRaw(id);
        const meta = this.getMeta(id);
        let song: MidiSong | undefined;
        if (raw) {
            try {
                song = midiBufferToSong(raw, meta?.name ?? id);
            } catch {
                song = undefined;
            }
        }
        if (!song) {
            const json = this.jsonPath(id);
            if (!existsSync(json)) return undefined;
            try {
                song = JSON.parse(readFileSync(json, "utf8")) as MidiSong;
            } catch {
                return undefined;
            }
        }
        try {
            const pbe2 = encodePbe2(song);
            this.cachePbe2(id, pbe2);
            return pbe2;
        } catch {
            return undefined;
        }
    }

    /** 校验 PBE2 头部（供路由直接读取元信息） */
    getPbe2Meta(id: string): { id: string; name: string; duration: number } | undefined {
        const pbe2 = this.getPbe2(id);
        if (!pbe2) return undefined;
        try {
            const header = readPbe2Header(pbe2);
            return { id: header.id, name: header.name, duration: header.duration };
        } catch {
            return undefined;
        }
    }

    private cachePbe2(id: string, pbe2: Uint8Array) {
        this.pbe2Cache.delete(id);
        this.pbe2Cache.set(id, pbe2);
        if (this.pbe2Cache.size > SqliteSongPort.MAX_PBE2_CACHE) {
            const oldest = this.pbe2Cache.keys().next().value as string | undefined;
            if (oldest !== undefined) this.pbe2Cache.delete(oldest);
        }
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
        return !!this.db.query(`SELECT 1 FROM songs WHERE id=?`).get(id);
    }

    listMetas(): MidiSongMeta[] {
        return this.db
            .query(`SELECT id,name,duration FROM songs ORDER BY rowid`)
            .all() as MidiSongMeta[];
    }

    /** 带统计的列表（noteCount + dataSize），管理页展示用 */
    listMetasWithStats(): Array<MidiSongMeta & { noteCount: number; dataSize: number }> {
        return this.db
            .query(
                `SELECT id,name,duration,note_count AS noteCount,data_size AS dataSize
                 FROM songs ORDER BY rowid`
            )
            .all() as Array<MidiSongMeta & { noteCount: number; dataSize: number }>;
    }

    remove(id: string): void {
        this.db.query(`DELETE FROM songs WHERE id=?`).run(id);
        this.pbe2Cache.delete(id);
        for (const p of [this.midiPath(id), this.jsonPath(id)]) {
            if (existsSync(p)) rmSync(p);
        }
    }
}

export class SqlitePlaylistPort implements PlaylistPort {
    constructor(private readonly db: Database) {}

    /** max(id)+1：顺序创建不碰撞，删除后可复用（与内存驱动契约一致） */
    nextId(): number {
        const r = this.db.query(`SELECT MAX(id) AS m FROM playlists`).get() as {
            m: number | null;
        };
        return (r.m ?? 0) + 1;
    }

    getMeta(id: number): PlaylistMeta | undefined {
        const r = this.db.query(`SELECT * FROM playlists WHERE id=?`).get(id) as
            | PlaylistRow
            | null;
        return r ? rowToMeta(r) : undefined;
    }

    listAllMetas(): PlaylistMeta[] {
        return (
            this.db.query(`SELECT * FROM playlists ORDER BY id`).all() as PlaylistRow[]
        ).map(rowToMeta);
    }

    setMeta(meta: PlaylistMeta): void {
        // UPSERT：items 列不参与更新（meta 更新不触碰列表内容），单语句原子
        this.db
            .query(
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
        this.db.query(`DELETE FROM playlists WHERE id=?`).run(id);
    }

    getContent(id: number): string[] {
        const r = this.db.query(`SELECT items FROM playlists WHERE id=?`).get(id) as
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
        this.db.query(`UPDATE playlists SET items=? WHERE id=?`).run(
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