import {
    PLAIN_PERFORMANCE_ID,
    compilePerformanceSource,
    computeMusicFingerprint,
    encodeSong,
    extractCueEffects,
    planImportChunks,
    readSongHeader,
    sameSongMusic,
    type LibraryRecord,
    type MidiSongMeta,
    type PerformanceCue,
    type PerformanceDescriptor,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import { pluginHasExecutableCode } from "@piano/vfx";
import { readPbePluginArchive, type PbePluginArchive } from "@piano/vfx/package";
import { unzipSync } from "fflate";
import {
    assembleAddonBlob,
    checkPluginUninstall,
    loadAddonTemplate,
    matchSongsToPlugins,
    packLibraryAsPlugin,
    resolvePluginDependencies,
    type AssemblySongEntry,
    type LoadedTimbrePack,
    type PluginCatalogEntry,
    type TemplateInfo,
    type TimbreIndexEntry,
} from "@piano/assembly";
import { loadTimbreIndex, loadTimbrePack } from "./timbres";
import { importScorePack, type ScoreEntry } from "../scores/scores";
import type {
    OfficialCatalog,
    OfficialCollection,
    StudioPlugin,
    StudioSong,
} from "./types";

const DB_NAME = "pianobe-studio-v1";
const DB_VERSION = 1;
const STORE_SONGS = "songs";
const STORE_LIBRARIES = "libraries";
const STORE_PLUGINS = "plugins";
const STORE_META = "meta";

const LEGACY_GEN_DB = "pianobe-generator";
const LEGACY_PLUGIN_DB = "pianobe-generator-plugins";

interface StoredLocalSong {
    id: string;
    name: string;
    duration: number;
    noteCount: number;
    data: Uint8Array;
    aliases?: string[];
    libraries?: string[];
    performanceEntries?: PerformanceDescriptor[];
    musicFingerprint?: string;
    addedAt: number;
}

interface StoredLocalPlugin {
    id: string;
    bytes: Uint8Array;
    source: "local" | "song";
    enabled: boolean;
    trusted: boolean;
    songSourceName?: string;
}

function openStudioDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_SONGS)) {
                db.createObjectStore(STORE_SONGS, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_LIBRARIES)) {
                db.createObjectStore(STORE_LIBRARIES, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_PLUGINS)) {
                db.createObjectStore(STORE_PLUGINS, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
    const db = await openStudioDb();
    try {
        return await new Promise<T[]>((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve((req.result ?? []) as T[]);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
    await idbPutMany(storeName, [value]);
}

async function idbPutMany<T>(storeName: string, values: readonly T[]): Promise<void> {
    if (values.length === 0) return;
    const db = await openStudioDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            for (const value of values) store.put(value);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
    const db = await openStudioDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

async function idbGetMeta<T>(key: string): Promise<T | undefined> {
    const db = await openStudioDb();
    try {
        return await new Promise<T | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_META, "readonly");
            const req = tx.objectStore(STORE_META).get(key);
            req.onsuccess = () => resolve((req.result as { value: T } | undefined)?.value);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

async function readLegacyStore<T>(dbName: string, storeName: string): Promise<T[]> {
    try {
        const list = await new Promise<T[]>((resolve) => {
            const req = indexedDB.open(dbName);
            req.onupgradeneeded = () => {
                // 没有旧库时不保留新建空库
                req.transaction?.abort();
            };
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.close();
                    resolve([]);
                    return;
                }
                const tx = db.transaction(storeName, "readonly");
                const getAll = tx.objectStore(storeName).getAll();
                getAll.onsuccess = () => {
                    db.close();
                    resolve((getAll.result ?? []) as T[]);
                };
                getAll.onerror = () => {
                    db.close();
                    resolve([]);
                };
            };
            req.onerror = () => resolve([]);
        });
        return list;
    } catch {
        return [];
    }
}

export async function migrateLegacyGeneratorIfNeeded(): Promise<void> {
    const done = await idbGetMeta<boolean>("migrated_legacy_v1");
    if (done) return;

    const existingSongs = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    if (existingSongs.length === 0) {
        const legacySongs = await readLegacyStore<{
            id: string;
            name: string;
            duration: number;
            noteCount: number;
            data: Uint8Array;
        }>(LEGACY_GEN_DB, "songs");
        for (const s of legacySongs) {
            if (!s?.id || !(s.data instanceof Uint8Array)) continue;
            await idbPut<StoredLocalSong>(STORE_SONGS, {
                id: s.id,
                name: s.name,
                duration: s.duration,
                noteCount: s.noteCount,
                data: s.data,
                musicFingerprint: computeMusicFingerprint(s.data),
                libraries: ["user-default"],
                addedAt: Date.now(),
            });
        }
    }

    const existingPlugins = await idbGetAll<StoredLocalPlugin>(STORE_PLUGINS);
    if (existingPlugins.length === 0) {
        const legacyPlugins = await readLegacyStore<{
            id: string;
            bytes: Uint8Array;
            source?: "local" | "song";
            trusted?: boolean;
            songSourceName?: string;
        }>(LEGACY_PLUGIN_DB, "plugins");
        for (const p of legacyPlugins) {
            if (!p?.id || !(p.bytes instanceof Uint8Array)) continue;
            await idbPut<StoredLocalPlugin>(STORE_PLUGINS, {
                id: p.id,
                bytes: p.bytes,
                source: p.source ?? "local",
                enabled: Boolean(p.trusted),
                trusted: Boolean(p.trusted),
                songSourceName: p.songSourceName,
            });
        }
    }

    const existingLibs = await idbGetAll<LibraryRecord>(STORE_LIBRARIES);
    if (existingLibs.length === 0) {
        await idbPut<LibraryRecord>(STORE_LIBRARIES, {
            id: "user-default",
            name: "默认曲库",
            description: "本地自定义与导入曲目",
            kind: "user",
            songIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }

    await idbPut(STORE_META, { key: "migrated_legacy_v1", value: true });
}

function previewToDataUrl(archive: PbePluginArchive): string | undefined {
    const thumb = archive.manifest.preview?.thumbnail;
    const entry =
        (thumb ? [thumb, archive.previews.get(thumb)] as const : undefined) ??
        [...archive.previews.entries()][0];
    if (!entry?.[1]) return undefined;
    const [filePath, bytes] = entry;
    const lower = filePath.toLowerCase();
    const mime = lower.endsWith(".webp")
        ? "image/webp"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png";
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:${mime};base64,${btoa(bin)}`;
}

export function archiveToStudioPlugin(
    archive: PbePluginArchive,
    opts: {
        source: StudioPlugin["source"];
        enabled: boolean;
        trusted: boolean;
        songSourceName?: string;
        bytes?: Uint8Array;
    },
): StudioPlugin {
    return {
        id: archive.manifest.id,
        name: archive.manifest.name,
        version: archive.manifest.version,
        author: archive.manifest.author,
        description: archive.manifest.preview?.description ?? "",
        license: archive.manifest.license,
        source: opts.source,
        visibility: archive.manifest.visibility ?? "public",
        enabled: opts.enabled,
        trusted: opts.trusted,
        hasExecutableCode: archive.hasExecutableCode || pluginHasExecutableCode({
            manifest: archive.manifest,
            vfxEntryJs: archive.vfxEntryJs,
            files: archive.files,
        }),
        compatible: true,
        sizeBytes: opts.bytes?.byteLength ?? archive.size,
        previewDataUrl: previewToDataUrl(archive),
        dependencies: (archive.manifest.dependencies ?? []).map((id) => ({ id })),
        provides: archive.manifest.provides as Record<string, string[] | undefined>,
        status: opts.enabled ? "active" : "unavailable",
        songSourceName: opts.songSourceName,
        archive,
    };
}

export async function loadBuiltinPlugins(): Promise<StudioPlugin[]> {
    builtinPluginsCache ??= loadBuiltinPluginsUncached();
    return builtinPluginsCache;
}

let builtinPluginsCache: Promise<StudioPlugin[]> | null = null;

async function loadBuiltinPluginsUncached(): Promise<StudioPlugin[]> {
    try {
        const res = await fetch("./plugins/index.json");
        if (!res.ok) return [];
        const entries = (await res.json()) as Array<{
            id: string;
            file: string;
        }>;
        const out: StudioPlugin[] = [];
        for (const item of entries) {
            try {
                const pkgRes = await fetch(`./plugins/${item.file}`);
                if (!pkgRes.ok) continue;
                const bytes = new Uint8Array(await pkgRes.arrayBuffer());
                const archive = readPbePluginArchive(bytes);
                out.push(
                    archiveToStudioPlugin(archive, {
                        source: "builtin",
                        enabled: true,
                        trusted: true,
                        bytes,
                    }),
                );
            } catch {
                // 跳过损坏包
            }
        }
        return out;
    } catch {
        return [];
    }
}

export async function loadOfficialCatalog(): Promise<OfficialCatalog | null> {
    try {
        const [indexRes, catalogRes] = await Promise.all([
            fetch("./library/index.json"),
            fetch("./library/catalog.json"),
        ]);
        if (!indexRes.ok) return null;
        const songs = (await indexRes.json()) as OfficialCatalog["songs"];
        if (!catalogRes.ok) {
            return {
                version: 1,
                totalSongs: songs.length,
                collections: [
                    {
                        id: "official-all",
                        name: "在线曲库",
                        description: "全部在线曲目",
                        songIds: songs.map((s) => s.id),
                    },
                ],
                performances: {},
                songs,
            };
        }
        const catalog = (await catalogRes.json()) as {
            version: number;
            totalSongs: number;
            collections: OfficialCollection[];
            performances: Record<string, PerformanceDescriptor[]>;
        };
        return {
            ...catalog,
            songs,
        };
    } catch {
        return null;
    }
}

export async function fetchOfficialSongBytes(songId: string): Promise<Uint8Array> {
    const res = await fetch(`./library/${encodeURIComponent(songId)}.pbe3`);
    if (!res.ok) throw new Error(`获取曲目失败 (${songId}: ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
}

export async function fetchOfficialPerformanceCues(songId: string): Promise<PerformanceCue[] | null> {
    try {
        const res = await fetch(`./performances/${encodeURIComponent(songId)}.json`);
        if (!res.ok) return null;
        const data = (await res.json()) as {
            cues?: unknown;
            sections?: unknown;
        };
        return compilePerformanceSource(data, { expectedSongId: songId });
    } catch {
        return null;
    }
}

/**
 * 在线曲库单文件包（sync 时生成）：一次下载整库，避免整库导入时逐曲请求。
 */
let officialPackCache: Promise<Map<string, Uint8Array> | null> | null = null;

export function loadOfficialLibraryPack(): Promise<Map<string, Uint8Array> | null> {
    officialPackCache ??= (async () => {
        try {
            const res = await fetch("./library/official.pack.zip");
            if (!res.ok) return null;
            const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
            const songs = new Map<string, Uint8Array>();
            for (const [name, data] of Object.entries(files)) {
                if (!name.toLowerCase().endsWith(".pbe3")) continue;
                const id = name.split("/").pop()!.replace(/\.pbe3$/i, "");
                songs.set(id, data);
            }
            return songs.size > 0 ? songs : null;
        } catch {
            return null;
        }
    })();
    return officialPackCache;
}

export async function loadDefaultTemplate(): Promise<TemplateInfo> {
    const res = await fetch("./template.mcaddon");
    if (!res.ok) throw new Error(`无法加载内置模板 (${res.status})`);
    const blob = await res.blob();
    return loadAddonTemplate(blob);
}

function buildPerformanceDescriptors(
    songId: string,
    fp: string,
    bytes: Uint8Array,
    existing?: PerformanceDescriptor[],
): PerformanceDescriptor[] {
    const header = readSongHeader(bytes);
    const list: PerformanceDescriptor[] = existing ? [...existing] : [];
    const seen = new Set(list.map((p) => p.id));

    if (header.performance && header.performance.length > 0) {
        const id = `embedded:${songId}`;
        if (!seen.has(id)) {
            seen.add(id);
            list.push({
                id,
                name: header.name ? `${header.name} · 默认演出` : "默认演出",
                songId,
                musicFingerprint: fp,
                cues: header.performance,
                requiredEffects: extractCueEffects(header.performance),
                origin: { kind: "embedded", id: songId, name: "PBE3 内嵌" },
            });
        }
    }

    if (!seen.has(PLAIN_PERFORMANCE_ID)) {
        list.unshift({
            id: PLAIN_PERFORMANCE_ID,
            name: "普通演奏",
            songId,
            musicFingerprint: fp,
            requiredEffects: [],
            origin: { kind: "user", name: "纯音乐" },
        });
    }

    return list;
}

export async function loadLocalState(officialCatalog: OfficialCatalog | null): Promise<{
    songs: StudioSong[];
    libraries: LibraryRecord[];
    plugins: StudioPlugin[];
}> {
    await migrateLegacyGeneratorIfNeeded();
    const [storedSongs, storedLibs, storedPlugins, builtins] = await Promise.all([
        idbGetAll<StoredLocalSong>(STORE_SONGS),
        idbGetAll<LibraryRecord>(STORE_LIBRARIES),
        idbGetAll<StoredLocalPlugin>(STORE_PLUGINS),
        loadBuiltinPlugins(),
    ]);

    const pluginMap = new Map<string, StudioPlugin>();
    for (const b of builtins) pluginMap.set(b.id, b);

    const pluginSongs: StudioSong[] = [];
    const pluginLibs: LibraryRecord[] = [];

    for (const sp of storedPlugins) {
        try {
            const archive = readPbePluginArchive(sp.bytes);
            const p = archiveToStudioPlugin(archive, {
                source: sp.source,
                enabled: sp.enabled,
                trusted: sp.trusted,
                songSourceName: sp.songSourceName,
                bytes: sp.bytes,
            });
            pluginMap.set(p.id, p);

            if (p.enabled) {
                for (const ps of archive.songs.values()) {
                    const fp = ps.musicFingerprint || computeMusicFingerprint(ps.bytes);
                    pluginSongs.push({
                        id: ps.id,
                        name: ps.name,
                        duration: ps.duration,
                        noteCount: ps.noteCount,
                        bytes: ps.bytes.byteLength,
                        musicFingerprint: fp,
                        libraries: [`plugin:${p.id}`],
                        origin: { kind: "plugin", id: p.id, name: p.name },
                        origins: [{ kind: "plugin", id: p.id, name: p.name }],
                        performanceEntries: buildPerformanceDescriptors(ps.id, fp, ps.bytes),
                        data: ps.bytes,
                    });
                }
                for (const pl of archive.libraries) {
                    pluginLibs.push({
                        id: pl.id,
                        name: pl.name,
                        description: pl.description,
                        author: pl.author ?? p.author,
                        kind: "plugin",
                        pluginId: p.id,
                        songIds: [...pl.songs],
                        readonly: true,
                    });
                }
            }
        } catch {
            // 忽略损坏的本地插件记录
        }
    }

    // 把 catalog 中的演出元数据挂上对应插件归属
    const plugins = [...pluginMap.values()];

    // 将 StoredLocalSong 与启用插件带来的 songs 合并（按指纹复用/叠加演出）
    const byId = new Map<string, StudioSong>();
    const byFp = new Map<string, StudioSong>();

    for (const s of storedSongs) {
        const fp = s.musicFingerprint ?? computeMusicFingerprint(s.data);
        const entry: StudioSong = {
            id: s.id,
            name: s.name,
            duration: s.duration,
            noteCount: s.noteCount,
            bytes: s.data.byteLength,
            musicFingerprint: fp,
            aliases: s.aliases ?? [],
            libraries: s.libraries ?? ["user-default"],
            origin: { kind: "user", name: "本地曲库" },
            origins: [{ kind: "user", name: "本地曲库" }],
            performanceEntries: buildPerformanceDescriptors(
                s.id,
                fp,
                s.data,
                s.performanceEntries ?? officialCatalog?.performances[s.id],
            ),
            addedAt: s.addedAt,
            data: s.data,
        };
        byId.set(entry.id, entry);
        byFp.set(fp, entry);
    }

    for (const ps of pluginSongs) {
        const fp = ps.musicFingerprint!;
        const match = byId.get(ps.id) ?? byFp.get(fp);
        if (match && match.data && ps.data && sameSongMusic(match.data, ps.data)) {
            if (ps.name !== match.name) {
                match.aliases = [...new Set([...(match.aliases ?? []), ps.name])];
            }
            match.libraries = [...new Set([...(match.libraries ?? []), ...(ps.libraries ?? [])])];
            match.origins = [...(match.origins ?? []), ...(ps.origins ?? [])];
            const existingPerfIds = new Set(match.performanceEntries.map((p) => p.id));
            for (const perf of ps.performanceEntries) {
                if (!existingPerfIds.has(perf.id)) {
                    existingPerfIds.add(perf.id);
                    match.performanceEntries.push(perf);
                }
            }
        } else if (!byId.has(ps.id)) {
            byId.set(ps.id, ps);
            byFp.set(fp, ps);
        }
    }

    // 也把来自启用插件 performaces 目录中的演出附加到对应曲目
    for (const p of plugins) {
        if (!p.enabled || !p.archive) continue;
        for (const perf of p.archive.performances) {
            const target =
                (perf.songId ? byId.get(perf.songId) : undefined) ??
                (perf.musicFingerprint ? byFp.get(perf.musicFingerprint) : undefined);
            if (!target) continue;
            if (target.performanceEntries.some((item) => item.id === perf.id)) continue;
            target.performanceEntries.push({
                id: perf.id,
                name: perf.name,
                author: perf.author ?? p.author,
                description: perf.description,
                songId: target.id,
                musicFingerprint: perf.musicFingerprint ?? target.musicFingerprint,
                cues: perf.cues,
                requiredEffects: extractCueEffects(perf.cues),
                origin: { kind: "plugin", id: p.id, name: p.name },
            });
        }
    }

    const libraries: LibraryRecord[] = [
        ...storedLibs.map((lib) =>
            lib.id === "user-default" && lib.name === "我的曲库"
                ? { ...lib, name: "默认曲库" }
                : lib,
        ),
        ...pluginLibs,
    ];
    if (libraries.length === 0) {
        libraries.push({
            id: "user-default",
            name: "默认曲库",
            kind: "user",
            songIds: [],
        });
    }

    return {
        songs: [...byId.values()].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)),
        libraries,
        plugins,
    };
}

export interface LocalSongBulkItem {
    fileName: string;
    bytes: Uint8Array;
}

export interface LocalSongBulkResult {
    added: number;
    merged: number;
    conflicts: string[];
    mergedTitles: string[];
}

/**
 * 批量写入本地曲库：只读取一次现有记录、复用指纹与合并逻辑，并在单个事务中落盘。
 * 整库导入（数百首）时避免逐曲 `getAll` 造成的 O(n²) 结构化克隆。
 */
export async function saveLocalSongsBulk(
    items: readonly LocalSongBulkItem[],
    libraryId?: string,
): Promise<LocalSongBulkResult> {
    const result: LocalSongBulkResult = { added: 0, merged: 0, conflicts: [], mergedTitles: [] };
    if (items.length === 0) return result;

    const existing = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const byId = new Map(existing.map((s) => [s.id, s]));
    const byFp = new Map<string, StoredLocalSong>();
    for (const song of existing) {
        byFp.set(song.musicFingerprint ?? computeMusicFingerprint(song.data), song);
    }
    const dirty = new Map<string, StoredLocalSong>();

    for (const item of items) {
        const cleanName = item.fileName.replace(/\.(mid|midi|pbe3)$/i, "").trim() || "未命名曲目";
        const isPbe3 = item.fileName.toLowerCase().endsWith(".pbe3") ||
            (item.bytes.length >= 4 &&
                item.bytes[0] === 0x50 &&
                item.bytes[1] === 0x42 &&
                item.bytes[2] === 0x45 &&
                item.bytes[3] === 0x33);
        const pbe3 = isPbe3 ? item.bytes : encodeSong(midiBufferToSong(item.bytes, cleanName));
        const header = readSongHeader(pbe3);
        const fp = computeMusicFingerprint(pbe3);

        const sameId = byId.get(header.id);
        if (sameId && !sameSongMusic(sameId.data, pbe3)) {
            result.conflicts.push(cleanName);
            continue;
        }

        const target = sameId ?? byFp.get(fp);
        if (target) {
            const libs = new Set(target.libraries ?? ["user-default"]);
            if (libraryId) libs.add(libraryId);
            const aliases = new Set(target.aliases ?? []);
            if (header.name && header.name !== target.name) aliases.add(header.name);
            const updated: StoredLocalSong = {
                ...target,
                libraries: [...libs],
                aliases: [...aliases],
                performanceEntries: buildPerformanceDescriptors(
                    target.id,
                    fp,
                    pbe3,
                    target.performanceEntries,
                ),
            };
            dirty.set(updated.id, updated);
            byId.set(updated.id, updated);
            byFp.set(fp, updated);
            result.merged++;
            result.mergedTitles.push(target.name);
            continue;
        }

        const record: StoredLocalSong = {
            id: header.id,
            name: header.name || cleanName,
            duration: header.duration,
            noteCount: header.noteCount,
            data: pbe3,
            musicFingerprint: fp,
            libraries: [libraryId || "user-default"],
            performanceEntries: buildPerformanceDescriptors(header.id, fp, pbe3),
            addedAt: Date.now(),
        };
        dirty.set(record.id, record);
        byId.set(record.id, record);
        byFp.set(fp, record);
        result.added++;
    }

    await idbPutMany(STORE_SONGS, [...dirty.values()]);
    return result;
}

export async function saveLocalSongBytes(
    fileName: string,
    bytes: Uint8Array,
    libraryId?: string,
): Promise<{ status: "added" | "merged" | "conflict"; song?: StudioSong; message?: string }> {
    const res = await saveLocalSongsBulk([{ fileName, bytes }], libraryId);
    if (res.conflicts.length > 0) {
        return {
            status: "conflict",
            message: "曲目 ID 已存在且音乐内容不一致，已阻止静默覆盖",
        };
    }
    if (res.merged > 0) {
        return {
            status: "merged",
            message: `检测到相同音乐本体，已合并到「${res.mergedTitles[0] ?? ""}」`,
        };
    }
    return { status: "added" };
}

export async function renameLocalSong(songId: string, name: string): Promise<void> {
    const all = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const hit = all.find((s) => s.id === songId);
    if (!hit) throw new Error("仅用户本地保存的曲目支持重命名");
    await idbPut(STORE_SONGS, { ...hit, name: name.trim() || hit.name });
}

export async function deleteLocalSong(songId: string): Promise<void> {
    const libraries = await idbGetAll<LibraryRecord>(STORE_LIBRARIES);
    const dirty = libraries
        .filter((lib) => lib.songIds.includes(songId))
        .map((lib) => ({
            ...lib,
            songIds: lib.songIds.filter((id) => id !== songId),
            updatedAt: Date.now(),
        }));
    await idbPutMany(STORE_LIBRARIES, dirty);
    await idbDelete(STORE_SONGS, songId);
}

export async function saveLocalLibrary(lib: LibraryRecord): Promise<void> {
    await idbPut(STORE_LIBRARIES, { ...lib, updatedAt: Date.now() });
}

export async function deleteLocalLibrary(libraryId: string): Promise<void> {
    if (libraryId === "user-default") throw new Error("默认曲库不能删除");
    await idbDelete(STORE_LIBRARIES, libraryId);
    const songs = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const dirty = songs
        .filter((s) => s.libraries?.includes(libraryId))
        .map((s) => ({
            ...s,
            libraries: s.libraries!.filter((id) => id !== libraryId),
        }));
    await idbPutMany(STORE_SONGS, dirty);
}

export async function addSongsToLocalLibrary(libraryId: string, songIds: string[]): Promise<void> {
    const idSet = new Set(songIds);
    const songs = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const dirty = songs
        .filter((s) => idSet.has(s.id))
        .map((s) => ({ ...s, libraries: [...new Set([...(s.libraries ?? []), libraryId])] }));
    await idbPutMany(STORE_SONGS, dirty);
}

export async function installLocalPluginBytes(
    bytes: Uint8Array,
    source: "local" | "song",
    trusted: boolean,
    songSourceName?: string,
): Promise<StudioPlugin> {
    const archive = readPbePluginArchive(bytes);
    await idbPut<StoredLocalPlugin>(STORE_PLUGINS, {
        id: archive.manifest.id,
        bytes,
        source,
        enabled: trusted,
        trusted,
        songSourceName,
    });
    return archiveToStudioPlugin(archive, {
        source,
        enabled: trusted,
        trusted,
        songSourceName,
        bytes,
    });
}

export async function trustLocalPlugin(pluginId: string): Promise<void> {
    const all = await idbGetAll<StoredLocalPlugin>(STORE_PLUGINS);
    const hit = all.find((p) => p.id === pluginId);
    if (!hit) return;
    await idbPut(STORE_PLUGINS, { ...hit, trusted: true, enabled: true });
}

export async function setLocalPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const all = await idbGetAll<StoredLocalPlugin>(STORE_PLUGINS);
    const hit = all.find((p) => p.id === pluginId);
    if (hit) {
        await idbPut(STORE_PLUGINS, { ...hit, enabled });
    }
}

export async function uninstallLocalPlugin(pluginId: string, allPlugins: StudioPlugin[]): Promise<void> {
    const enabled = allPlugins
        .filter((p) => p.enabled && p.archive)
        .map((p) => ({ id: p.id, manifest: p.archive!.manifest }));
    const res = checkPluginUninstall(pluginId, enabled);
    if (!res.ok) throw new Error(res.message);
    await idbDelete(STORE_PLUGINS, pluginId);
}

export function exportLocalLibraryPlugin(
    library: LibraryRecord,
    songs: StudioSong[],
): { blob: Blob; filename: string } {
    const items = songs
        .filter((s) => s.data && (library.songIds.includes(s.id) || s.libraries?.includes(library.id)))
        .map((s) => ({
            id: s.id,
            name: s.name,
            bytes: s.data!,
            performances: s.performanceEntries
                .filter((p) => p.id !== PLAIN_PERFORMANCE_ID && p.cues && p.cues.length > 0)
                .map((p) => ({
                    id: p.id,
                    name: p.name,
                    author: p.author,
                    description: p.description,
                    cues: p.cues!,
                })),
        }));
    const { bytes, manifest } = packLibraryAsPlugin({
        libraryId: library.id,
        name: library.name,
        description: library.description,
        songs: items,
    });
    return {
        blob: new Blob([bytes.slice().buffer], { type: "application/octet-stream" }),
        filename: `${manifest.id}.pbeplugin`,
    };
}

export async function exportLocalAddon(params: {
    template: TemplateInfo;
    songs: StudioSong[];
    plugins: StudioPlugin[];
    selectedPluginIds: string[];
    timbreIds: string[];
    timbreIndex: TimbreIndexEntry[];
    scores: ScoreEntry[];
    name: string;
    desc: string;
    randomUuid: boolean;
}): Promise<Blob> {
    const catalog: PluginCatalogEntry[] = params.plugins
        .filter((p) => p.archive)
        .map((p) => ({
            id: p.id,
            manifest: p.archive!.manifest,
            trusted: p.trusted,
            enabled: p.enabled,
            compatible: p.compatible,
            archive: p.archive,
        }));
    const depRes = resolvePluginDependencies(params.selectedPluginIds, catalog);
    if (depRes.missingDependencies.length > 0) {
        throw new Error(`缺少插件依赖：${depRes.missingDependencies.map((d) => d.dependencyId).join("、")}`);
    }
    const archives = depRes.resolvedIds
        .map((id) => params.plugins.find((p) => p.id === id)?.archive)
        .filter((a): a is PbePluginArchive => Boolean(a));

    const optionalPacks: LoadedTimbrePack[] = [];
    for (const meta of params.timbreIndex) {
        if (!meta.bundled && params.timbreIds.includes(meta.id)) {
            optionalPacks.push(await loadTimbrePack(meta));
        }
    }

    const assemblySongs: AssemblySongEntry[] = params.songs
        .filter((s) => s.data)
        .map((s) => ({
            id: s.id,
            name: s.name,
            duration: s.duration,
            noteCount: s.noteCount,
            bytes: s.data!.byteLength,
            libraries: s.libraries,
            performanceEntries: s.performanceEntries,
            data: s.data,
        }));

    return assembleAddonBlob(params.template, assemblySongs, {
        name: params.name,
        desc: params.desc,
        randomUuid: params.randomUuid,
        plugins: archives,
        timbres: {
            all: params.timbreIndex,
            selected: optionalPacks,
            enabledIds: params.timbreIds,
        },
        scores: params.scores,
        embedSongs: true,
    });
}

export async function importScoresFromArchiveFile(file: File, existing: readonly ScoreEntry[] = []): Promise<ScoreEntry[]> {
    return importScorePack(file, existing);
}

export function computeLocalSongPluginMatch(
    songs: StudioSong[],
    plugins: StudioPlugin[],
    selectedPluginIds: string[],
) {
    const assemblySongs: AssemblySongEntry[] = songs.map((s) => ({
        id: s.id,
        name: s.name,
        duration: s.duration,
        noteCount: s.noteCount,
        bytes: s.bytes,
        performanceEntries: s.performanceEntries,
        data: s.data,
    }));
    const catalog: PluginCatalogEntry[] = plugins
        .filter((p) => p.archive)
        .map((p) => ({
            id: p.id,
            manifest: p.archive!.manifest,
            trusted: p.trusted,
            enabled: p.enabled,
            compatible: p.compatible,
            archive: p.archive,
        }));
    return matchSongsToPlugins(assemblySongs, catalog, selectedPluginIds);
}

export function getLocalImportCode(song: StudioSong): { name: string; chunks: string[]; bytes: number } {
    if (!song.data) throw new Error("该曲目暂无本地 PBE3 数据");
    const chunks = planImportChunks(song.data);
    return {
        name: song.name,
        chunks,
        bytes: song.data.byteLength,
    };
}

export { loadTimbreIndex };
export type { MetaWithStats };
type MetaWithStats = MidiSongMeta;
