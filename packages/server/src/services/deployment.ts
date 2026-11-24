import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readAddonArchive } from "@bepack/addon";
import {
    MAX_SCORES,
    SCORE_ID_PATTERN,
    assembleAddonBytes,
    assembleAddonTemplate,
    extractPackFiles,
    loadAddonTemplate,
    scoreStandPath,
    type AssemblyScoreEntry,
    type LoadedTimbrePack,
    type TimbreExportSelection,
    type TimbreIndexEntry,
} from "@piano/assembly";
import {
    PIANO_SAMPLE_KEYS,
    PIANO_TIMBRES,
    crc32Hex,
    decodeBase64Url,
    encodeUtf8,
    pianoSoundId,
    pianoSoundLayers,
    type ResourceDeployStatus,
} from "@piano/core";
import type { PbePluginArchive } from "@piano/vfx/package";
import { unzipSync, zipSync } from "fflate";
import type { ServerConfig } from "../config.js";
import type { SqliteSongPort } from "../drivers/sqlitePorts.js";
import type { PluginService } from "./plugins.js";

export interface BdsConfig {
    bdsDir?: string;
    bdsWorld?: string;
    bdsBpName: string;
    bdsRpName: string;
}

export interface ServerScoreMeta {
    id: string;
    title: string;
    pages: string[];
    pageCount?: number;
}

export interface AddonDeploymentStatus {
    status: ResourceDeployStatus;
    templateReady: boolean;
    templatePath?: string;
    bdsConfigured: boolean;
    bdsConfig: BdsConfig;
    targetConfigHash: string;
    deployedConfigHash?: string;
    loadedConfigHash?: string;
    deployedAt?: number;
    loadedAt?: number;
    catalogVersion: number;
    enabledPlugins: string[];
    deployedPlugins: string[];
    loadedPlugins: string[];
    enabledTimbres: string[];
    availableTimbres: TimbreIndexEntry[];
    scores: ServerScoreMeta[];
    issues: string[];
}

export class DeploymentService {
    constructor(
        private readonly songPort: SqliteSongPort,
        private readonly pluginService: PluginService,
        private readonly config: ServerConfig,
    ) {}

