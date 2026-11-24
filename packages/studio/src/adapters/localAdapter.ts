import {
    PLAIN_PERFORMANCE_ID,
    compilePerformanceSource,
    computeMusicFingerprint,
    encodeSong,
    extractCueEffects,
    mergeSongCatalog,
    planImportChunks,
    readSongHeader,
    rebuildContentIndex,
    type ContentIndexSource,
    type LibraryRecord,
    type PerformanceCue,
    type PerformanceDescriptor,
} from "@piano/core";
import { midiBufferToSong } from "@piano/core/convert";
import { isApiVersionCompatible, pluginHasExecutableCode, VFX_API_VERSION, type VfxPluginManifest } from "@piano/vfx";
import { readPbePluginArchive, type PbePluginArchive } from "@piano/vfx/package";
import {
    assembleAddonBlob,
    checkPluginUninstall,
    loadAddonTemplate,
    matchSongsToPlugins,
    packLibraryAsPlugin,
    resolvePluginDependencies,
    type AssemblySongEntry,
    type PluginCatalogEntry,
    type TemplateInfo,
} from "@piano/assembly";
import { importScorePack, type ScoreEntry } from "../scores/scores";
import type {
    PluginContentCounts,
    PluginTimbreMeta,
    StudioPlugin,
    StudioSong,
    UserPerformanceRecord,
} from "./types";

const DB_NAME = "pianobe-studio-v1";
const DB_VERSION = 2;
const STORE_SONGS = "songs";
const STORE_LIBRARIES = "libraries";
const STORE_PLUGINS = "plugins";
const STORE_PERFORMANCES = "performances";
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
    source: "builtin" | "local" | "song";
    enabled: boolean;
    trusted: boolean;
    songSourceName?: string;
}

