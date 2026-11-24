import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
    ContentOrigin,
    LibraryRecord,
    MidiSong,
    MidiSongMeta,
    PerformanceCue,
    PerformanceDescriptor,
    SongPort,
} from "@piano/core";
import {
    computeMusicFingerprint,
    decodeSong,
    defaultPerformanceId,
    encodeSong,
    extractCueEffects,
    readSongHeader,
    sameSongMusic,
    sameSongPerformance,
    validateSong,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";

export class SongConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SongConflictError";
    }
}

interface SongRow {
    id: string;
    name: string;
    duration: number;
    note_count: number;
    data_size: number;
    music_fingerprint: string | null;
    format: string;
    origin_kind: string;
    origin_id: string | null;
    aliases_json: string | null;
    created_at: number;
}

interface LibraryRow {
    id: string;
    name: string;
    description: string | null;
    kind: "official" | "plugin" | "user" | "server";
    plugin_id: string | null;
    created_at: number;
    updated_at: number;
}

interface PerformanceRow {
    id: string;
    song_id: string;
    music_fingerprint: string | null;
    name: string;
    author: string | null;
    description: string | null;
    cues_json: string;
    required_effects_json: string;
    origin_kind: string;
    origin_id: string | null;
    created_at: number;
    updated_at: number;
}

export interface PluginRow {
    id: string;
    name: string;
    version: string;
    manifest_json: string;
    size: number;
    source: string;
    enabled: number;
    trusted: number;
    has_code: number;
    installed_at: number;
    updated_at: number;
}

export interface SaveSongOptions {
    name?: string;
    origin?: ContentOrigin;
    libraryId?: string;
    performanceMeta?: {
        id?: string;
        name?: string;
        author?: string;
        description?: string;
    };
}

export interface SongMetaWithStats extends MidiSongMeta {
    noteCount: number;
    dataSize: number;
    format?: string;
}

export class SqliteSongPort implements SongPort {
    private readonly pbe3Cache = new Map<string, Uint8Array>();
    private static readonly MAX_PBE3_CACHE = 32;

    constructor(
        private readonly db: Database,
        private readonly contentDir = "./data/midis",
    ) {
        mkdirSync(contentDir, { recursive: true });
    }

    private midiPath(id: string): string {
        return join(this.contentDir, `${id}.mid`);
    }
    private pbe3Path(id: string): string {
        return join(this.contentDir, `${id}.pbe3`);
    }
    private jsonPath(id: string): string {
        return join(this.contentDir, `${id}.json`);
    }

    /* ================== Server State & Catalog Version ================== */

    getState(key: string): string | undefined {
        const row = this.db.query(`SELECT value FROM server_state WHERE key=?`).get(key) as { value: string } | null;
        return row?.value;
    }

