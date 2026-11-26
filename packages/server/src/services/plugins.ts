import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    checkPluginUninstall,
    computePluginDeployStatus,
    resolvePluginDependencies,
} from "@piano/assembly";
import { crc32Hex, type ResourceDeployStatus } from "@piano/core";
import { VFX_API_VERSION, isApiVersionCompatible, type VfxPluginManifest } from "@piano/vfx";
import { readPbePluginArchive, validatePluginAssembly, type PbePluginArchive } from "@piano/vfx/package";
import type { ServerConfig } from "../config.js";
import { SongConflictError, type PluginRow, type SqliteSongPort } from "../drivers/sqlitePorts.js";
import { NOOP_LOGGER, type Logger } from "../logger.js";

const MAX_REMOTE_PLUGIN_BYTES = 64 * 1024 * 1024;
const REMOTE_CACHE_TTL_MS = 5 * 60 * 1000;

export class PluginConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PluginConflictError";
    }
}

export interface ServerPluginRecord {
    id: string;
    name: string;
    version: string;
    manifest: VfxPluginManifest;
    size: number;
    source: "local" | "upload" | "remote";
    installed: boolean;
    enabled: boolean;
    trusted: boolean;
    compatible: boolean;
    compatibilityReason?: string;
    hasExecutableCode: boolean;
    requiresPackDeploy: boolean;
    status: ResourceDeployStatus;
    dependents: string[];
    missingDependencies: string[];
    installedAt?: number;
    updatedAt?: number;
    contents: {
        songs: number;
        performances: number;
        libraries: number;
        timbres: number;
        effects: number;
        themes: number;
        keyStyles: number;
        particles: number;
        stageProps: number;
    };
    previewDataUrl?: string;
}

export interface RemotePluginIndexEntry {
    id: string;
    manifest: VfxPluginManifest;
    size: number;
    file: string;
    hasExecutableCode?: boolean;
    previewDataUrl?: string;
    contents?: ServerPluginRecord["contents"];
}

export interface PluginCatalogResponse {
    items: ServerPluginRecord[];
    registryUrl?: string;
    registryError?: string;
}