export interface BuiltinPluginIndexItem {
    id: string;
    file: string;
    size: number;
    source: "builtin";
    hasExecutableCode: boolean;
    manifest: VfxPluginManifest;
    contents: PluginContentCounts;
    timbreEntries?: PluginTimbreMeta[];
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
            if (!db.objectStoreNames.contains(STORE_PERFORMANCES)) {
                db.createObjectStore(STORE_PERFORMANCES, { keyPath: "id" });
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
        return await new Promise<T[]>((resolve) => {
            const req = indexedDB.open(dbName);
            req.onupgradeneeded = () => {
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
        const toPut: StoredLocalSong[] = [];
        for (const s of legacySongs) {
            if (!s?.id || !(s.data instanceof Uint8Array)) continue;
            toPut.push({
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
        await idbPutMany(STORE_SONGS, toPut);
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
        const toPut: StoredLocalPlugin[] = [];
        for (const p of legacyPlugins) {
            if (!p?.id || !(p.bytes instanceof Uint8Array)) continue;
            toPut.push({
                id: p.id,
                bytes: p.bytes,
                source: p.source ?? "local",
                enabled: Boolean(p.trusted),
                trusted: Boolean(p.trusted),
                songSourceName: p.songSourceName,
            });
        }
        await idbPutMany(STORE_PLUGINS, toPut);
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
        (thumb ? ([thumb, archive.previews.get(thumb)] as const) : undefined) ??
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

function summarizeArchiveCounts(archive: PbePluginArchive): PluginContentCounts {
    const p = archive.manifest.provides ?? {};
    return {
        songs: archive.songs.size,
        performances: archive.performances.length,
        libraries: archive.libraries.length,
        timbres: archive.timbres.length,
        effects: p.effects?.length ?? 0,
        themes: p.themes?.length ?? 0,
        keyStyles: p.keyStyles?.length ?? 0,
        particles: p.particles?.length ?? 0,
        stageProps: archive.stageProps.length,
    };
}

function summarizeArchiveTimbres(archive: PbePluginArchive): PluginTimbreMeta[] | undefined {
    if (archive.timbres.length === 0) return undefined;
    return archive.timbres.map(({ soundDefinitions: _defs, ...meta }) => meta);
}

export function archiveToStudioPlugin(
    archive: PbePluginArchive,
    opts: {
        source: StudioPlugin["source"];
        installed?: boolean;
        enabled: boolean;
        trusted: boolean;
        file?: string;
        songSourceName?: string;
        bytes?: Uint8Array;
    },
): StudioPlugin {
    const hasExecutableCode =
        archive.hasExecutableCode ||
        pluginHasExecutableCode({
            manifest: archive.manifest,
            vfxEntryJs: archive.vfxEntryJs,
            files: archive.files,
        });
    const compatible = isApiVersionCompatible(archive.manifest.apiVersion, VFX_API_VERSION);
    const timbreEntries = summarizeArchiveTimbres(archive);
    return {
        id: archive.manifest.id,
        name: archive.manifest.name,
        version: archive.manifest.version,
        author: archive.manifest.author,
        description: archive.manifest.preview?.description ?? "",
        license: archive.manifest.license,
        source: opts.source,
        visibility: archive.manifest.visibility ?? "public",
        installed: opts.installed ?? true,
        enabled: opts.enabled,
        trusted: opts.trusted,
        hasExecutableCode,
        requiresPackDeploy:
            hasExecutableCode ||
            archive.particles.size > 0 ||
            archive.textures.size > 0 ||
            archive.stageProps.length > 0 ||
            archive.timbres.length > 0 ||
            archive.sounds.size > 0,
        compatible,
        ...(!compatible ? { compatibilityNote: `需要 API ${archive.manifest.apiVersion}` } : {}),
        sizeBytes: opts.bytes?.byteLength ?? archive.size,
        ...(opts.file ? { file: opts.file } : {}),
        previewDataUrl: previewToDataUrl(archive),
        dependencies: (archive.manifest.dependencies ?? []).map((id) => ({ id })),
        missingDependencies: [],
        provides: archive.manifest.provides as Record<string, string[] | undefined>,
        contents: summarizeArchiveCounts(archive),
        ...(timbreEntries ? { timbreEntries } : {}),
        status: opts.enabled ? "active" : "unavailable",
        songSourceName: opts.songSourceName,
        archive,
    };
}

function indexItemToUninstalledPlugin(item: BuiltinPluginIndexItem): StudioPlugin {
    const m = item.manifest;
    const compatible = isApiVersionCompatible(m.apiVersion, VFX_API_VERSION);
    const p = m.provides ?? {};
    const contents: PluginContentCounts = item.contents ?? {
        songs: p.songs?.length ?? 0,
        performances: p.performances?.length ?? 0,
        libraries: p.libraries?.length ?? 0,
        timbres: p.timbres?.length ?? 0,
        effects: p.effects?.length ?? 0,
        themes: p.themes?.length ?? 0,
        keyStyles: p.keyStyles?.length ?? 0,
        particles: p.particles?.length ?? 0,
        stageProps: m.stageProps?.length ?? 0,
    };
    return {
        id: m.id,
        name: m.name,
        version: m.version,
        author: m.author,
        description: m.preview?.description ?? "",
        license: m.license,
        source: "builtin",
        visibility: m.visibility ?? "public",
        installed: false,
        enabled: false,
        trusted: true,
        hasExecutableCode: item.hasExecutableCode,
        requiresPackDeploy:
            item.hasExecutableCode ||
            Boolean(contents.particles || contents.stageProps || contents.timbres),
        compatible,
        ...(!compatible ? { compatibilityNote: `需要 API ${m.apiVersion}` } : {}),
        sizeBytes: item.size,
        file: item.file,
        dependencies: (m.dependencies ?? []).map((id) => ({ id })),
        missingDependencies: [],
        provides: p as Record<string, string[] | undefined>,
        contents,
        ...(item.timbreEntries?.length ? { timbreEntries: item.timbreEntries } : {}),
        status: "unavailable",
    };
}

let builtinIndexCache: Promise<BuiltinPluginIndexItem[]> | null = null;
const builtinArchiveCache = new Map<string, Promise<Uint8Array>>();

export function loadBuiltinPluginIndex(): Promise<BuiltinPluginIndexItem[]> {
    builtinIndexCache ??= (async () => {
        try {
            const res = await fetch("./plugins/index.json");
            if (!res.ok) return [];
            return (await res.json()) as BuiltinPluginIndexItem[];
        } catch {
            return [];
        }
    })();
    return builtinIndexCache;
}

export function fetchBuiltinPluginBytes(file: string): Promise<Uint8Array> {
    let pending = builtinArchiveCache.get(file);
    if (!pending) {
        pending = (async () => {
            const res = await fetch(`./plugins/${file}`);
            if (!res.ok) throw new Error(`获取扩展包失败 (${file}: ${res.status})`);
            return new Uint8Array(await res.arrayBuffer());
        })();
        pending.catch(() => builtinArchiveCache.delete(file));
        builtinArchiveCache.set(file, pending);
    }
    return pending;
}

export async function loadDefaultTemplate(): Promise<TemplateInfo> {
    const res = await fetch("./template.mcaddon");
    if (!res.ok) throw new Error(`无法加载内置模板 (${res.status})`);
    const blob = await res.blob();
    return loadAddonTemplate(blob);
}

function buildPlainPerformance(songId: string, fp?: string): PerformanceDescriptor {
    return {
        id: PLAIN_PERFORMANCE_ID,
        name: "普通演奏",
        songId,
        musicFingerprint: fp,
        requiredEffects: [],
        origin: { kind: "user", name: "纯音乐" },
    };
}

function withPlainPerformance(
    songId: string,
    fp: string | undefined,
    list: readonly PerformanceDescriptor[],
): PerformanceDescriptor[] {
    const filtered = list.filter((p) => p.id !== PLAIN_PERFORMANCE_ID);
    return [buildPlainPerformance(songId, fp), ...filtered];
}

export async function loadLocalState(): Promise<{
    songs: StudioSong[];
    libraries: LibraryRecord[];
    plugins: StudioPlugin[];
}> {
    await migrateLegacyGeneratorIfNeeded();
    const [storedSongs, storedLibs, storedPlugins, storedPerfs, builtinIndex] = await Promise.all([
        idbGetAll<StoredLocalSong>(STORE_SONGS),
        idbGetAll<LibraryRecord>(STORE_LIBRARIES),
        idbGetAll<StoredLocalPlugin>(STORE_PLUGINS),
        idbGetAll<UserPerformanceRecord>(STORE_PERFORMANCES),
        loadBuiltinPluginIndex(),
    ]);

    const builtinById = new Map(builtinIndex.map((b) => [b.id, b]));
    const pluginMap = new Map<string, StudioPlugin>();

    for (const item of builtinIndex) {
        pluginMap.set(item.id, indexItemToUninstalledPlugin(item));
    }

    for (const sp of storedPlugins) {
        try {
            const archive = readPbePluginArchive(sp.bytes);
            const builtinMeta = builtinById.get(archive.manifest.id);
            const p = archiveToStudioPlugin(archive, {
                source: builtinMeta ? "builtin" : sp.source,
                installed: true,
                enabled: sp.enabled,
                trusted: sp.trusted,
                file: builtinMeta?.file,
                songSourceName: sp.songSourceName,
                bytes: sp.bytes,
            });
            pluginMap.set(p.id, p);
        } catch {
            // ignore corrupted stored plugin
        }
    }

    const plugins = [...pluginMap.values()];
    const catalogEntries: PluginCatalogEntry[] = plugins
        .filter((p) => p.installed && p.archive)
        .map((p) => ({
            id: p.id,
            manifest: p.archive!.manifest,
            trusted: p.trusted,
            compatible: p.compatible,
            hasExecutableCode: p.hasExecutableCode,
        }));
    for (const p of plugins) {
        if (!p.installed) continue;
        const dep = resolvePluginDependencies([p.id], catalogEntries);
        p.missingDependencies = [
            ...dep.missingDependencies.map((d) => d.dependencyId),
            ...dep.untrustedDependencies.map((d) => d.dependencyId),
        ];
    }

    // 规范化用户曲库
    const normalizedUserLibs: LibraryRecord[] = storedLibs.map((lib) =>
        lib.id === "user-default" && lib.name === "我的曲库"
            ? { ...lib, name: "默认曲库" }
            : lib,
    );
    if (!normalizedUserLibs.some((l) => l.id === "user-default")) {
        normalizedUserLibs.unshift({
            id: "user-default",
            name: "默认曲库",
            description: "本地自定义与导入曲目",
            kind: "user",
            songIds: [],
        });
    }

    // 用户库歌曲候选（纯音乐本体 + 内嵌演出）
    const userSongCandidates: StudioSong[] = storedSongs.map((s) => {
        const fp = s.musicFingerprint ?? computeMusicFingerprint(s.data);
        const header = readSongHeader(s.data);
        const libSet = new Set(s.libraries ?? []);
        for (const ul of normalizedUserLibs) {
            if (ul.songIds.includes(s.id)) libSet.add(ul.id);
        }

        const embeddedPerfs: PerformanceDescriptor[] = [];
        if (header.performance?.length) {
            embeddedPerfs.push({
                id: `embedded:${s.id}`,
                name: header.name ? `${header.name} · 默认演出` : "默认演出",
                songId: s.id,
                musicFingerprint: fp,
                cues: header.performance,
                requiredEffects: extractCueEffects(header.performance),
                origin: { kind: "embedded", id: s.id, name: "PBE3 内嵌" },
            });
        }
        for (const p of s.performanceEntries ?? []) {
            if (p.id !== PLAIN_PERFORMANCE_ID && !embeddedPerfs.some((e) => e.id === p.id)) {
                embeddedPerfs.push(p);
            }
        }

        return {
            id: s.id,
            name: s.name,
            duration: s.duration,
            noteCount: s.noteCount,
            bytes: s.data.byteLength,
            musicFingerprint: fp,
            aliases: s.aliases ?? [],
            libraries: [...libSet],
            origin: { kind: "user", name: "本地曲库" },
            origins: [{ kind: "user", name: "本地曲库" }],
            performanceEntries: embeddedPerfs,
            addedAt: s.addedAt,
            data: s.data,
        };
    });

    // 用户库曲目归属以 STORE_SONGS.libraries 为唯一真相源
    const userLibRecords: LibraryRecord[] = normalizedUserLibs.map((lib) => ({
        ...lib,
        songIds: userSongCandidates
            .filter((s) => s.libraries?.includes(lib.id))
            .map((s) => s.id),
    }));

    const sources: ContentIndexSource<StudioSong>[] = [
        { songs: userSongCandidates, libraries: userLibRecords },
    ];

    for (const p of plugins) {
        if (!p.installed || !p.enabled || !p.archive) continue;
        const archive = p.archive;
        const songLibMap = new Map<string, string[]>();
        for (const pl of archive.libraries) {
            for (const sid of pl.songs) {
                const arr = songLibMap.get(sid) ?? [];
                arr.push(pl.id);
                songLibMap.set(sid, arr);
            }
        }

        const pSongs: StudioSong[] = [];
        for (const ps of archive.songs.values()) {
            const perfs: PerformanceDescriptor[] = archive.performances
                .filter((pf) => pf.songId === ps.id || pf.musicFingerprint === ps.musicFingerprint)
                .map((pf) => ({
                    id: pf.id,
                    name: pf.name,
                    author: pf.author ?? p.author,
                    description: pf.description,
                    songId: ps.id,
                    musicFingerprint: pf.musicFingerprint ?? ps.musicFingerprint,
                    cues: pf.cues,
                    requiredEffects: [...pf.requiredEffects],
                    origin: { kind: "plugin", id: p.id, name: p.name },
                }));
            pSongs.push({
                id: ps.id,
                name: ps.name,
                duration: ps.duration,
                noteCount: ps.noteCount,
                bytes: ps.bytes.byteLength,
                musicFingerprint: ps.musicFingerprint,
                libraries: songLibMap.get(ps.id) ?? [],
                origin: { kind: "plugin", id: p.id, name: p.name },
                origins: [{ kind: "plugin", id: p.id, name: p.name }],
                performanceEntries: perfs,
                data: ps.bytes,
            });
        }

        const pLibs: LibraryRecord[] = archive.libraries.map((pl) => ({
            id: pl.id,
            name: pl.name,
            description: pl.description,
            author: pl.author ?? p.author,
            kind: "plugin",
            pluginId: p.id,
            songIds: [...pl.songs],
            readonly: true,
        }));

        sources.push({ songs: pSongs, libraries: pLibs });
    }

    const rebuilt = rebuildContentIndex(sources, { reidentifyOnIdConflict: true });

    const byId = new Map(rebuilt.songs.map((s) => [s.id, s]));
    const byFp = new Map<string, StudioSong>();
    for (const s of rebuilt.songs) {
        if (s.musicFingerprint) byFp.set(s.musicFingerprint, s);
    }

    // 附加跨插件的独立演出（演出在另一个插件，歌曲来自用户或其它包）
    for (const p of plugins) {
        if (!p.installed || !p.enabled || !p.archive) continue;
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
                requiredEffects: [...perf.requiredEffects],
                origin: { kind: "plugin", id: p.id, name: p.name },
            });
        }
    }

    // 附加用户独立导入的演出
    for (const up of storedPerfs) {
        const target =
            (up.songId ? byId.get(up.songId) : undefined) ??
            (up.musicFingerprint ? byFp.get(up.musicFingerprint) : undefined);
        if (!target) continue;
        if (target.performanceEntries.some((item) => item.id === up.id)) continue;
        target.performanceEntries.push({
            id: up.id,
            name: up.name,
            author: up.author,
            description: up.description,
            songId: target.id,
            musicFingerprint: up.musicFingerprint ?? target.musicFingerprint,
            cues: up.cues,
            requiredEffects: up.requiredEffects,
            origin: { kind: "user", name: "独立演出" },
        });
    }

    const finalSongs = rebuilt.songs
        .map((s) => ({
            ...s,
            performanceEntries: withPlainPerformance(s.id, s.musicFingerprint, s.performanceEntries),
        }))
        .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

    // 用最终合并后的 song.libraries 同步各 library.songIds（确保 ID 重映射后也准确）
    const libSongsById = new Map<string, Set<string>>();
    for (const lib of rebuilt.libraries) libSongsById.set(lib.id, new Set());
    for (const s of finalSongs) {
        for (const lid of s.libraries ?? []) {
            libSongsById.get(lid)?.add(s.id);
        }
    }
    const finalLibs = rebuilt.libraries.map((lib) => ({
        ...lib,
        songIds: [...(libSongsById.get(lib.id) ?? lib.songIds)],
    }));

    return {
        songs: finalSongs,
        libraries: finalLibs,
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
    songIds: string[];
}

export async function saveLocalSongsBulk(
    items: readonly LocalSongBulkItem[],
    libraryId?: string,
): Promise<LocalSongBulkResult> {
    const result: LocalSongBulkResult = {
        added: 0,
        merged: 0,
        conflicts: [],
        mergedTitles: [],
        songIds: [],
    };
    if (items.length === 0) return result;

    const existing = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const existingCandidates: StudioSong[] = existing.map((s) => ({
        id: s.id,
        name: s.name,
        duration: s.duration,
        noteCount: s.noteCount,
        bytes: s.data.byteLength,
        musicFingerprint: s.musicFingerprint ?? computeMusicFingerprint(s.data),
        aliases: s.aliases,
        libraries: s.libraries ?? ["user-default"],
        performanceEntries: s.performanceEntries ?? [],
        addedAt: s.addedAt,
        data: s.data,
    }));

    const incomingCandidates: StudioSong[] = [];
    const targetLib = libraryId || "user-default";

    for (const item of items) {
        const cleanName = item.fileName.replace(/\.(mid|midi|pbe3)$/i, "").trim() || "未命名曲目";
        const isPbe3 =
            item.fileName.toLowerCase().endsWith(".pbe3") ||
            (item.bytes.length >= 4 &&
                item.bytes[0] === 0x50 &&
                item.bytes[1] === 0x42 &&
                item.bytes[2] === 0x45 &&
                item.bytes[3] === 0x33);
        const pbe3 = isPbe3 ? item.bytes : encodeSong(midiBufferToSong(item.bytes, cleanName));
        const header = readSongHeader(pbe3);
        const fp = computeMusicFingerprint(pbe3);
        incomingCandidates.push({
            id: header.id,
            name: header.name || cleanName,
            duration: header.duration,
            noteCount: header.noteCount,
            bytes: pbe3.byteLength,
            musicFingerprint: fp,
            libraries: [targetLib],
            performanceEntries: header.performance?.length
                ? [
                      {
                          id: `embedded:${header.id}`,
                          name: header.name ? `${header.name} · 默认演出` : "默认演出",
                          songId: header.id,
                          musicFingerprint: fp,
                          cues: header.performance,
                          requiredEffects: extractCueEffects(header.performance),
                          origin: { kind: "embedded", id: header.id, name: "PBE3 内嵌" },
                      },
                  ]
                : [],
            addedAt: Date.now(),
            data: pbe3,
        });
    }

    const merged = mergeSongCatalog(existingCandidates, incomingCandidates, {
        reidentifyOnIdConflict: false,
    });
    for (const conflict of merged.conflicts) {
        result.conflicts.push(conflict.incomingName ?? conflict.songId);
    }

    const existingIds = new Set(existing.map((s) => s.id));
    const dirty: StoredLocalSong[] = [];
    for (const song of merged.changed) {
        if (!song.data) continue;
        result.songIds.push(song.id);
        if (existingIds.has(song.id)) {
            result.merged++;
            result.mergedTitles.push(song.name);
        } else {
            result.added++;
        }
        dirty.push({
            id: song.id,
            name: song.name,
            duration: song.duration,
            noteCount: song.noteCount,
            data: song.data,
            aliases: song.aliases,
            libraries: song.libraries,
            performanceEntries: song.performanceEntries,
            musicFingerprint: song.musicFingerprint,
            addedAt: song.addedAt ?? Date.now(),
        });
    }

    await idbPutMany(STORE_SONGS, dirty);
    return result;
}

export async function saveLocalSongBytes(
    fileName: string,
    bytes: Uint8Array,
    libraryId?: string,
): Promise<{ status: "added" | "merged" | "conflict"; songId?: string; message?: string }> {
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
            songId: res.songIds[0],
            message: `检测到相同音乐本体，已合并到「${res.mergedTitles[0] ?? ""}」`,
        };
    }
    return { status: "added", songId: res.songIds[0] };
}

export async function renameLocalSong(songId: string, name: string): Promise<void> {
    const all = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const hit = all.find((s) => s.id === songId);
    if (!hit) throw new Error("仅用户本地保存的曲目支持重命名");
    await idbPut(STORE_SONGS, { ...hit, name: name.trim() || hit.name });
}

async function purgeStoredLocalSongs(songIds: ReadonlySet<string>): Promise<void> {
    if (songIds.size === 0) return;
    const [libraries, perfs] = await Promise.all([
        idbGetAll<LibraryRecord>(STORE_LIBRARIES),
        idbGetAll<UserPerformanceRecord>(STORE_PERFORMANCES),
    ]);
    const dirtyLibs = libraries
        .filter((lib) => lib.songIds.some((id) => songIds.has(id)))
        .map((lib) => ({
            ...lib,
            songIds: lib.songIds.filter((id) => !songIds.has(id)),
            updatedAt: Date.now(),
        }));
    await idbPutMany(STORE_LIBRARIES, dirtyLibs);
    for (const id of songIds) {
        await idbDelete(STORE_SONGS, id);
    }
    for (const p of perfs) {
        if (songIds.has(p.songId)) {
            await idbDelete(STORE_PERFORMANCES, p.id);
        }
    }
}

export async function deleteLocalSong(songId: string, musicFingerprint?: string): Promise<void> {
    const songs = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const matched = songs.filter(
        (s) => s.id === songId || (Boolean(musicFingerprint) && s.musicFingerprint === musicFingerprint),
    );
    const idsToDelete = new Set<string>([songId, ...matched.map((s) => s.id)]);
    await purgeStoredLocalSongs(idsToDelete);
}

export async function saveLocalLibrary(lib: LibraryRecord): Promise<void> {
    await idbPut(STORE_LIBRARIES, { ...lib, songIds: [], updatedAt: Date.now() });
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

export async function addSongsToLocalLibrary(
    libraryId: string,
    songIds: string[],
    fallbackSongs: readonly StudioSong[] = [],
): Promise<void> {
    const idSet = new Set(songIds);
    const existing = await idbGetAll<StoredLocalSong>(STORE_SONGS);
    const byId = new Map(existing.map((s) => [s.id, s]));
    const dirty: StoredLocalSong[] = [];

    for (const songId of idSet) {
        const hit = byId.get(songId);
        if (hit) {
            dirty.push({
                ...hit,
                libraries: [...new Set([...(hit.libraries ?? []), libraryId])],
            });
            continue;
        }
        // 如果是启用中的插件曲目加入用户曲库，则将其音乐本体持久化到用户仓库，卸载插件后仍保留
        const pluginSong = fallbackSongs.find((s) => s.id === songId && s.data);
        if (pluginSong?.data) {
            dirty.push({
                id: pluginSong.id,
                name: pluginSong.name,
                duration: pluginSong.duration,
                noteCount: pluginSong.noteCount,
                data: pluginSong.data,
                aliases: pluginSong.aliases,
                libraries: [libraryId],
                musicFingerprint: pluginSong.musicFingerprint ?? computeMusicFingerprint(pluginSong.data),
                addedAt: Date.now(),
            });
        }
    }
    await idbPutMany(STORE_SONGS, dirty);
}

export async function removeSongFromLocalLibrary(
    libraryId: string,
    songId: string,
    musicFingerprint?: string,
): Promise<void> {
    const [libraries, songs] = await Promise.all([
        idbGetAll<LibraryRecord>(STORE_LIBRARIES),
        idbGetAll<StoredLocalSong>(STORE_SONGS),
    ]);
    const matchedSongs = songs.filter(
        (s) => s.id === songId || (Boolean(musicFingerprint) && s.musicFingerprint === musicFingerprint),
    );
    const matchedIds = new Set<string>([songId, ...matchedSongs.map((s) => s.id)]);

    const lib = libraries.find((l) => l.id === libraryId);
    if (lib && lib.songIds.some((id) => matchedIds.has(id))) {
        await idbPut(STORE_LIBRARIES, {
            ...lib,
            songIds: lib.songIds.filter((id) => !matchedIds.has(id)),
            updatedAt: Date.now(),
        });
    }

    const idsToDelete = new Set<string>();
    const dirtySongs: StoredLocalSong[] = [];
    for (const song of matchedSongs) {
        const nextLibs = (song.libraries ?? []).filter((id) => id !== libraryId);
        if (libraryId === "user-default" && nextLibs.length === 0) {
            idsToDelete.add(song.id);
        } else {
            dirtySongs.push({ ...song, libraries: nextLibs });
        }
    }
    await idbPutMany(STORE_SONGS, dirtySongs);
    await purgeStoredLocalSongs(idsToDelete);
}

export async function clearLocalLibrary(libraryId: string): Promise<number> {
    const [libraries, songs] = await Promise.all([
        idbGetAll<LibraryRecord>(STORE_LIBRARIES),
        idbGetAll<StoredLocalSong>(STORE_SONGS),
    ]);
    const lib = libraries.find((l) => l.id === libraryId);
    const libSongSet = new Set(lib?.songIds ?? []);
    if (lib && lib.songIds.length > 0) {
        await idbPut(STORE_LIBRARIES, {
            ...lib,
            songIds: [],
            updatedAt: Date.now(),
        });
    }

    const idsToDelete = new Set<string>();
    const dirtySongs: StoredLocalSong[] = [];
    let cleared = 0;

    for (const song of songs) {
        const belongs = Boolean(song.libraries?.includes(libraryId)) || libSongSet.has(song.id);
        if (!belongs) continue;
        cleared++;
        const nextLibs = (song.libraries ?? []).filter((id) => id !== libraryId);
        if (libraryId === "user-default" && nextLibs.length === 0) {
            idsToDelete.add(song.id);
        } else {
            dirtySongs.push({ ...song, libraries: nextLibs });
        }
    }
    await idbPutMany(STORE_SONGS, dirtySongs);
    await purgeStoredLocalSongs(idsToDelete);
    return Math.max(cleared, libSongSet.size);
}

export async function saveLocalPerformance(perf: Omit<UserPerformanceRecord, "createdAt">): Promise<void> {
    await idbPut<UserPerformanceRecord>(STORE_PERFORMANCES, {
        ...perf,
        createdAt: Date.now(),
    });
}

export async function deleteLocalPerformance(perfId: string): Promise<boolean> {
    const all = await idbGetAll<UserPerformanceRecord>(STORE_PERFORMANCES);
    if (!all.some((p) => p.id === perfId)) return false;
    await idbDelete(STORE_PERFORMANCES, perfId);
    return true;
}

export async function installLocalPluginBytes(
    bytes: Uint8Array,
    source: "builtin" | "local" | "song",
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
        installed: true,
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
        .filter((p) => p.installed && p.enabled && p.archive)
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
    libraries: LibraryRecord[];
    plugins: StudioPlugin[];
    selectedPluginIds: string[];
    scores: ScoreEntry[];
    name: string;
    desc: string;
    randomUuid: boolean;
}): Promise<Blob> {
    const catalog: PluginCatalogEntry[] = params.plugins
        .filter((p) => p.installed && p.archive)
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
    if (depRes.untrustedDependencies.length > 0) {
        throw new Error(`依赖插件尚未信任：${depRes.untrustedDependencies.map((d) => d.dependencyId).join("、")}`);
    }
    const archives = depRes.resolvedIds
        .map((id) => params.plugins.find((p) => p.id === id)?.archive)
        .filter((a): a is PbePluginArchive => Boolean(a));

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
        libraries: params.libraries.map((l) => ({ id: l.id, name: l.name })),
        skipPluginSongs: true,
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
        .filter((p) => p.installed && p.archive)
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

export function parsePerformanceJsonText(
    text: string,
    songId: string,
    fallbackName: string,
    musicFingerprint?: string,
): Omit<UserPerformanceRecord, "createdAt"> {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("演出文件必须是 JSON 对象");
    }
    const firstCue = Array.isArray(parsed.cues)
        ? (parsed.cues[0] as Record<string, unknown> | undefined)
        : undefined;
    const cues: PerformanceCue[] =
        Array.isArray(parsed.cues) && parsed.cues.length > 0 && typeof firstCue?.tick === "number"
            ? (parsed.cues as PerformanceCue[])
            : compilePerformanceSource({ ...parsed, song: songId }, { expectedSongId: songId });
    if (cues.length === 0) throw new Error("演出文件不包含有效 cues");
    const name =
        (typeof parsed.name === "string" && parsed.name.trim()) ||
        (typeof parsed.title === "string" && parsed.title.trim()) ||
        fallbackName;
    const id =
        typeof parsed.id === "string" && parsed.id.trim()
            ? parsed.id.trim()
            : `user:${songId}:${Date.now().toString(36)}`;
    return {
        id,
        songId,
        musicFingerprint,
        name,
        ...(typeof parsed.author === "string" && parsed.author.trim() ? { author: parsed.author.trim() } : {}),
        ...(typeof parsed.description === "string" && parsed.description.trim()
            ? { description: parsed.description.trim() }
            : {}),
        cues,
        requiredEffects: extractCueEffects(cues),
    };
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

export type { MetaWithStats };
type MetaWithStats = import("@piano/core").MidiSongMeta;