    setState(key: string, value: string): void {
        this.db
            .query(
                `INSERT INTO server_state(key,value,updated_at) VALUES(?,?,?)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
            )
            .run(key, value, Date.now());
    }

    getCatalogVersion(): number {
        const raw = this.getState("catalog_version");
        const num = raw ? Number(raw) : 1;
        return Number.isFinite(num) ? num : 1;
    }

    bumpCatalogVersion(): number {
        const next = this.getCatalogVersion() + 1;
        this.setState("catalog_version", String(next));
        return next;
    }

    /* ================== Song Saving & Merging ================== */

    saveMidiFile(buffer: Uint8Array, name: string, options: SaveSongOptions = {}): MidiSongMeta {
        const song = midiBufferToSong(buffer, name);
        const pbe3 = encodeSong(song);
        const fp = computeMusicFingerprint(pbe3);
        const displayName = (options.name ?? name).trim() || song.id;
        const origin = options.origin ?? { kind: "user" };

        const existingByFp = this.findSongByFingerprint(fp, pbe3);
        if (existingByFp && existingByFp.id !== song.id) {
            this.mergeAliasAndLibrary(existingByFp.id, displayName, options.libraryId);
            this.bumpCatalogVersion();
            return this.getDetailedMeta(existingByFp.id)!;
        }

        const existingById = this.db.query(`SELECT id, music_fingerprint FROM songs WHERE id=?`).get(song.id) as {
            id: string;
            music_fingerprint: string | null;
        } | null;
        if (existingById && existingById.music_fingerprint && existingById.music_fingerprint !== fp) {
            throw new SongConflictError(`歌曲 ID 冲突：${song.id} 已存在且音乐内容不同`);
        }

        writeFileSync(this.midiPath(song.id), buffer);
        this.cachePbe3(song.id, pbe3);
        this.upsertMeta(song.id, displayName, song.duration, countNotes(song), buffer.byteLength, {
            musicFingerprint: fp,
            format: "mid",
            origin,
        });
        this.ensureLibraryMembership(options.libraryId ?? "default", song.id);
        this.bumpCatalogVersion();
        return { id: song.id, name: displayName, duration: song.duration };
    }

    savePbe3File(buffer: Uint8Array, options: SaveSongOptions = {}): MidiSongMeta {
        const { header } = validateSong(buffer);
        const fp = computeMusicFingerprint(buffer);
        const displayName = (options.name ?? header.name).trim() || header.id;
        const origin = options.origin ?? { kind: "user" };

        const existingByFp = this.findSongByFingerprint(fp, buffer);
        if (existingByFp) {
            this.mergeAliasAndLibrary(existingByFp.id, displayName, options.libraryId);
            if (header.performance?.length) {
                this.upsertPerformanceForSong(
                    existingByFp.id,
                    fp,
                    header.performance,
                    origin,
                    options.performanceMeta,
                );
            }
            this.bumpCatalogVersion();
            return this.getDetailedMeta(existingByFp.id)!;
        }

        const existingById = this.db.query(`SELECT id, music_fingerprint FROM songs WHERE id=?`).get(header.id) as {
            id: string;
            music_fingerprint: string | null;
        } | null;
        if (existingById) {
            const currentBytes = this.getPbe3(header.id);
            if (!currentBytes || !sameSongMusic(currentBytes, buffer)) {
                throw new SongConflictError(`歌曲 ID 冲突：${header.id} 已存在且音乐内容不同`);
            }
        }

        writeFileSync(this.pbe3Path(header.id), buffer);
        this.cachePbe3(header.id, buffer);
        this.upsertMeta(header.id, displayName, header.duration, header.noteCount, buffer.byteLength, {
            musicFingerprint: fp,
            format: "pbe3",
            origin,
        });
        this.ensureLibraryMembership(options.libraryId ?? "default", header.id);
        if (header.performance?.length) {
            this.upsertPerformanceForSong(header.id, fp, header.performance, origin, options.performanceMeta);
        }
        this.bumpCatalogVersion();
        return { id: header.id, name: displayName, duration: header.duration };
    }

    add(song: MidiSong): void {
        const data = JSON.stringify(song);
        writeFileSync(this.jsonPath(song.id), data);
        this.pbe3Cache.delete(song.id);
        let fp: string | undefined;
        try {
            fp = computeMusicFingerprint(encodeSong(song));
        } catch {
            fp = undefined;
        }
        this.upsertMeta(song.id, song.name, song.duration, countNotes(song), Buffer.byteLength(data, "utf8"), {
            musicFingerprint: fp,
            format: "json",
            origin: { kind: "user" },
        });
        this.ensureLibraryMembership("default", song.id);
        this.bumpCatalogVersion();
    }

    private findSongByFingerprint(fp: string, candidatePbe3: Uint8Array): SongRow | undefined {
        const rows = this.db
            .query(`SELECT * FROM songs WHERE music_fingerprint=?`)
            .all(fp) as SongRow[];
        for (const row of rows) {
            const existing = this.getPbe3(row.id);
            if (existing && sameSongMusic(existing, candidatePbe3)) return row;
        }
        return undefined;
    }

    private mergeAliasAndLibrary(songId: string, incomingName: string, libraryId?: string): void {
        const row = this.db.query(`SELECT name, aliases_json FROM songs WHERE id=?`).get(songId) as {
            name: string;
            aliases_json: string | null;
        } | null;
        if (row && incomingName && incomingName !== row.name) {
            const existingAliases: string[] = row.aliases_json ? JSON.parse(row.aliases_json) : [];
            if (!existingAliases.includes(incomingName)) {
                existingAliases.push(incomingName);
                this.db
                    .query(`UPDATE songs SET aliases_json=? WHERE id=?`)
                    .run(JSON.stringify(existingAliases), songId);
            }
        }
        if (libraryId) {
            this.ensureLibraryMembership(libraryId, songId);
        }
    }

    private ensureLibraryMembership(libraryId: string, songId: string): void {
        const lib = this.db.query(`SELECT 1 FROM libraries WHERE id=?`).get(libraryId);
        if (!lib) return;
        this.db
            .query(
                `INSERT OR IGNORE INTO library_songs(library_id,song_id,sort_order,added_at) VALUES(?,?,0,?)`,
            )
            .run(libraryId, songId, Date.now());
    }

    private upsertMeta(
        id: string,
        name: string,
        duration: number,
        noteCount: number,
        dataSize: number,
        extra: { musicFingerprint?: string; format: string; origin?: ContentOrigin },
    ): void {
        this.db
            .query(
                `INSERT INTO songs(id,name,duration,note_count,data_size,music_fingerprint,format,origin_kind,origin_id,created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name,
                     duration=excluded.duration,
                     note_count=excluded.note_count,
                     data_size=excluded.data_size,
                     music_fingerprint=COALESCE(excluded.music_fingerprint, songs.music_fingerprint),
                     format=excluded.format`,
            )
            .run(
                id,
                name,
                duration,
                noteCount,
                dataSize,
                extra.musicFingerprint ?? null,
                extra.format,
                extra.origin?.kind ?? "user",
                extra.origin?.id ?? null,
                Date.now(),
            );
    }

    /* ================== Read / Rename / Remove ================== */

    getMeta(id: string): MidiSongMeta | undefined {
        const r = this.db
            .query(`SELECT id,name,duration FROM songs WHERE id=?`)
            .get(id) as Pick<SongRow, "id" | "name" | "duration"> | null;
        return r ?? undefined;
    }

    getDetailedMeta(id: string): MidiSongMeta | undefined {
        const r = this.db
            .query(`SELECT id,name,duration,note_count,music_fingerprint,aliases_json,origin_kind,origin_id FROM songs WHERE id=?`)
            .get(id) as Pick<
            SongRow,
            "id" | "name" | "duration" | "note_count" | "music_fingerprint" | "aliases_json" | "origin_kind" | "origin_id"
        > | null;
        if (!r) return undefined;
        return this.hydrateMeta(r);
    }

    private hydrateMeta(
        r: Pick<
            SongRow,
            "id" | "name" | "duration" | "note_count" | "music_fingerprint" | "aliases_json" | "origin_kind" | "origin_id"
        >,
    ): MidiSongMeta {
        const meta: MidiSongMeta = {
            id: r.id,
            name: r.name,
            duration: r.duration,
        };
        if (r.note_count) meta.noteCount = r.note_count;
        if (r.music_fingerprint) meta.musicFingerprint = r.music_fingerprint;
        if (r.aliases_json) {
            try {
                const parsed = JSON.parse(r.aliases_json);
                if (Array.isArray(parsed) && parsed.length) meta.aliases = parsed;
            } catch { /* ignore */ }
        }
        meta.origin = {
            kind: (r.origin_kind as ContentOrigin["kind"]) || "user",
            ...(r.origin_id ? { id: r.origin_id } : {}),
        };
        const libRows = this.db
            .query(`SELECT library_id FROM library_songs WHERE song_id=? ORDER BY added_at`)
            .all(r.id) as { library_id: string }[];
        if (libRows.length) meta.libraries = libRows.map((row) => row.library_id);
        const perfs = this.listSongPerformances(r.id, false);
        if (perfs.length) meta.performanceEntries = perfs;
        return meta;
    }

    rename(id: string, name: string): MidiSongMeta | undefined {
        const clean = name.trim().slice(0, 200);
        if (!clean) return undefined;
        const res = this.db.query(`UPDATE songs SET name=? WHERE id=?`).run(clean, id);
        if (res.changes === 0) return undefined;
        this.pbe3Cache.delete(id);
        this.bumpCatalogVersion();
        return this.getMeta(id);
    }

    getRaw(id: string): Uint8Array<ArrayBuffer> | undefined {
        const p = this.midiPath(id);
        if (!existsSync(p)) return undefined;
        return Uint8Array.from(readFileSync(p));
    }

    getPbe3(id: string): Uint8Array | undefined {
        const cached = this.pbe3Cache.get(id);
        if (cached) {
            this.pbe3Cache.delete(id);
            this.pbe3Cache.set(id, cached);
            return cached;
        }
        const pbe3File = this.pbe3Path(id);
        if (existsSync(pbe3File)) {
            const bytes = Uint8Array.from(readFileSync(pbe3File));
            this.cachePbe3(id, bytes);
            return bytes;
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
            const pbe3 = encodeSong(song);
            this.cachePbe3(id, pbe3);
            return pbe3;
        } catch {
            return undefined;
        }
    }

    getPbe3Meta(id: string): { id: string; name: string; duration: number } | undefined {
        const pbe3 = this.getPbe3(id);
        if (!pbe3) return undefined;
        try {
            const header = readSongHeader(pbe3);
            return { id: header.id, name: header.name, duration: header.duration };
        } catch {
            return undefined;
        }
    }

    private cachePbe3(id: string, pbe3: Uint8Array) {
        this.pbe3Cache.delete(id);
        this.pbe3Cache.set(id, pbe3);
        if (this.pbe3Cache.size > SqliteSongPort.MAX_PBE3_CACHE) {
            const oldest = this.pbe3Cache.keys().next().value as string | undefined;
            if (oldest !== undefined) this.pbe3Cache.delete(oldest);
        }
    }

    getSong(id: string): MidiSong | undefined {
        const raw = this.getRaw(id);
        if (raw) {
            const meta = this.getMeta(id);
            try {
                return midiBufferToSong(raw, meta?.name ?? id);
            } catch { /* fallback */ }
        }
        const pbe3File = this.pbe3Path(id);
        if (existsSync(pbe3File)) {
            try {
                return decodeSong(Uint8Array.from(readFileSync(pbe3File)));
            } catch { /* fallback */ }
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

    listMetasWithStats(filter: { libraryId?: string; q?: string } = {}): SongMetaWithStats[] {
        const rows = filter.libraryId
            ? (this.db
                  .query(
                      `SELECT s.id,s.name,s.duration,s.note_count,s.data_size,s.music_fingerprint,s.format,s.origin_kind,s.origin_id,s.aliases_json,s.created_at
                       FROM songs s
                       INNER JOIN library_songs ls ON ls.song_id = s.id
                       WHERE ls.library_id = ?
                       ORDER BY ls.sort_order, s.rowid`,
                  )
                  .all(filter.libraryId) as SongRow[])
            : (this.db
                  .query(
                      `SELECT id,name,duration,note_count,data_size,music_fingerprint,format,origin_kind,origin_id,aliases_json,created_at
                       FROM songs ORDER BY rowid`,
                  )
                  .all() as SongRow[]);

        const keyword = filter.q?.trim().toLowerCase() ?? "";
        const filtered = keyword
            ? rows.filter(
                  (r) =>
                      r.name.toLowerCase().includes(keyword) ||
                      r.id.toLowerCase().includes(keyword) ||
                      (r.aliases_json?.toLowerCase().includes(keyword) ?? false),
              )
            : rows;

        return filtered.map((r) => ({
            ...this.hydrateMeta(r),
            noteCount: r.note_count,
            dataSize: r.data_size,
            format: r.format,
        }));
    }

    remove(id: string): void {
        this.db.query(`DELETE FROM library_songs WHERE song_id=?`).run(id);
        this.db.query(`DELETE FROM performances WHERE song_id=?`).run(id);
        this.db.query(`DELETE FROM songs WHERE id=?`).run(id);
        this.pbe3Cache.delete(id);
        for (const p of [this.midiPath(id), this.pbe3Path(id), this.jsonPath(id)]) {
            if (existsSync(p)) rmSync(p);
        }
        this.bumpCatalogVersion();
    }

    /* ================== Libraries ================== */

    listLibraries(): LibraryRecord[] {
        const rows = this.db.query(`SELECT * FROM libraries ORDER BY created_at, rowid`).all() as LibraryRow[];
        return rows.map((row) => this.rowToLibrary(row));
    }

    getLibrary(id: string): LibraryRecord | undefined {
        const row = this.db.query(`SELECT * FROM libraries WHERE id=?`).get(id) as LibraryRow | null;
        return row ? this.rowToLibrary(row) : undefined;
    }

    private rowToLibrary(row: LibraryRow): LibraryRecord {
        const songIds = (
            this.db
                .query(`SELECT song_id FROM library_songs WHERE library_id=? ORDER BY sort_order, added_at`)
                .all(row.id) as { song_id: string }[]
        ).map((item) => item.song_id);
        return {
            id: row.id,
            name: row.name,
            ...(row.description ? { description: row.description } : {}),
            kind: row.kind,
            ...(row.plugin_id ? { pluginId: row.plugin_id } : {}),
            songIds,
            readonly: row.kind === "plugin",
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    createLibrary(input: {
        id?: string;
        name: string;
        description?: string;
        kind?: "user" | "plugin" | "server" | "official";
        pluginId?: string;
        songIds?: readonly string[];
    }): LibraryRecord {
        const name = input.name.trim().slice(0, 80);
        if (!name) throw new Error("曲库名称不能为空");
        const id = input.id?.trim() || `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const now = Date.now();
        this.db
            .query(
                `INSERT INTO libraries(id,name,description,kind,plugin_id,created_at,updated_at)
                 VALUES(?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name,
                     description=excluded.description,
                     updated_at=excluded.updated_at`,
            )
            .run(id, name, input.description?.trim() || null, input.kind ?? "user", input.pluginId ?? null, now, now);

        if (input.songIds?.length) {
            this.addSongsToLibrary(id, input.songIds);
        }
        this.bumpCatalogVersion();
        return this.getLibrary(id)!;
    }

    renameLibrary(id: string, name: string, description?: string): LibraryRecord | undefined {
        const lib = this.getLibrary(id);
        if (!lib) return undefined;
        const clean = name.trim().slice(0, 80);
        if (!clean) throw new Error("曲库名称不能为空");
        this.db
            .query(`UPDATE libraries SET name=?, description=COALESCE(?, description), updated_at=? WHERE id=?`)
            .run(clean, description !== undefined ? description.trim() || null : null, Date.now(), id);
        this.bumpCatalogVersion();
        return this.getLibrary(id);
    }

    deleteLibrary(id: string): boolean {
        const res = this.db.query(`DELETE FROM libraries WHERE id=?`).run(id);
        this.db.query(`DELETE FROM library_songs WHERE library_id=?`).run(id);
        if (res.changes > 0) this.bumpCatalogVersion();
        return res.changes > 0;
    }

    addSongsToLibrary(libraryId: string, songIds: readonly string[]): number {
        const lib = this.getLibrary(libraryId);
        if (!lib) throw new Error(`曲库不存在：${libraryId}`);
        let added = 0;
        const now = Date.now();
        for (const songId of songIds) {
            if (!this.has(songId)) continue;
            const res = this.db
                .query(`INSERT OR IGNORE INTO library_songs(library_id,song_id,sort_order,added_at) VALUES(?,?,0,?)`)
                .run(libraryId, songId, now + added);
            if (res.changes > 0) added++;
        }
        if (added > 0) {
            this.db.query(`UPDATE libraries SET updated_at=? WHERE id=?`).run(now, libraryId);
            this.bumpCatalogVersion();
        }
        return added;
    }

    removeSongFromLibrary(libraryId: string, songId: string): boolean {
        const res = this.db
            .query(`DELETE FROM library_songs WHERE library_id=? AND song_id=?`)
            .run(libraryId, songId);
        if (res.changes > 0) {
            this.db.query(`UPDATE libraries SET updated_at=? WHERE id=?`).run(Date.now(), libraryId);
            this.bumpCatalogVersion();
        }
        return res.changes > 0;
    }

    clearLibrary(libraryId: string): number {
        const res = this.db.query(`DELETE FROM library_songs WHERE library_id=?`).run(libraryId);
        if (res.changes > 0) {
            this.db.query(`UPDATE libraries SET updated_at=? WHERE id=?`).run(Date.now(), libraryId);
            this.bumpCatalogVersion();
        }
        return res.changes;
    }

    /* ================== Performances ================== */

    listSongPerformances(songId: string, includeCues = true): PerformanceDescriptor[] {
        const rows = this.db
            .query(`SELECT * FROM performances WHERE song_id=? ORDER BY created_at, rowid`)
            .all(songId) as PerformanceRow[];
        return rows.map((row) => this.rowToPerformance(row, includeCues));
    }

    getPerformance(perfId: string): PerformanceDescriptor | undefined {
        const row = this.db.query(`SELECT * FROM performances WHERE id=?`).get(perfId) as PerformanceRow | null;
        return row ? this.rowToPerformance(row, true) : undefined;
    }

    private rowToPerformance(row: PerformanceRow, includeCues: boolean): PerformanceDescriptor {
        const requiredEffects: string[] = JSON.parse(row.required_effects_json || "[]");
        const cues: PerformanceCue[] | undefined = includeCues ? JSON.parse(row.cues_json) : undefined;
        return {
            id: row.id,
            name: row.name,
            ...(row.author ? { author: row.author } : {}),
            ...(row.description ? { description: row.description } : {}),
            songId: row.song_id,
            ...(row.music_fingerprint ? { musicFingerprint: row.music_fingerprint } : {}),
            ...(cues ? { cues } : {}),
            requiredEffects,
            origin: {
                kind: (row.origin_kind as ContentOrigin["kind"]) || "user",
                ...(row.origin_id ? { id: row.origin_id } : {}),
            },
        };
    }

    savePerformance(perf: {
        id: string;
        songId: string;
        musicFingerprint?: string;
        name: string;
        author?: string;
        description?: string;
        cues: readonly PerformanceCue[];
        origin?: ContentOrigin;
    }): PerformanceDescriptor {
        const existing = this.db
            .query(`SELECT id, origin_kind, origin_id FROM performances WHERE id=?`)
            .get(perf.id) as { id: string; origin_kind: string; origin_id: string | null } | null;

        if (existing) {
            const sameOwner =
                existing.origin_kind === (perf.origin?.kind ?? "user") &&
                (existing.origin_id ?? null) === (perf.origin?.id ?? null);
            if (!sameOwner) {
                throw new SongConflictError(`演出 ID 冲突：${perf.id} 已被其他来源占用`);
            }
        }

        const requiredEffects = extractCueEffects(perf.cues);
        const now = Date.now();
        this.db
            .query(
                `INSERT INTO performances(id,song_id,music_fingerprint,name,author,description,cues_json,required_effects_json,origin_kind,origin_id,created_at,updated_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                     song_id=excluded.song_id,
                     music_fingerprint=excluded.music_fingerprint,
                     name=excluded.name,
                     author=excluded.author,
                     description=excluded.description,
                     cues_json=excluded.cues_json,
                     required_effects_json=excluded.required_effects_json,
                     updated_at=excluded.updated_at`,
            )
            .run(
                perf.id,
                perf.songId,
                perf.musicFingerprint ?? null,
                perf.name.trim() || perf.id,
                perf.author?.trim() || null,
                perf.description?.trim() || null,
                JSON.stringify(perf.cues),
                JSON.stringify(requiredEffects),
                perf.origin?.kind ?? "user",
                perf.origin?.id ?? null,
                now,
                now,
            );
        this.bumpCatalogVersion();
        return this.getPerformance(perf.id)!;
    }

    private upsertPerformanceForSong(
        songId: string,
        musicFingerprint: string,
        cues: readonly PerformanceCue[],
        origin: ContentOrigin,
        meta?: SaveSongOptions["performanceMeta"],
    ): void {
        const baseBytes = this.getPbe3(songId);
        const existing = this.listSongPerformances(songId, true);
        const targetId = meta?.id?.trim() || defaultPerformanceId(songId);
        const byId = existing.find((item) => item.id === targetId);
        if (byId) {
            if (baseBytes && byId.cues && sameSongPerformance(baseBytes, byId.cues, cues)) return;
            this.savePerformance({
                id: targetId,
                songId,
                musicFingerprint,
                name: meta?.name ?? byId.name,
                author: meta?.author ?? byId.author,
                description: meta?.description ?? byId.description,
                cues,
                origin,
            });
            return;
        }
        if (baseBytes && existing.some((item) => item.cues && sameSongPerformance(baseBytes, item.cues, cues))) {
            return;
        }
        this.savePerformance({
            id: targetId,
            songId,
            musicFingerprint,
            name: meta?.name ?? "默认演出",
            author: meta?.author,
            description: meta?.description,
            cues,
            origin,
        });
    }

    deletePerformance(perfId: string): boolean {
        const res = this.db.query(`DELETE FROM performances WHERE id=?`).run(perfId);
        if (res.changes > 0) this.bumpCatalogVersion();
        return res.changes > 0;
    }

    /* ================== Plugin Cleanup & Queries ================== */

    listPluginRows(): PluginRow[] {
        return this.db.query(`SELECT * FROM plugins ORDER BY installed_at, rowid`).all() as PluginRow[];
    }

    getPluginRow(id: string): PluginRow | undefined {
        const row = this.db.query(`SELECT * FROM plugins WHERE id=?`).get(id) as PluginRow | null;
        return row ?? undefined;
    }

    upsertPluginRow(row: Omit<PluginRow, "installed_at" | "updated_at">): void {
        const now = Date.now();
        this.db
            .query(
                `INSERT INTO plugins(id,name,version,manifest_json,size,source,enabled,trusted,has_code,installed_at,updated_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name,
                     version=excluded.version,
                     manifest_json=excluded.manifest_json,
                     size=excluded.size,
                     source=excluded.source,
                     enabled=excluded.enabled,
                     trusted=excluded.trusted,
                     has_code=excluded.has_code,
                     updated_at=excluded.updated_at`,
            )
            .run(
                row.id,
                row.name,
                row.version,
                row.manifest_json,
                row.size,
                row.source,
                row.enabled,
                row.trusted,
                row.has_code,
                now,
                now,
            );
    }

    setPluginFlags(id: string, flags: { enabled?: boolean; trusted?: boolean }): boolean {
        const current = this.getPluginRow(id);
        if (!current) return false;
        this.db
            .query(`UPDATE plugins SET enabled=?, trusted=?, updated_at=? WHERE id=?`)
            .run(
                flags.enabled !== undefined ? (flags.enabled ? 1 : 0) : current.enabled,
                flags.trusted !== undefined ? (flags.trusted ? 1 : 0) : current.trusted,
                Date.now(),
                id,
            );
        return true;
    }

    deletePluginData(pluginId: string): void {
        // 1. 删除插件贡献的演出
        this.db
            .query(`DELETE FROM performances WHERE origin_kind='plugin' AND origin_id=?`)
            .run(pluginId);

        // 2. 删除插件曲库及其成员关系
        const libs = this.db
            .query(`SELECT id FROM libraries WHERE kind='plugin' AND plugin_id=?`)
            .all(pluginId) as { id: string }[];
        for (const lib of libs) {
            this.db.query(`DELETE FROM library_songs WHERE library_id=?`).run(lib.id);
            this.db.query(`DELETE FROM libraries WHERE id=?`).run(lib.id);
        }

        // 3. 删除仅由该插件提供且未加入其他曲库的歌曲（仍在用户/服务器曲库或其他插件中的歌曲继续保留）
        const candidates = this.db
            .query(`SELECT id FROM songs WHERE origin_kind='plugin' AND origin_id=?`)
            .all(pluginId) as { id: string }[];
        for (const song of candidates) {
            const refCount = this.db
                .query(`SELECT COUNT(*) AS cnt FROM library_songs WHERE song_id=?`)
                .get(song.id) as { cnt: number };
            if (refCount.cnt === 0) {
                this.remove(song.id);
            }
        }

        this.db.query(`DELETE FROM plugins WHERE id=?`).run(pluginId);
        this.bumpCatalogVersion();
    }
}

function countNotes(song: MidiSong): number {
    return song.tracks.reduce((sum, t) => sum + Math.floor((t.notes?.length ?? 0) / 4), 0);
}
