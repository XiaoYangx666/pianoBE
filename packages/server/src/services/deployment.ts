import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
    assembleAddonBytes,
    assembleAddonTemplate,
    extractPackFiles,
    loadAddonTemplate,
} from "@piano/assembly";
import { crc32Hex, encodeUtf8, type ResourceDeployStatus } from "@piano/core";
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

    private computeTargetConfigHash(): { hash: string; plugins: string[]; issues: string[] } {
        const issues: string[] = [];
        const archives = this.pluginService.getActivePackArchives();
        const pluginSpecs = archives
            .map((archive) => `${archive.manifest.id}@${archive.manifest.version}:${crc32Hex(archive.bytes)}`)
            .sort();
        const payload = JSON.stringify({
            plugins: pluginSpecs,
            timbres: [],
            embedSongs: false,
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
        return { info, archives };
    }

    async buildDownloadBytes(): Promise<Uint8Array> {
        const { info, archives } = await this.prepareAssembledTemplate();
        return assembleAddonBytes(info, [], {
            name: info.bpManifest.header?.name ?? "钢琴(服务器版)",
            desc: info.bpManifest.header?.description ?? "PianoBE 服务器附加包",
            randomUuid: false,
            plugins: archives,
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

        const { info, archives } = await this.prepareAssembledTemplate();
        const assembled = assembleAddonTemplate(info, [], {
            name: info.bpManifest.header?.name ?? "钢琴(服务器版)",
            desc: info.bpManifest.header?.description ?? "PianoBE 服务器附加包",
            randomUuid: false,
            plugins: archives,
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