    getBdsConfig(): BdsConfig {
        const raw = this.songPort.getState("bds_config");
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Partial<BdsConfig>;
                return {
                    bdsDir: parsed.bdsDir || this.config.bdsDir,
                    bdsWorld: parsed.bdsWorld || this.config.bdsWorld,
                    bdsBpName: parsed.bdsBpName || this.config.bdsBpName,
                    bdsRpName: parsed.bdsRpName || this.config.bdsRpName,
                };
            } catch { /* fallback */ }
        }
        return {
            bdsDir: this.config.bdsDir,
            bdsWorld: this.config.bdsWorld,
            bdsBpName: this.config.bdsBpName,
            bdsRpName: this.config.bdsRpName,
        };
    }

    updateBdsConfig(next: Partial<BdsConfig>): BdsConfig {
        const current = this.getBdsConfig();
        const merged: BdsConfig = {
            bdsDir: next.bdsDir !== undefined ? next.bdsDir.trim() || undefined : current.bdsDir,
            bdsWorld: next.bdsWorld !== undefined ? next.bdsWorld.trim() || undefined : current.bdsWorld,
            bdsBpName: next.bdsBpName?.trim() || current.bdsBpName,
            bdsRpName: next.bdsRpName?.trim() || current.bdsRpName,
        };
        this.songPort.setState("bds_config", JSON.stringify(merged));
        return merged;
    }

    private customTemplatePath(): string {
        return join(dirname(this.config.pluginsDir), "server-template.mcaddon");
    }

    saveServerTemplate(bytes: Uint8Array): void {
        const path = this.customTemplatePath();
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes);
    }

    resolveTemplatePath(): string | undefined {
        const custom = this.customTemplatePath();
        if (existsSync(custom)) return custom;
        if (this.config.serverTemplatePath && existsSync(this.config.serverTemplatePath)) {
            return this.config.serverTemplatePath;
        }
        const serverDist = resolve(import.meta.dir, "../../../addon/dist/server.mcaddon");
        if (existsSync(serverDist)) return serverDist;
        const bareDist = resolve(import.meta.dir, "../../../addon/dist/template-bare.mcaddon");
        if (existsSync(bareDist)) return bareDist;
        return undefined;
    }

    private resolveTimbresDir(): string | undefined {
        const candidates = [
            this.config.timbresDir,
            this.config.webRoot ? join(this.config.webRoot, "timbres") : undefined,
            resolve(import.meta.dir, "../../../studio/public/timbres"),
        ].filter((item): item is string => Boolean(item));
        return candidates.find((dir) => existsSync(join(dir, "index.json")));
    }

    getAvailableTimbres(): TimbreIndexEntry[] {
        const byId = new Map<string, TimbreIndexEntry>();
        const bundled = PIANO_TIMBRES[0];
        const bundledLayers = pianoSoundLayers(bundled.value);
        byId.set(bundled.id, {
            id: bundled.id,
            value: bundled.value,
            label: bundled.label,
            description: bundled.description,
            required: true,
            bundled: true,
            dirs: Object.fromEntries(bundledLayers.map((l) => [`v${l + 1}`, pianoSoundId(bundled.value, l)])),
            notes: [...PIANO_SAMPLE_KEYS],
            layers: bundledLayers.map((l) => `v${l + 1}`),
            size: 0,
            file: null,
        });

        for (const { archive } of this.pluginService.listBuiltinArchives()) {
            for (const timbre of archive.timbres) {
                byId.set(timbre.id, {
                    id: timbre.id,
                    value: timbre.value ?? PIANO_TIMBRES.find((t) => t.id === timbre.id)?.value ?? 0,
                    label: timbre.label,
                    description: timbre.description ?? "",
                    required: false,
                    bundled: false,
                    dirs: timbre.dirs,
                    notes: [...timbre.notes],
                    layers: [...timbre.layers],
                    size: archive.size,
                    file: null,
                });
            }
        }
        for (const archive of this.pluginService.getActivePackArchives()) {
            for (const timbre of archive.timbres) {
                byId.set(timbre.id, {
                    id: timbre.id,
                    value: timbre.value ?? PIANO_TIMBRES.find((t) => t.id === timbre.id)?.value ?? 0,
                    label: timbre.label,
                    description: timbre.description ?? "",
                    required: false,
                    bundled: false,
                    dirs: timbre.dirs,
                    notes: [...timbre.notes],
                    layers: [...timbre.layers],
                    size: archive.size,
                    file: null,
                });
            }
        }

        const dir = this.resolveTimbresDir();
        if (dir) {
            try {
                const legacy = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as TimbreIndexEntry[];
                for (const item of legacy) {
                    if (!byId.has(item.id)) byId.set(item.id, item);
                }
            } catch { /* ignore */ }
        }

        const coreOrder = new Map<string, number>(PIANO_TIMBRES.map((t, i) => [t.id, i]));
        return [...byId.values()].sort(
            (a, b) => (coreOrder.get(a.id) ?? 99) - (coreOrder.get(b.id) ?? 99) || a.label.localeCompare(b.label, "zh-CN"),
        );
    }

    getEnabledTimbres(): string[] {
        const raw = this.songPort.getState("enabled_timbres_json");
        let list: string[] = [];
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    list = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
                }
            } catch { /* fallback */ }
        }
        const pluginTimbres = this.pluginService
            .getActivePackArchives()
            .flatMap((archive) => archive.timbres.map((t) => t.id));
        return ["piano", ...new Set([...pluginTimbres, ...list].filter((id) => id !== "piano"))];
    }

    updateEnabledTimbres(ids: readonly string[]): string[] {
        const available = this.getAvailableTimbres();
        const allowed = available.length > 0 ? new Set(available.map((t) => t.id)) : null;
        const normalized = [
            "piano",
            ...[...new Set(ids)].filter((id) => id && id !== "piano" && (!allowed || allowed.has(id))),
        ];
        this.songPort.setState("enabled_timbres_json", JSON.stringify(normalized));
        return normalized;
    }

    private scoresDir(): string {
        return join(dirname(this.config.pluginsDir), "scores");
    }

    private scoresMetaPath(): string {
        return join(this.scoresDir(), "scores.json");
    }

    listScores(): ServerScoreMeta[] {
        const metaFile = this.scoresMetaPath();
        if (!existsSync(metaFile)) return [];
        try {
            const parsed = JSON.parse(readFileSync(metaFile, "utf8"));
            return Array.isArray(parsed) ? (parsed as ServerScoreMeta[]) : [];
        } catch {
            return [];
        }
    }

    private saveScoresMeta(scores: readonly ServerScoreMeta[]): void {
        const dir = this.scoresDir();
        mkdirSync(dir, { recursive: true });
        writeFileSync(this.scoresMetaPath(), `${JSON.stringify(scores, null, 2)}\n`);
    }

    addScore(input: {
        id: string;
        title: string;
        pages: string[];
        pageCount?: number;
        assets: Record<string, string>;
    }): ServerScoreMeta[] {
        const id = input.id.trim();
        const title = input.title.trim();
        if (!SCORE_ID_PATTERN.test(id)) {
            throw new Error(`曲谱 ID 格式无效：${id}`);
        }
        if (!title) throw new Error("曲谱标题不能为空");
        if (!Array.isArray(input.pages) || input.pages.length === 0) {
            throw new Error("曲谱至少需要 1 页图片");
        }
        const current = this.listScores().filter((item) => item.id !== id);
        if (current.length >= MAX_SCORES) {
            throw new Error(`自定义曲谱数量已达上限 (${MAX_SCORES})`);
        }
        const baseDir = this.scoresDir();
        for (const [relPath, encoded] of Object.entries(input.assets ?? {})) {
            const normalized = relPath.replaceAll("\\", "/").replace(/^\/+/, "");
            if (!normalized || normalized.includes("..")) {
                throw new Error(`非法曲谱资源路径：${relPath}`);
            }
            const outPath = join(baseDir, normalized);
            mkdirSync(dirname(outPath), { recursive: true });
            const bytes = encoded.startsWith("data:")
                ? Uint8Array.from(Buffer.from(encoded.split(",")[1] ?? "", "base64"))
                : encoded.includes("+") || encoded.includes("/") || encoded.endsWith("=")
                  ? Uint8Array.from(Buffer.from(encoded, "base64"))
                  : decodeBase64Url(encoded);
            writeFileSync(outPath, bytes);
        }
        const entry: ServerScoreMeta = {
            id,
            title,
            pages: input.pages,
            ...(input.pageCount ? { pageCount: input.pageCount } : {}),
        };
        const next = [...current, entry];
        this.saveScoresMeta(next);
        return next;
    }

    removeScore(id: string): ServerScoreMeta[] {
        const current = this.listScores();
        const target = current.find((item) => item.id === id);
        const next = current.filter((item) => item.id !== id);
        this.saveScoresMeta(next);
        if (target) {
            const baseDir = this.scoresDir();
            for (const rel of [...target.pages, scoreStandPath(target.id)]) {
                const full = join(baseDir, rel);
                if (existsSync(full)) rmSync(full, { force: true });
            }
        }
        return next;
    }

    getScoreAsset(relPath: string): Uint8Array | undefined {
        const normalized = relPath.replaceAll("\\", "/").replace(/^\/+/, "");
        if (!normalized || normalized.includes("..")) return undefined;
        const full = join(this.scoresDir(), normalized);
        if (!existsSync(full)) return undefined;
        return new Uint8Array(readFileSync(full));
    }

    private async buildAssemblyExtras(
        templateScores: readonly AssemblyScoreEntry[],
        activeArchives: readonly PbePluginArchive[],
    ): Promise<{
        timbres?: TimbreExportSelection;
        scores?: AssemblyScoreEntry[];
    }> {
        const enabledTimbres = this.getEnabledTimbres();
        const pluginTimbreIds = new Set(activeArchives.flatMap((a) => a.timbres.map((t) => t.id)));
        const extraTimbreIds = enabledTimbres.filter((id) => id !== "piano" && !pluginTimbreIds.has(id));
        let timbres: TimbreExportSelection | undefined;
        if (extraTimbreIds.length > 0) {
            const dir = this.resolveTimbresDir();
            const all = this.getAvailableTimbres();
            const selected: LoadedTimbrePack[] = [];
            const builtins = this.pluginService.listBuiltinArchives();
            for (const id of extraTimbreIds) {
                const meta = all.find((t) => t.id === id);
                if (!meta) continue;
                const builtinMatch = builtins.find((b) => b.archive.timbres.some((t) => t.id === id));
                if (builtinMatch) {
                    const timbre = builtinMatch.archive.timbres.find((t) => t.id === id)!;
                    const files = new Map<string, Uint8Array>();
                    for (const [path, bytes] of builtinMatch.archive.sounds) files.set(path, bytes);
                    selected.push({ meta, files, soundDefinitions: timbre.soundDefinitions });
                    continue;
                }
                if (dir && meta.file) {
                    const zipPath = join(dir, meta.file);
                    if (!existsSync(zipPath)) continue;
                    const entries = await readAddonArchive(new Uint8Array(readFileSync(zipPath)));
                    const files = new Map(entries.map((f) => [f.path, f.bytes]));
                    const defEntry = entries.find((f) => f.path === "sound_definitions.json");
                    const soundDefinitions = defEntry
                        ? (JSON.parse(new TextDecoder().decode(defEntry.bytes)).sound_definitions ?? {})
                        : {};
                    selected.push({ meta, files, soundDefinitions });
                }
            }
            if (all.length > 0) {
                timbres = { all, selected, enabledIds: enabledTimbres };
            }
        }

        const customMeta = this.listScores();
        let scores: AssemblyScoreEntry[] | undefined;
        if (customMeta.length > 0) {
            const customEntries: AssemblyScoreEntry[] = customMeta.map((meta) => {
                const assets = new Map<string, Uint8Array>();
                for (const page of [...meta.pages, scoreStandPath(meta.id)]) {
                    const bytes = this.getScoreAsset(page);
                    if (bytes) assets.set(page, bytes);
                }
                return {
                    id: meta.id,
                    title: meta.title,
                    pages: meta.pages,
                    pageCount: meta.pageCount,
                    source: "custom",
                    assets,
                };
            });
            const customIds = new Set(customEntries.map((s) => s.id));
            scores = [
                ...templateScores.filter((s) => !customIds.has(s.id)),
                ...customEntries,
            ].slice(0, MAX_SCORES);
        }

        return { timbres, scores };
    }

    private computeTargetConfigHash(): { hash: string; plugins: string[]; issues: string[] } {
        const issues: string[] = [];
        const archives = this.pluginService.getActivePackArchives();
        const pluginSpecs = archives
            .map((archive) => `${archive.manifest.id}@${archive.manifest.version}:${crc32Hex(archive.bytes)}`)
            .sort();
        const enabledTimbres = this.getEnabledTimbres();
        const pluginTimbreIds = new Set(archives.flatMap((a) => a.timbres.map((t) => t.id)));
        const hasExtraTimbres = enabledTimbres.some((id) => id !== "piano" && !pluginTimbreIds.has(id));
        const availableTimbres = this.getAvailableTimbres();
        const timbreSpecs = hasExtraTimbres && availableTimbres.length > 0 ? [...enabledTimbres].sort() : [];
        const customScores = this.listScores();
        const scoreSpecs = customScores.length
            ? customScores.map((s) => `${s.id}:${s.pages.join(",")}`).sort()
            : undefined;
        const payload = JSON.stringify({
            plugins: pluginSpecs,
            timbres: timbreSpecs,
            embedSongs: false,
            ...(scoreSpecs ? { scores: scoreSpecs } : {}),
        });
        const hash = crc32Hex(encodeUtf8(payload)).padStart(8, "0");

        const catalog = this.pluginService.listCatalog();
        for (const p of catalog) {
            if (p.installed && p.enabled && p.missingDependencies.length > 0) {
                issues.push(`插件 ${p.name} 缺少或未信任依赖：${p.missingDependencies.join(", ")}`);
            }
            if (p.installed && !p.compatible) {
                issues.push(`插件 ${p.name} 不兼容：${p.compatibilityReason ?? "API 版本不匹配"}`);
            }
        }

        return {
            hash,
            plugins: archives.map((a) => a.manifest.id),
            issues,
        };
    }

    getStatus(): AddonDeploymentStatus {
        const templatePath = this.resolveTemplatePath();
        const bdsConfig = this.getBdsConfig();
        const bdsConfigured = Boolean(bdsConfig.bdsDir);
        const { hash: targetConfigHash, plugins: enabledPlugins, issues } = this.computeTargetConfigHash();

        const deployedConfigHash = this.songPort.getState("deployed_config_hash");
        const loadedConfigHash = this.songPort.getState("loaded_config_hash");
        const deployedAtRaw = this.songPort.getState("deployed_at");
        const loadedAtRaw = this.songPort.getState("loaded_at");
        const deployedPlugins = parseList(this.songPort.getState("deployed_plugins_json"));
        const loadedPlugins = parseList(this.songPort.getState("loaded_plugins_json"));

        let status: ResourceDeployStatus;
        if (!templatePath || issues.length > 0) {
            status = "unavailable";
        } else if (deployedConfigHash === targetConfigHash && loadedConfigHash === targetConfigHash) {
            status = "active";
        } else if (deployedConfigHash === targetConfigHash) {
            status = "pending_restart";
        } else {
            status = "pending_deploy";
        }

        return {
            status,
            templateReady: Boolean(templatePath),
            ...(templatePath ? { templatePath } : {}),
            bdsConfigured,
            bdsConfig,
            targetConfigHash,
            ...(deployedConfigHash ? { deployedConfigHash } : {}),
            ...(loadedConfigHash ? { loadedConfigHash } : {}),
            ...(deployedAtRaw ? { deployedAt: Number(deployedAtRaw) } : {}),
            ...(loadedAtRaw ? { loadedAt: Number(loadedAtRaw) } : {}),
            catalogVersion: this.songPort.getCatalogVersion(),
            enabledPlugins,
            deployedPlugins,
            loadedPlugins,
            enabledTimbres: this.getEnabledTimbres(),
            availableTimbres: this.getAvailableTimbres(),
            scores: this.listScores(),
            issues,
        };
    }

    private async prepareAssembledTemplate() {
        const templatePath = this.resolveTemplatePath();
        if (!templatePath) {
            throw new Error("未找到服务器基础模板（server.mcaddon / template-bare.mcaddon），请先上传或构建模板");
        }
        const raw = new Uint8Array(readFileSync(templatePath));
        const stored = zipSync(unzipSync(raw), { level: 0 });
        const info = await loadAddonTemplate(stored);
        const archives = this.pluginService.getActivePackArchives();
        const extras = await this.buildAssemblyExtras(info.scores, archives);
        return { info, archives, ...extras };
    }

    async buildDownloadBytes(): Promise<Uint8Array> {
        const { info, archives, timbres, scores } = await this.prepareAssembledTemplate();
        return assembleAddonBytes(info, [], {
            name: info.bpManifest.header?.name ?? "钢琴(服务器版)",
            desc: info.bpManifest.header?.description ?? "PianoBE 服务器附加包",
            randomUuid: false,
            plugins: archives,
            ...(timbres ? { timbres } : {}),
            ...(scores ? { scores } : {}),
            embedSongs: false,
        });
    }

    async deployToBds(): Promise<AddonDeploymentStatus> {
        const bdsConfig = this.getBdsConfig();
        if (!bdsConfig.bdsDir) {
            throw new Error("未配置 BDS 目录，请先在附加包配置中填写 BDS 目录");
        }
        if (!existsSync(bdsConfig.bdsDir)) {
            throw new Error(`BDS 目录不存在：${bdsConfig.bdsDir}`);
        }

        const { info, archives, timbres, scores } = await this.prepareAssembledTemplate();
        const assembled = assembleAddonTemplate(info, [], {
            name: info.bpManifest.header?.name ?? "钢琴(服务器版)",
            desc: info.bpManifest.header?.description ?? "PianoBE 服务器附加包",
            randomUuid: false,
            plugins: archives,
            ...(timbres ? { timbres } : {}),
            ...(scores ? { scores } : {}),
            embedSongs: false,
        });
        const { bpFiles, rpFiles } = extractPackFiles(assembled.addon, assembled.bpPath, assembled.rpPath);

        const bpRoot = join(bdsConfig.bdsDir, "behavior_packs");
        const rpRoot = join(bdsConfig.bdsDir, "resource_packs");
        mkdirSync(bpRoot, { recursive: true });
        mkdirSync(rpRoot, { recursive: true });

        writePackDirAtomic(bpRoot, bdsConfig.bdsBpName, bpFiles);
        writePackDirAtomic(rpRoot, bdsConfig.bdsRpName, rpFiles);

        const bpManifest = JSON.parse(new TextDecoder().decode(bpFiles.get("manifest.json")!));
        const rpManifest = JSON.parse(new TextDecoder().decode(rpFiles.get("manifest.json")!));

        const worldDir = resolveTargetWorldDir(bdsConfig.bdsDir, bdsConfig.bdsWorld);
        if (worldDir) {
            updateWorldPackFile(
                join(worldDir, "world_behavior_packs.json"),
                bpManifest.header.uuid,
                bpManifest.header.version,
            );
            updateWorldPackFile(
                join(worldDir, "world_resource_packs.json"),
                rpManifest.header.uuid,
                rpManifest.header.version,
            );
        }

        this.songPort.setState("deployed_config_hash", assembled.configHash);
        this.songPort.setState("deployed_plugins_json", JSON.stringify(assembled.installedPlugins));
        this.songPort.setState("deployed_at", String(Date.now()));
        return this.getStatus();
    }

    reportLoaded(input: { configHash?: string; installedPlugins?: string[] }): AddonDeploymentStatus {
        if (input.configHash) {
            this.songPort.setState("loaded_config_hash", input.configHash);
        }
        if (Array.isArray(input.installedPlugins)) {
            this.songPort.setState("loaded_plugins_json", JSON.stringify(input.installedPlugins));
        }
        this.songPort.setState("loaded_at", String(Date.now()));
        return this.getStatus();
    }
}

