import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
    source: "builtin" | "upload";
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

function resolveBuiltinDir(config: ServerConfig): string | undefined {
    if (config.builtinPluginsDir && existsSync(config.builtinPluginsDir)) {
        return config.builtinPluginsDir;
    }
    const candidate = resolve(import.meta.dir, "../../../../build/plugins");
    return existsSync(candidate) ? candidate : undefined;
}

export class PluginService {
    private readonly builtinCache = new Map<string, { mtimeMs: number; size: number; archive: PbePluginArchive }>();

    constructor(
        private readonly songPort: SqliteSongPort,
        private readonly config: ServerConfig,
    ) {
        mkdirSync(this.config.pluginsDir, { recursive: true });
    }

    private archivePath(id: string): string {
        if (!/^[a-z][a-z0-9._-]{1,63}$/.test(id)) {
            throw new Error(`非法的插件 ID：${id}`);
        }
        return join(this.config.pluginsDir, `${id}.pbeplugin`);
    }

    readInstalledArchive(id: string): PbePluginArchive | undefined {
        const file = this.archivePath(id);
        if (!existsSync(file)) return undefined;
        return readPbePluginArchive(new Uint8Array(readFileSync(file)));
    }

    readArchiveBytes(id: string): Uint8Array | undefined {
        const file = this.archivePath(id);
        if (existsSync(file)) return new Uint8Array(readFileSync(file));
        const builtin = this.listBuiltinArchives().find((item) => item.archive.manifest.id === id);
        return builtin?.archive.bytes;
    }