function archivePreviewDataUrl(archive: PbePluginArchive): string | undefined {
    const preferred =
        (typeof archive.manifest.icon === "string" ? archive.manifest.icon : undefined) ??
        archive.manifest.preview?.thumbnail;
    const entry =
        (preferred && archive.previews.has(preferred)
            ? ([preferred, archive.previews.get(preferred)] as const)
            : undefined) ?? [...archive.previews.entries()][0];
    if (!entry?.[1]) return undefined;
    const [filePath, bytes] = entry;
    const lower = filePath.toLowerCase();
    const mime = lower.endsWith(".svg")
        ? "image/svg+xml"
        : lower.endsWith(".webp")
          ? "image/webp"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? "image/jpeg"
            : "image/png";
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function archiveRequiresPackDeploy(archive: PbePluginArchive): boolean {
    return (
        archive.hasExecutableCode ||
        archive.particles.size > 0 ||
        archive.textures.size > 0 ||
        archive.stageProps.length > 0 ||
        archive.timbres.length > 0 ||
        archive.sounds.size > 0
    );
}

function manifestRequiresPackDeploy(manifest: VfxPluginManifest, hasCode: boolean): boolean {
    return (
        hasCode ||
        (manifest.provides.particles?.length ?? 0) > 0 ||
        (manifest.provides.timbres?.length ?? 0) > 0 ||
        (manifest.stageProps?.length ?? 0) > 0
    );
}

function resolveRegistryIndexUrl(raw: string): string {
    const u = new URL(raw.trim());
    if (!u.pathname.endsWith(".json") && !u.pathname.endsWith("/")) {
        u.pathname += "/";
    }
    return u.pathname.endsWith(".json") ? u.toString() : new URL("index.json", u).toString();
}

export class PluginService {
    private readonly archiveCache = new Map<
        string,
        { mtimeMs: number; size: number; crc: string; archive: PbePluginArchive }
    >();
    private readonly fileById = new Map<string, string>();
    private remoteCache:
        | { url: string; fetchedAt: number; items: RemotePluginIndexEntry[]; error?: string }
        | undefined;

    constructor(
        private readonly songPort: SqliteSongPort,
        private readonly config: ServerConfig,
        private readonly log: Logger = NOOP_LOGGER,
    ) {
        mkdirSync(this.config.pluginsDir, { recursive: true });
    }

    private archivePath(id: string): string {
        if (!/^[a-z][a-z0-9._-]{1,63}$/.test(id)) {
            throw new Error(`非法的插件 ID：${id}`);
        }
        return join(this.config.pluginsDir, `${id}.pbeplugin`);
    }

    private readCachedArchive(fullPath: string): { archive: PbePluginArchive; crc: string } {
        const stat = statSync(fullPath);
        const cached = this.archiveCache.get(fullPath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return { archive: cached.archive, crc: cached.crc };
        }
        const bytes = new Uint8Array(readFileSync(fullPath));
        const archive = readPbePluginArchive(bytes);
        const crc = crc32Hex(bytes);
        this.archiveCache.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, crc, archive });
        return { archive, crc };
    }

    /**
     * 扫描外置 plugins 目录并与 SQLite 对账：
     * - 新增磁盘插件：按规则录入为「未启用」状态，等待管理员手动启用/信任
     * - 变更磁盘插件：更新元数据；含脚本且曾未信任则重置信任；已启用插件重新同步动态数据
     * - 缺失磁盘插件：清理数据库记录及其独占动态数据
     */
    syncDirectory(): void {
        mkdirSync(this.config.pluginsDir, { recursive: true });
        const files = readdirSync(this.config.pluginsDir)
            .filter((name) => name.endsWith(".pbeplugin"))
            .sort();

        const presentPaths = new Set<string>();
        const diskMap = new Map<string, { fullPath: string; archive: PbePluginArchive; crc: string }>();

        for (const file of files) {
            const fullPath = join(this.config.pluginsDir, file);
            presentPaths.add(fullPath);
            try {
                const { archive, crc } = this.readCachedArchive(fullPath);
                const id = archive.manifest.id;
                if (diskMap.has(id)) {
                    this.log.warn(`检测到重复插件 ID，已跳过：${file}`, undefined, { plugin: id });
                    continue;
                }
                diskMap.set(id, { fullPath, archive, crc });
            } catch (error) {
                this.log.warn(`读取插件包失败，已跳过：${file}`, error);
            }
        }

        for (const cachedPath of this.archiveCache.keys()) {
            if (!presentPaths.has(cachedPath)) this.archiveCache.delete(cachedPath);
        }

        this.fileById.clear();
        for (const [id, entry] of diskMap) {
            this.fileById.set(id, entry.fullPath);
        }

        const storedHashes = parseHashRecord(this.songPort.getState("plugin_hashes_json"));
        const nextHashes: Record<string, string> = {};
        const rows = this.songPort.listPluginRows();
        const rowMap = new Map(rows.map((r) => [r.id, r]));

        for (const [id, { archive, crc }] of diskMap) {
            const { manifest } = archive;
            const manifestJson = JSON.stringify(manifest);
            nextHashes[id] = crc;
            const existing = rowMap.get(id);

            if (!existing) {
                const trusted = !archive.hasExecutableCode;
                this.songPort.upsertPluginRow({
                    id,
                    name: manifest.name,
                    version: manifest.version,
                    manifest_json: manifestJson,
                    size: archive.size,
                    source: "local",
                    enabled: 0,
                    trusted: trusted ? 1 : 0,
                    has_code: archive.hasExecutableCode ? 1 : 0,
                });
                this.log.info(`发现外置插件（待启用）：${id} v${manifest.version}`, { plugin: id });
                continue;
            }

            const changed =
                storedHashes[id] !== crc ||
                existing.version !== manifest.version ||
                existing.size !== archive.size ||
                existing.manifest_json !== manifestJson ||
                (existing.has_code === 1) !== archive.hasExecutableCode;

            if (!changed) continue;

            const becameCode = archive.hasExecutableCode && existing.has_code === 0;
            const trusted = becameCode ? false : existing.trusted === 1;
            const enabled = becameCode ? false : existing.enabled === 1 && trusted;

            this.songPort.upsertPluginRow({
                id,
                name: manifest.name,
                version: manifest.version,
                manifest_json: manifestJson,
                size: archive.size,
                source: existing.source,
                enabled: enabled ? 1 : 0,
                trusted: trusted ? 1 : 0,
                has_code: archive.hasExecutableCode ? 1 : 0,
            });

            if (enabled) {
                this.songPort.deletePluginDynamicData(id);
                try {
                    this.syncPluginDynamicData(archive);
                } catch (error) {
                    this.log.warn(`刷新已启用插件数据失败：${id}`, error, { plugin: id });
                }
            } else if (existing.enabled === 1) {
                this.songPort.deletePluginDynamicData(id);
            }
        }

        for (const row of rows) {
            if (!diskMap.has(row.id)) {
                this.songPort.deletePluginData(row.id);
                this.log.info(`已清理缺失文件的插件记录：${row.id}`, { plugin: row.id });
            }
        }

        if (!sameHashRecord(storedHashes, nextHashes)) {
            this.songPort.setState("plugin_hashes_json", JSON.stringify(nextHashes));
        }
    }

    readInstalledArchive(id: string): PbePluginArchive | undefined {
        const file = this.fileById.get(id) ?? this.archivePath(id);
        if (!existsSync(file)) return undefined;
        return this.readCachedArchive(file).archive;
    }

    readArchiveBytes(id: string): Uint8Array | undefined {
        this.syncDirectory();
        const file = this.fileById.get(id) ?? this.archivePath(id);
        if (!existsSync(file)) return undefined;
        return new Uint8Array(readFileSync(file));
    }

    private validateAssemblyForPlugin(archive: PbePluginArchive): void {
        const otherArchives = this.getActivePackArchives().filter((a) => a.manifest.id !== archive.manifest.id);
        const allAvailable = [...otherArchives, archive];
        const byId = new Map(allAvailable.map((a) => [a.manifest.id, a]));
        const resolvedList: PbePluginArchive[] = [];
        const visited = new Set<string>();
        const collectWithDeps = (item: PbePluginArchive) => {
            if (visited.has(item.manifest.id)) return;
            visited.add(item.manifest.id);
            for (const dep of item.manifest.dependencies ?? []) {
                const depArchive = byId.get(dep);
                if (depArchive) collectWithDeps(depArchive);
            }
            resolvedList.push(item);
        };
        collectWithDeps(archive);
        const missingDeps = (archive.manifest.dependencies ?? []).filter((dep) => !byId.has(dep));
        if (missingDeps.length === 0) {
            validatePluginAssembly(resolvedList);
        }
    }

    installPluginBytes(
        bytes: Uint8Array,
        source: "local" | "upload" | "remote" = "upload",
        options: { autoEnable?: boolean } = {},
    ): ServerPluginRecord {
        this.syncDirectory();
        const archive = readPbePluginArchive(bytes);
        const { manifest } = archive;
        if (!isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION)) {
            throw new Error(`插件 ${manifest.id} API 版本 ${manifest.apiVersion} 与当前宿主 ${VFX_API_VERSION} 不兼容`);
        }

        const autoEnable = options.autoEnable ?? source === "upload";
        if (autoEnable) {
            this.validateAssemblyForPlugin(archive);
        }

        const targetPath = this.archivePath(manifest.id);
        const prevPath = this.fileById.get(manifest.id);
        if (prevPath && prevPath !== targetPath && existsSync(prevPath)) {
            rmSync(prevPath, { force: true });
        }

        const existingRow = this.songPort.getPluginRow(manifest.id);
        const existingBytes =
            existingRow && existsSync(targetPath) ? new Uint8Array(readFileSync(targetPath)) : undefined;
        if (
            existingRow &&
            existingBytes &&
            crc32Hex(existingBytes) === crc32Hex(bytes) &&
            existingBytes.byteLength === bytes.byteLength
        ) {
            return this.getPluginRecord(manifest.id)!;
        }

        // 无可执行脚本的纯内容插件免脚本信任弹窗；含脚本的上传/本地/远程插件由管理员显式信任后启用
        const trusted = !archive.hasExecutableCode || existingRow?.trusted === 1;
        const enabled = existingRow ? Boolean(existingRow.enabled && trusted) : Boolean(autoEnable && trusted);

        writeFileSync(targetPath, bytes);
        const crc = crc32Hex(bytes);
        const stat = statSync(targetPath);
        this.fileById.set(manifest.id, targetPath);
        this.archiveCache.set(targetPath, { mtimeMs: stat.mtimeMs, size: stat.size, crc, archive });

        const storedHashes = parseHashRecord(this.songPort.getState("plugin_hashes_json"));
        storedHashes[manifest.id] = crc;
        this.songPort.setState("plugin_hashes_json", JSON.stringify(storedHashes));

        this.songPort.upsertPluginRow({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            manifest_json: JSON.stringify(manifest),
            size: bytes.byteLength,
            source,
            enabled: enabled ? 1 : 0,
            trusted: trusted ? 1 : 0,
            has_code: archive.hasExecutableCode ? 1 : 0,
        });

        if (enabled) {
            this.songPort.deletePluginDynamicData(manifest.id);
            this.syncPluginDynamicData(archive);
        }

        return this.getPluginRecord(manifest.id)!;
    }

    private syncPluginDynamicData(archive: PbePluginArchive): void {
        const pluginId = archive.manifest.id;
        const origin = { kind: "plugin" as const, id: pluginId, name: archive.manifest.name };
        const songIdMap = new Map<string, string>();

        for (const song of archive.songs.values()) {
            const saved = this.songPort.savePbe3File(song.bytes, {
                name: song.name,
                origin,
                libraryId: null,
            });
            songIdMap.set(song.id, saved.id);
        }

        for (const lib of archive.libraries) {
            this.songPort.createLibrary({
                id: lib.id,
                name: lib.name,
                description: lib.description,
                kind: "plugin",
                pluginId,
                songIds: lib.songs.map((id) => songIdMap.get(id) ?? id),
            });
        }

        for (const perf of archive.performances) {
            const targetSongId = songIdMap.get(perf.songId) ?? perf.songId;
            if (!this.songPort.has(targetSongId)) {
                throw new SongConflictError(`演出 ${perf.name} 引用的歌曲 ${perf.songId} 不存在`);
            }
            this.songPort.savePerformance({
                id: perf.id,
                songId: targetSongId,
                musicFingerprint: perf.musicFingerprint,
                name: perf.name,
                author: perf.author,
                description: perf.description,
                cues: perf.cues,
                origin,
            });
        }
    }

    trustPlugin(id: string): ServerPluginRecord {
        this.syncDirectory();
        const row = this.songPort.getPluginRow(id);
        if (!row) throw new Error(`插件不存在：${id}`);
        const archive = this.readInstalledArchive(id);
        if (!archive) throw new Error(`插件文件不存在：${id}`);
        if (!isApiVersionCompatible(archive.manifest.apiVersion, VFX_API_VERSION)) {
            throw new PluginConflictError(
                `插件 ${archive.manifest.id} API 版本 ${archive.manifest.apiVersion} 与当前宿主 ${VFX_API_VERSION} 不兼容`,
            );
        }
        this.validateAssemblyForPlugin(archive);
        this.songPort.setPluginFlags(id, { trusted: true, enabled: true });
        this.songPort.deletePluginDynamicData(id);
        this.syncPluginDynamicData(archive);
        return this.getPluginRecord(id)!;
    }

    setPluginEnabled(id: string, enabled: boolean): ServerPluginRecord {
        this.syncDirectory();
        const row = this.songPort.getPluginRow(id);
        if (!row) throw new Error(`插件不存在：${id}`);
        if (enabled && !row.trusted) {
            throw new PluginConflictError(`插件 ${row.name} 包含可执行脚本，请先信任后再启用`);
        }
        if (!enabled) {
            const enabledEntries = this.listCatalog()
                .filter((p) => p.installed && p.enabled)
                .map((p) => ({ id: p.id, manifest: p.manifest }));
            const guard = checkPluginUninstall(id, enabledEntries);
            if (!guard.ok) {
                throw new PluginConflictError(guard.message);
            }
            this.songPort.setPluginFlags(id, { enabled: false });
            this.songPort.deletePluginDynamicData(id);
            return this.getPluginRecord(id)!;
        }

        const archive = this.readInstalledArchive(id);
        if (!archive) throw new Error(`插件文件不存在：${id}`);
        if (!isApiVersionCompatible(archive.manifest.apiVersion, VFX_API_VERSION)) {
            throw new PluginConflictError(
                `插件 ${archive.manifest.id} API 版本 ${archive.manifest.apiVersion} 与当前宿主 ${VFX_API_VERSION} 不兼容`,
            );
        }
        this.validateAssemblyForPlugin(archive);
        this.songPort.setPluginFlags(id, { enabled: true });
        this.songPort.deletePluginDynamicData(id);
        this.syncPluginDynamicData(archive);
        return this.getPluginRecord(id)!;
    }

    uninstallPlugin(id: string): void {
        this.syncDirectory();
        const row = this.songPort.getPluginRow(id);
        if (!row) throw new Error(`插件不存在：${id}`);
        const enabledEntries = this.listCatalog()
            .filter((p) => p.installed && p.enabled)
            .map((p) => ({ id: p.id, manifest: p.manifest }));
        const guard = checkPluginUninstall(id, enabledEntries);
        if (!guard.ok) {
            throw new PluginConflictError(guard.message);
        }

        const file = this.fileById.get(id) ?? this.archivePath(id);
        if (existsSync(file)) rmSync(file, { force: true });
        this.fileById.delete(id);
        this.archiveCache.delete(file);
        this.songPort.deletePluginData(id);
        const storedHashes = parseHashRecord(this.songPort.getState("plugin_hashes_json"));
        if (id in storedHashes) {
            delete storedHashes[id];
            this.songPort.setState("plugin_hashes_json", JSON.stringify(storedHashes));
        }
    }

    /** 读取所有已安装插件的归档（含未启用，用于收集可用音色等只读展示信息）。 */
    listInstalledArchives(): PbePluginArchive[] {
        this.syncDirectory();
        const archives: PbePluginArchive[] = [];
        for (const row of this.songPort.listPluginRows()) {
            try {
                const archive = this.readInstalledArchive(row.id);
                if (archive) archives.push(archive);
            } catch {
                // skip corrupted archive
            }
        }
        return archives;
    }

    getActivePackArchives(): PbePluginArchive[] {
        const rows = this.songPort.listPluginRows().filter((r) => r.enabled === 1 && r.trusted === 1);
        const archives: PbePluginArchive[] = [];
        for (const row of rows) {
            try {
                const archive = this.readInstalledArchive(row.id);
                if (archive && archiveRequiresPackDeploy(archive)) {
                    archives.push(archive);
                }
            } catch {
                // skip corrupted archive
            }
        }
        return archives;
    }

    getPluginRecord(id: string): ServerPluginRecord | undefined {
        return this.listCatalog().find((item) => item.id === id);
    }

    listCatalog(deployedIds?: readonly string[], loadedIds?: readonly string[]): ServerPluginRecord[] {
        this.syncDirectory();
        const deployed = deployedIds ?? parseJsonList(this.songPort.getState("deployed_plugins_json"));
        const loaded = loadedIds ?? parseJsonList(this.songPort.getState("loaded_plugins_json"));

        const rows = this.songPort.listPluginRows();
        const installedById = new Map<string, { row: PluginRow; archive?: PbePluginArchive }>();
        for (const row of rows) {
            let archive: PbePluginArchive | undefined;
            try {
                archive = this.readInstalledArchive(row.id);
            } catch {
                archive = undefined;
            }
            installedById.set(row.id, { row, archive });
        }

        const records: ServerPluginRecord[] = [];
        for (const { row, archive } of installedById.values()) {
            records.push(this.buildRecord(row, archive, installedById, deployed, loaded));
        }
        return records;
    }

    async fetchRemoteCatalog(forceRefresh = false): Promise<{
        items: RemotePluginIndexEntry[];
        registryUrl?: string;
        error?: string;
    }> {
        const rawUrl = this.config.pluginRegistryUrl;
        if (!rawUrl) return { items: [] };

        let indexUrl: string;
        try {
            indexUrl = resolveRegistryIndexUrl(rawUrl);
        } catch (error) {
            return {
                items: [],
                registryUrl: rawUrl,
                error: `远程插件源地址无效：${error instanceof Error ? error.message : String(error)}`,
            };
        }

        const now = Date.now();
        if (
            !forceRefresh &&
            this.remoteCache &&
            this.remoteCache.url === indexUrl &&
            now - this.remoteCache.fetchedAt < REMOTE_CACHE_TTL_MS
        ) {
            return {
                items: this.remoteCache.items,
                registryUrl: indexUrl,
                ...(this.remoteCache.error ? { error: this.remoteCache.error } : {}),
            };
        }

        try {
            const res = await fetch(indexUrl, { signal: AbortSignal.timeout(10_000) });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }
            const parsed = (await res.json()) as unknown;
            if (!Array.isArray(parsed)) {
                throw new Error("远程插件清单格式应为 JSON 数组");
            }
            const items: RemotePluginIndexEntry[] = [];
            for (const entry of parsed) {
                if (!entry || typeof entry !== "object") continue;
                const item = entry as Partial<RemotePluginIndexEntry>;
                if (typeof item.id !== "string" || typeof item.file !== "string" || !item.manifest) continue;
                items.push({
                    id: item.id,
                    manifest: item.manifest,
                    size: typeof item.size === "number" ? item.size : 0,
                    file: item.file,
                    hasExecutableCode: Boolean(item.hasExecutableCode),
                    ...(typeof item.previewDataUrl === "string" ? { previewDataUrl: item.previewDataUrl } : {}),
                    ...(item.contents ? { contents: item.contents } : {}),
                });
            }
            this.remoteCache = { url: indexUrl, fetchedAt: now, items };
            return { items, registryUrl: indexUrl };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.warn("获取远程插件清单失败", error, { url: indexUrl });
            const items = this.remoteCache?.url === indexUrl ? this.remoteCache.items : [];
            this.remoteCache = { url: indexUrl, fetchedAt: now, items, error: message };
            return { items, registryUrl: indexUrl, error: message };
        }
    }

    async listCatalogWithRemote(
        deployedIds?: readonly string[],
        loadedIds?: readonly string[],
        forceRefresh = false,
    ): Promise<PluginCatalogResponse> {
        const local = this.listCatalog(deployedIds, loadedIds);
        const installedIds = new Set(local.map((item) => item.id));
        const remote = await this.fetchRemoteCatalog(forceRefresh);

        const remoteItems: ServerPluginRecord[] = [];
        for (const entry of remote.items) {
            if (installedIds.has(entry.id)) continue;
            const manifest = entry.manifest;
            const compatible = isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION);
            const hasExecutableCode = Boolean(entry.hasExecutableCode);
            remoteItems.push({
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                manifest,
                size: entry.size,
                source: "remote",
                installed: false,
                enabled: false,
                trusted: !hasExecutableCode,
                compatible,
                ...(!compatible ? { compatibilityReason: `需要 API ${manifest.apiVersion}` } : {}),
                hasExecutableCode,
                requiresPackDeploy: manifestRequiresPackDeploy(manifest, hasExecutableCode),
                status: "unavailable",
                dependents: [],
                missingDependencies: [],
                contents: entry.contents ?? summarizeManifestContents(manifest),
                ...(entry.previewDataUrl ? { previewDataUrl: entry.previewDataUrl } : {}),
            });
        }

        return {
            items: [...local, ...remoteItems],
            ...(remote.registryUrl ? { registryUrl: remote.registryUrl } : {}),
            ...(remote.error ? { registryError: remote.error } : {}),
        };
    }

    async installFromRegistry(remoteId: string): Promise<ServerPluginRecord> {
        if (!this.config.pluginRegistryUrl) {
            throw new Error("未配置远程插件源（PLUGIN_REGISTRY_URL）");
        }
        let remote = await this.fetchRemoteCatalog(false);
        let entry = remote.items.find((item) => item.id === remoteId);
        if (!entry) {
            remote = await this.fetchRemoteCatalog(true);
            entry = remote.items.find((item) => item.id === remoteId);
        }
        if (!entry || !remote.registryUrl) {
            throw new Error(`未在远程插件源找到：${remoteId}`);
        }

        const downloadUrl = new URL(entry.file, remote.registryUrl).toString();
        const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) {
            throw new Error(`下载插件失败（HTTP ${res.status}）：${downloadUrl}`);
        }
        const lengthHeader = Number(res.headers.get("content-length") ?? 0);
        if (lengthHeader > MAX_REMOTE_PLUGIN_BYTES) {
            throw new Error("远程插件超过大小限制（64 MB）");
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === 0) {
            throw new Error("下载的插件文件为空");
        }
        if (bytes.byteLength > MAX_REMOTE_PLUGIN_BYTES) {
            throw new Error("远程插件超过大小限制（64 MB）");
        }

        const archive = readPbePluginArchive(bytes);
        if (archive.manifest.id !== remoteId) {
            throw new Error(`插件 ID 不匹配：期望 ${remoteId}，实际为 ${archive.manifest.id}`);
        }
        // 按规则 B：远程下载落盘为已安装未启用，由管理员在扩展中心显式启用/信任
        return this.installPluginBytes(bytes, "remote", { autoEnable: false });
    }

    private buildRecord(
        row: PluginRow,
        archive?: PbePluginArchive,
        allInstalled?: Map<string, { row: PluginRow; archive?: PbePluginArchive }>,
        deployed: readonly string[] = parseJsonList(this.songPort.getState("deployed_plugins_json")),
        loaded: readonly string[] = parseJsonList(this.songPort.getState("loaded_plugins_json")),
    ): ServerPluginRecord {
        const manifest = (archive?.manifest ?? JSON.parse(row.manifest_json)) as VfxPluginManifest;
        const compatible = isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION);
        const enabled = row.enabled === 1;
        const trusted = row.trusted === 1;
        const requiresPackDeploy = archive ? archiveRequiresPackDeploy(archive) : row.has_code === 1;

        const catalogEntries = allInstalled
            ? [...allInstalled.values()].map((item) => {
                  const m = (item.archive?.manifest ?? JSON.parse(item.row.manifest_json)) as VfxPluginManifest;
                  return {
                      id: item.row.id,
                      manifest: m,
                      trusted: item.row.trusted === 1,
                      compatible: isApiVersionCompatible(m.apiVersion, VFX_API_VERSION),
                  };
              })
            : [];

        const depRes = allInstalled
            ? resolvePluginDependencies([row.id], catalogEntries)
            : { missingDependencies: [], untrustedDependencies: [] };
        const missingDependencies = [
            ...depRes.missingDependencies.map((d) => d.dependencyId),
            ...depRes.untrustedDependencies.map((d) => d.dependencyId),
        ];

        const dependents = allInstalled
            ? [...allInstalled.values()]
                  .filter((item) => {
                      const m = (item.archive?.manifest ?? JSON.parse(item.row.manifest_json)) as VfxPluginManifest;
                      return item.row.enabled === 1 && m.dependencies?.includes(row.id);
                  })
                  .map((item) => item.row.id)
            : [];

        const status = computePluginDeployStatus({
            enabled,
            trusted,
            compatible,
            requiresPackDeploy,
            hasMissingDeps: missingDependencies.length > 0,
            deployedPluginIds: deployed,
            loadedPluginIds: loaded,
            pluginId: row.id,
        });

        const previewDataUrl = archive ? archivePreviewDataUrl(archive) : undefined;
        const source: ServerPluginRecord["source"] =
            row.source === "upload" ? "upload" : row.source === "remote" ? "remote" : "local";

        return {
            id: row.id,
            name: row.name,
            version: row.version,
            manifest,
            size: row.size,
            source,
            installed: true,
            enabled,
            trusted,
            compatible,
            ...(!compatible ? { compatibilityReason: `需要 API ${manifest.apiVersion}` } : {}),
            hasExecutableCode: row.has_code === 1,
            requiresPackDeploy,
            status,
            dependents,
            missingDependencies,
            installedAt: row.installed_at,
            updatedAt: row.updated_at,
            contents: archive ? summarizeArchiveContents(archive) : summarizeManifestContents(manifest),
            ...(previewDataUrl ? { previewDataUrl } : {}),
        };
    }
}

