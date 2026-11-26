import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import {
    MAX_SCORES,
    SCORE_ID_PATTERN,
    assembleAddonBytes,
    assembleAddonTemplate,
    extractPackFiles,
    loadAddonTemplate,
    scoreStandPath,
    type AssemblyScoreEntry,
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

export type BdsPackMode = "development" | "release";

export interface BdsConfig {
    bdsDir?: string;
    bdsWorld?: string;
    bdsBpName: string;
    bdsRpName: string;
    /** development = development_behavior_packs / development_resource_packs；release = behavior_packs / resource_packs */
    bdsPackMode: BdsPackMode;
    /** 自定义 manifest 包名；空则沿用模板 */
    packName?: string;
    /** 自定义 manifest 描述；空则沿用模板 */
    packDescription?: string;
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
    warnings: string[];
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
                    bdsPackMode: parsed.bdsPackMode === "release" ? "release" : parsed.bdsPackMode === "development"
                        ? "development"
                        : this.config.bdsPackMode,
                    packName: typeof parsed.packName === "string" ? parsed.packName : this.config.packName,
                    packDescription: typeof parsed.packDescription === "string"
                        ? parsed.packDescription
                        : this.config.packDescription,
                };
            } catch { /* fallback */ }
        }
        return {
            bdsDir: this.config.bdsDir,
            bdsWorld: this.config.bdsWorld,
            bdsBpName: this.config.bdsBpName,
            bdsRpName: this.config.bdsRpName,
            bdsPackMode: this.config.bdsPackMode,
            packName: this.config.packName,
            packDescription: this.config.packDescription,
        };
    }

    updateBdsConfig(next: Partial<BdsConfig>): BdsConfig {
        const current = this.getBdsConfig();
        const merged: BdsConfig = {
            bdsDir: next.bdsDir !== undefined ? next.bdsDir.trim() || undefined : current.bdsDir,
            bdsWorld: next.bdsWorld !== undefined ? next.bdsWorld.trim() || undefined : current.bdsWorld,
            bdsBpName: next.bdsBpName?.trim() || current.bdsBpName,
            bdsRpName: next.bdsRpName?.trim() || current.bdsRpName,
            bdsPackMode: next.bdsPackMode === undefined
                ? current.bdsPackMode
                : next.bdsPackMode === "release"
                  ? "release"
                  : "development",
            packName: next.packName !== undefined ? next.packName.trim() : current.packName,
            packDescription: next.packDescription !== undefined
                ? next.packDescription.trim()
                : current.packDescription,
        };
        if (!isSafeFolderName(merged.bdsBpName) || !isSafeFolderName(merged.bdsRpName)) {
            throw new Error("行为包/资源包目录名不能为空，且不能包含路径分隔符");
        }
        this.songPort.setState("bds_config", JSON.stringify(merged));
        return merged;
    }

    /** 传给装配器的自定义 manifest 名称；空值表示沿用模板。 */
    private packIdentityOptions(): { name?: string; desc?: string } {
        const bds = this.getBdsConfig();
        const name = bds.packName?.trim() || undefined;
        const desc = bds.packDescription?.trim() || undefined;
        return { ...(name ? { name } : {}), ...(desc ? { desc } : {}) };
    }

    getDownloadFileName(): string {
        const name = this.getBdsConfig().packName?.trim() || "pianobe-server";
        return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")}.mcaddon`;
    }

    private customTemplatePath(): string {
        return join(this.config.dataDir, "server-template.mcaddon");
    }

    saveServerTemplate(bytes: Uint8Array): void {
        const path = this.customTemplatePath();
        mkdirSync(dirname(path), { recursive: true });
        writeFileAtomic(path, bytes);
    }

    resolveTemplatePath(): string | undefined {
        const candidates = [
            this.customTemplatePath(),
            this.config.serverTemplatePath,
            resolve(import.meta.dir, "server.mcaddon"),
            resolve(import.meta.dir, "../server.mcaddon"),
            resolve(import.meta.dir, "../../server.mcaddon"),
            resolve(import.meta.dir, "../../../server.mcaddon"),
            resolve(import.meta.dir, "../../addon/dist/server.mcaddon"),
            resolve(import.meta.dir, "../../../addon/dist/server.mcaddon"),
            resolve(import.meta.dir, "../../addon/dist/template.mcaddon"),
            resolve(import.meta.dir, "../../../addon/dist/template.mcaddon"),
        ];
        return candidates.find((p): p is string => Boolean(p && existsSync(p)));
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

        for (const archive of this.pluginService.listInstalledArchives()) {
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

        const coreOrder = new Map<string, number>(PIANO_TIMBRES.map((t, i) => [t.id, i]));
        return [...byId.values()].sort(
            (a, b) => (coreOrder.get(a.id) ?? 99) - (coreOrder.get(b.id) ?? 99) || a.label.localeCompare(b.label, "zh-CN"),
        );
    }

    getEnabledTimbres(): string[] {
        const pluginTimbres = this.pluginService
            .getActivePackArchives()
            .flatMap((archive) => archive.timbres.map((t) => t.id));
        return ["piano", ...new Set(pluginTimbres.filter((id) => id !== "piano"))];
    }

    private scoresDir(): string {
        return join(this.config.dataDir, "scores");
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
        writeFileAtomic(this.scoresMetaPath(), `${JSON.stringify(scores, null, 2)}\n`);
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
            writeFileAtomic(outPath, bytes);
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
    ): Promise<{
        scores?: AssemblyScoreEntry[];
    }> {
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

        return { scores };
    }

    private computeTargetConfigHash(): { hash: string; plugins: string[]; issues: string[] } {
        const issues: string[] = [];
        this.pluginService.syncDirectory();
        const archives = this.pluginService.getActivePackArchives();
        const pluginSpecs = archives
            .map((archive) => `${archive.manifest.id}@${archive.manifest.version}:${crc32Hex(archive.bytes)}`)
            .sort();
        const customScores = this.listScores();
        const scoreSpecs = customScores.length
            ? customScores.map((s) => `${s.id}:${s.pages.join(",")}`).sort()
            : undefined;
        const identity = this.packIdentityOptions();
        const payload = JSON.stringify({
            plugins: pluginSpecs,
            timbres: [],
            embedSongs: false,
            pack: {
                name: identity.name ?? "",
                description: identity.desc ?? "",
            },
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
        const deployedTarget = parseTarget(this.songPort.getState("deployed_target_json"));
        const targetChanged =
            !deployedTarget ||
            deployedTarget.mode !== bdsConfig.bdsPackMode ||
            deployedTarget.bpName !== bdsConfig.bdsBpName ||
            deployedTarget.rpName !== bdsConfig.bdsRpName;

        let status: ResourceDeployStatus;
        if (!templatePath || issues.length > 0) {
            status = "unavailable";
        } else if (
            deployedConfigHash === targetConfigHash &&
            !targetChanged &&
            loadedConfigHash === targetConfigHash
        ) {
            status = "active";
        } else if (deployedConfigHash === targetConfigHash && !targetChanged) {
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
            warnings: this.collectWarnings(bdsConfig),
        };
    }

    /** 部署时的提示信息（例如旧目录已归档），与阻塞部署的 issues 分开。 */
    private collectWarnings(bds: BdsConfig): string[] {
        const warnings = parseList(this.songPort.getState("deploy_warnings_json"));
        if (!bds.bdsDir) return warnings;
        const roots = resolvePackRoots(bds.bdsDir, bds.bdsPackMode);
        const legacy = [
            ["行为包", roots.legacyBpRoot, bds.bdsBpName],
            ["资源包", roots.legacyRpRoot, bds.bdsRpName],
        ] as const;
        for (const [label, root, name] of legacy) {
            const dir = join(root, name);
            if (!existsSync(dir)) continue;
            const message = `检测到旧目录 ${dir} 仍存在同名${label}，可能被 BDS 重复加载；请在重启 BDS 前删除或移走该目录`;
            if (!warnings.includes(message)) warnings.push(message);
        }
        return warnings;
    }

    private async prepareAssembledTemplate() {
        const templatePath = this.resolveTemplatePath();
        if (!templatePath) {
            throw new Error("未找到服务器基础模板（server.mcaddon / template.mcaddon），请先上传或构建模板");
        }
        this.pluginService.syncDirectory();
        const raw = new Uint8Array(readFileSync(templatePath));
        const stored = zipSync(unzipSync(raw), { level: 0 });
        const info = await loadAddonTemplate(stored);
        const archives = this.pluginService.getActivePackArchives();
        const extras = await this.buildAssemblyExtras(info.scores);
        return { info, archives, ...extras };
    }

    async buildDownloadBytes(): Promise<Uint8Array> {
        const { info, archives, scores } = await this.prepareAssembledTemplate();
        const identity = this.packIdentityOptions();
        return assembleAddonBytes(info, [], {
            name: identity.name,
            desc: identity.desc,
            randomUuid: false,
            plugins: archives,
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

        const { info, archives, scores } = await this.prepareAssembledTemplate();
        const identity = this.packIdentityOptions();
        const assembled = assembleAddonTemplate(info, [], {
            name: identity.name,
            desc: identity.desc,
            randomUuid: false,
            plugins: archives,
            ...(scores ? { scores } : {}),
            embedSongs: false,
        });
        const { bpFiles, rpFiles } = extractPackFiles(assembled.addon, assembled.bpPath, assembled.rpPath);

        const roots = resolvePackRoots(bdsConfig.bdsDir, bdsConfig.bdsPackMode);
        const bpRoot = roots.bpRoot;
        const rpRoot = roots.rpRoot;
        mkdirSync(bpRoot, { recursive: true });
        mkdirSync(rpRoot, { recursive: true });

        this.bumpPackVersions(bpFiles, rpFiles);

        writePackDirAtomic(bpRoot, bdsConfig.bdsBpName, bpFiles);
        writePackDirAtomic(rpRoot, bdsConfig.bdsRpName, rpFiles);

        const bpManifest = JSON.parse(new TextDecoder().decode(bpFiles.get("manifest.json")!));
        const rpManifest = JSON.parse(new TextDecoder().decode(rpFiles.get("manifest.json")!));

        // 旧目录里同名、同 UUID 的包会和开发目录冲突，成功写入后归档到隐藏目录（不直接删除）。
        const warnings: string[] = [];
        const archived = [
            ...this.archiveLegacyPack(roots.legacyBpRoot, bdsConfig.bdsBpName, bpManifest.header.uuid),
            ...this.archiveLegacyPack(roots.legacyRpRoot, bdsConfig.bdsRpName, rpManifest.header.uuid),
        ];
        if (archived.length > 0) {
            warnings.push(`已归档旧目录中的同名附加包：${archived.join("、")}（可确认新包生效后手动删除）`);
        }

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

        this.songPort.setState("deploy_warnings_json", JSON.stringify(warnings));
        this.songPort.setState(
            "deployed_target_json",
            JSON.stringify({
                mode: bdsConfig.bdsPackMode,
                bpName: bdsConfig.bdsBpName,
                rpName: bdsConfig.bdsRpName,
            }),
        );
        this.songPort.setState("deployed_config_hash", assembled.configHash);
        this.songPort.setState("deployed_plugins_json", JSON.stringify(assembled.installedPlugins));
        this.songPort.setState("deployed_at", String(Date.now()));
        return this.getStatus();
    }

    /**
     * 每次部署都把 BP/RP 的 header.version patch 位 +1，并同步两侧依赖版本。
     * 客户端按 uuid+version 缓存附加包：版本不变时重进服务器不会重新下载资源包，
     * 会出现"资源包内容已更新但客户端仍是旧缓存"的问题。
     */
    private bumpPackVersions(bpFiles: Map<string, Uint8Array>, rpFiles: Map<string, Uint8Array>): void {
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const bpRaw = bpFiles.get("manifest.json");
        const rpRaw = rpFiles.get("manifest.json");
        if (!bpRaw || !rpRaw) return;

        const sequence = (Number(this.songPort.getState("deploy_seq") ?? 0) || 0) + 1;
        const bump = (manifest: Record<string, unknown>) => {
            const header = (manifest.header ?? {}) as { version?: unknown };
            // 模板里的 version 可能是 "1.3.0" 这样的字符串，也可能是数组
            const base = Array.isArray(header.version)
                ? header.version.map(Number)
                : typeof header.version === "string"
                  ? header.version.split(".").map(Number)
                  : [1, 0, 0];
            const next = [
                Number.isFinite(base[0]) ? base[0] : 1,
                Number.isFinite(base[1]) ? base[1] : 0,
                (Number.isFinite(base[2]) ? base[2] : 0) + sequence,
            ];
            // format_version 3 的 manifest 要求字符串版本（如 "1.3.4"），数组会被 BDS 拒绝
            const text = next.join(".");
            header.version = text;
            manifest.header = header;
            return { next, text };
        };

        const bpManifest = JSON.parse(decoder.decode(bpRaw)) as Record<string, unknown>;
        const rpManifest = JSON.parse(decoder.decode(rpRaw)) as Record<string, unknown>;
        const bpVersion = bump(bpManifest);
        const rpVersion = bump(rpManifest);

        // BP → RP 与 RP → BP 的依赖版本都对齐，避免 manifest 里残留旧版本
        const bpUuid = (bpManifest.header as { uuid?: string }).uuid;
        const rpUuid = (rpManifest.header as { uuid?: string }).uuid;
        const syncDependency = (
            manifest: Record<string, unknown>,
            uuid: string | undefined,
            version: string
        ) => {
            const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
            for (const dep of deps) {
                if (dep && typeof dep === "object" && uuid && (dep as { uuid?: string }).uuid === uuid) {
                    (dep as { version?: string }).version = version;
                }
            }
        };
        syncDependency(bpManifest, rpUuid, rpVersion.text);
        syncDependency(rpManifest, bpUuid, bpVersion.text);

        bpFiles.set("manifest.json", encoder.encode(`${JSON.stringify(bpManifest, null, 4)}\n`));
        rpFiles.set("manifest.json", encoder.encode(`${JSON.stringify(rpManifest, null, 4)}\n`));
        this.songPort.setState("deploy_seq", String(sequence));
    }

    /**
     * 把旧部署目录（例如从 behavior_packs 切到 development_behavior_packs）中的同名包
     * 归档到隐藏目录，避免同 UUID 的包被 BDS 重复加载；UUID 不同则不碰。
     */
    private archiveLegacyPack(root: string, folderName: string, expectedUuid: string): string[] {
        const dir = join(root, folderName);
        if (!existsSync(dir)) return [];
        let uuid: string | undefined;
        try {
            uuid = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))?.header?.uuid;
        } catch {
            return [];
        }
        if (!uuid || uuid.toLowerCase() !== expectedUuid.toLowerCase()) return [];
        const target = join(root, `.${folderName}.legacy_${Date.now()}`);
        try {
            renameSync(dir, target);
            return [target];
        } catch {
            return [];
        }
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

function isSafeFolderName(name: string): boolean {
    return Boolean(name) && name !== "." && name !== ".." && !/[\\/]/.test(name);
}

interface PackRoots {
    bpRoot: string;
    rpRoot: string;
    legacyBpRoot: string;
    legacyRpRoot: string;
}

/**
 * development 模式使用 development_behavior_packs / development_resource_packs，
 * release 模式使用传统的 behavior_packs / resource_packs。
 */
function resolvePackRoots(bdsDir: string, mode: BdsPackMode): PackRoots {
    if (mode === "release") {
        return {
            bpRoot: join(bdsDir, "behavior_packs"),
            rpRoot: join(bdsDir, "resource_packs"),
            legacyBpRoot: join(bdsDir, "development_behavior_packs"),
            legacyRpRoot: join(bdsDir, "development_resource_packs"),
        };
    }
    return {
        bpRoot: join(bdsDir, "development_behavior_packs"),
        rpRoot: join(bdsDir, "development_resource_packs"),
        legacyBpRoot: join(bdsDir, "behavior_packs"),
        legacyRpRoot: join(bdsDir, "resource_packs"),
    };
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
    writeFileAtomic(filePath, `${JSON.stringify(entries, null, 2)}\n`);
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

function parseTarget(raw?: string): { mode: BdsPackMode; bpName: string; rpName: string } | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw) as Partial<{ mode: BdsPackMode; bpName: string; rpName: string }>;
        if (
            (parsed.mode === "development" || parsed.mode === "release") &&
            typeof parsed.bpName === "string" &&
            typeof parsed.rpName === "string"
        ) {
            return { mode: parsed.mode, bpName: parsed.bpName, rpName: parsed.rpName };
        }
    } catch { /* ignore */ }
    return undefined;
}