    listBuiltinArchives(): { file: string; archive: PbePluginArchive }[] {
        const dir = resolveBuiltinDir(this.config);
        if (!dir) return [];
        const files = readdirSync(dir)
            .filter((name) => name.endsWith(".pbeplugin"))
            .sort();
        const out: { file: string; archive: PbePluginArchive }[] = [];
        for (const file of files) {
            const fullPath = join(dir, file);
            try {
                const stat = statSync(fullPath);
                const cached = this.builtinCache.get(fullPath);
                if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
                    out.push({ file, archive: cached.archive });
                    continue;
                }
                const bytes = new Uint8Array(readFileSync(fullPath));
                const archive = readPbePluginArchive(bytes);
                this.builtinCache.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, archive });
                out.push({ file, archive });
            } catch { /* skip broken builtin */ }
        }
        return out;
    }

    installBuiltin(builtinId: string): ServerPluginRecord {
        const match = this.listBuiltinArchives().find((item) => item.archive.manifest.id === builtinId);
        if (!match) {
            throw new Error(`未找到内置插件：${builtinId}`);
        }
        return this.installPluginBytes(match.archive.bytes, "builtin");
    }

    installPluginBytes(bytes: Uint8Array, source: "builtin" | "upload" = "upload"): ServerPluginRecord {
        const archive = readPbePluginArchive(bytes);
        const { manifest } = archive;
        if (!isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION)) {
            throw new Error(`插件 ${manifest.id} API 版本 ${manifest.apiVersion} 与当前宿主 ${VFX_API_VERSION} 不兼容`);
        }

        // 检查与已启用插件的路径/资源冲突（排除同 ID 更新自身）
        const otherArchives = this.getActivePackArchives().filter((a) => a.manifest.id !== manifest.id);
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
        // 只在依赖都已存在时做全量装配冲突检查；缺依赖时仍允许安装并标记待补齐依赖
        const missingDeps = (manifest.dependencies ?? []).filter((dep) => !byId.has(dep));
        if (missingDeps.length === 0) {
            validatePluginAssembly(resolvedList);
        }

        const existingRow = this.songPort.getPluginRow(manifest.id);
        const existingBytes = existingRow && existsSync(this.archivePath(manifest.id))
            ? new Uint8Array(readFileSync(this.archivePath(manifest.id)))
            : undefined;
        if (
            existingRow &&
            existingBytes &&
            crc32Hex(existingBytes) === crc32Hex(bytes) &&
            existingBytes.byteLength === bytes.byteLength
        ) {
            return this.buildRecord(existingRow, archive);
        }

        // 无可执行脚本的纯内容插件无需管理员信任弹窗，自动信任并启用；
        // 含脚本的第三方上传插件必须由管理员主动信任（5.4）。
        const trusted = !archive.hasExecutableCode || source === "builtin" || existingRow?.trusted === 1;
        const enabled = existingRow ? Boolean(existingRow.enabled && trusted) : trusted;

        writeFileSync(this.archivePath(manifest.id), bytes);
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

        // 注册动态内容（歌曲、曲库、演出编排），立即在曲库生效
        this.syncPluginDynamicData(archive);

        const row = this.songPort.getPluginRow(manifest.id)!;
        return this.buildRecord(row, archive);
    }

    private syncPluginDynamicData(archive: PbePluginArchive): void {
        const pluginId = archive.manifest.id;
        const origin = { kind: "plugin" as const, id: pluginId, name: archive.manifest.name };
        const songIdMap = new Map<string, string>();

        for (const song of archive.songs.values()) {
            const saved = this.songPort.savePbe3File(song.bytes, {
                name: song.name,
                origin,
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
        const row = this.songPort.getPluginRow(id);
        if (!row) throw new Error(`插件不存在：${id}`);
        this.songPort.setPluginFlags(id, { trusted: true, enabled: true });
        return this.getPluginRecord(id)!;
    }

    setPluginEnabled(id: string, enabled: boolean): ServerPluginRecord {
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
        }
        this.songPort.setPluginFlags(id, { enabled });
        return this.getPluginRecord(id)!;
    }

    uninstallPlugin(id: string): void {
        const row = this.songPort.getPluginRow(id);
        if (!row) throw new Error(`插件不存在：${id}`);
        const enabledEntries = this.listCatalog()
            .filter((p) => p.installed && p.enabled)
            .map((p) => ({ id: p.id, manifest: p.manifest }));
        const guard = checkPluginUninstall(id, enabledEntries);
        if (!guard.ok) {
            throw new PluginConflictError(guard.message);
        }

        this.songPort.deletePluginData(id);
        const file = this.archivePath(id);
        if (existsSync(file)) rmSync(file);
    }

    getActivePackArchives(): PbePluginArchive[] {
        const rows = this.songPort.listPluginRows().filter((r) => r.enabled === 1 && r.trusted === 1);
        const archives: PbePluginArchive[] = [];
        for (const row of rows) {
            const archive = this.readInstalledArchive(row.id);
            if (archive && archiveRequiresPackDeploy(archive)) {
                archives.push(archive);
            }
        }
        return archives;
    }

    getPluginRecord(id: string): ServerPluginRecord | undefined {
        return this.listCatalog().find((item) => item.id === id);
    }

    listCatalog(deployedIds?: readonly string[], loadedIds?: readonly string[]): ServerPluginRecord[] {
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

        for (const { archive } of this.listBuiltinArchives()) {
            if (installedById.has(archive.manifest.id)) continue;
            const manifest = archive.manifest;
            const compatible = isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION);
            const previewDataUrl = archivePreviewDataUrl(archive);
            records.push({
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                manifest,
                size: archive.size,
                source: "builtin",
                installed: false,
                enabled: false,
                // 内置扩展随应用分发，安装后无需再次授权；含脚本的第三方上传包才需要管理员信任
                trusted: true,
                compatible,
                ...(!compatible ? { compatibilityReason: `需要 API ${manifest.apiVersion}` } : {}),
                hasExecutableCode: archive.hasExecutableCode,
                requiresPackDeploy: archiveRequiresPackDeploy(archive),
                status: "unavailable",
                dependents: [],
                missingDependencies: [],
                contents: summarizeArchiveContents(archive),
                ...(previewDataUrl ? { previewDataUrl } : {}),
            });
        }

        return records;
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

        return {
            id: row.id,
            name: row.name,
            version: row.version,
            manifest,
            size: row.size,
            source: row.source === "builtin" ? "builtin" : "upload",
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