function summarizeArchiveContents(archive: PbePluginArchive) {
    return {
        songs: archive.songs.size,
        performances: archive.performances.length,
        libraries: archive.libraries.length,
        timbres: archive.timbres.length,
        effects: archive.manifest.provides.effects?.length ?? 0,
        themes: archive.manifest.provides.themes?.length ?? 0,
        keyStyles: archive.manifest.provides.keyStyles?.length ?? 0,
        particles: archive.manifest.provides.particles?.length ?? 0,
        stageProps: archive.stageProps.length,
    };
}

function summarizeManifestContents(manifest: VfxPluginManifest) {
    return {
        songs: manifest.provides.songs?.length ?? 0,
        performances: manifest.provides.performances?.length ?? 0,
        libraries: manifest.provides.libraries?.length ?? 0,
        timbres: manifest.provides.timbres?.length ?? 0,
        effects: manifest.provides.effects?.length ?? 0,
        themes: manifest.provides.themes?.length ?? 0,
        keyStyles: manifest.provides.keyStyles?.length ?? 0,
        particles: manifest.provides.particles?.length ?? 0,
        stageProps: manifest.stageProps?.length ?? 0,
    };
}

function parseJsonList(raw?: string): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function parseHashRecord(raw?: string): Record<string, string> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") out[k] = v;
        }
        return out;
    } catch {
        return {};
    }
}

function sameHashRecord(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
        if (a[k] !== b[k]) return false;
    }
    return true;
}