function writePackDirAtomic(parentDir: string, folderName: string, files: ReadonlyMap<string, Uint8Array>): void {
    const targetDir = join(parentDir, folderName);
    const stageDir = join(parentDir, `.${folderName}.staging_${Date.now()}`);
    const backupDir = join(parentDir, `.${folderName}.bak_${Date.now()}`);
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });

    try {
        for (const [relPath, bytes] of files) {
            const outPath = join(stageDir, relPath);
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, bytes);
        }
        if (existsSync(targetDir)) {
            renameSync(targetDir, backupDir);
        }
        renameSync(stageDir, targetDir);
        rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
        if (!existsSync(targetDir) && existsSync(backupDir)) {
            try { renameSync(backupDir, targetDir); } catch { /* ignore */ }
        }
        rmSync(stageDir, { recursive: true, force: true });
        throw error;
    }
}

function resolveTargetWorldDir(bdsDir: string, configuredWorld?: string): string | undefined {
    const worldsRoot = join(bdsDir, "worlds");
    if (configuredWorld) {
        const dir = join(worldsRoot, configuredWorld);
        mkdirSync(dir, { recursive: true });
        return dir;
    }
    const propsPath = join(bdsDir, "server.properties");
    if (existsSync(propsPath)) {
        const match = /^level-name=(.+)$/m.exec(readFileSync(propsPath, "utf8"));
        if (match?.[1]?.trim()) {
            const dir = join(worldsRoot, match[1].trim());
            mkdirSync(dir, { recursive: true });
            return dir;
        }
    }
    if (!existsSync(worldsRoot)) return undefined;
    const dirs = readdirSync(worldsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (dirs.length === 1) return join(worldsRoot, dirs[0].name);
    const bedrockLevel = join(worldsRoot, "Bedrock level");
    if (existsSync(bedrockLevel)) return bedrockLevel;
    return undefined;
}

function updateWorldPackFile(filePath: string, packId: string, version: number[]): void {
    let entries: Array<{ pack_id: string; version: number[] }> = [];
    if (existsSync(filePath)) {
        try {
            const parsed = JSON.parse(readFileSync(filePath, "utf8"));
            if (Array.isArray(parsed)) entries = parsed;
        } catch {
            entries = [];
        }
    }
    const existingIndex = entries.findIndex((item) => item?.pack_id === packId);
    const nextEntry = { pack_id: packId, version };
    if (existingIndex >= 0) {
        entries[existingIndex] = nextEntry;
    } else {
        entries.push(nextEntry);
    }
    writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}

function parseList(raw?: string): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}
