import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
    compilePerformanceSource,
    computeMusicFingerprint,
    extractCueEffects,
    readSongHeader,
    sameSongMusic,
    validateSong,
    type PerformanceCue,
} from "@piano/core";
import {
    isApiVersionCompatible,
    orderVfxPlugins,
    pluginHasExecutableCode,
    validatePluginManifest,
    VFX_API_VERSION,
    type VfxPluginManifest,
} from "./plugin";
import { readStagePropAssets, STAGE_PROP_RP_TREES, type StagePropAssets } from "./stagePropAssets";

export * from "./stagePropAssets";

export const MAX_PLUGIN_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_PLUGIN_ARCHIVE_FILES = 2000;

export const HOST_PARTICLE_IDS: readonly string[] = [
    "field",
    "wave",
    "beam",
    "ripple",
    "fountain",
    "curtain",
    "orbit",
    "shaft",
    "shaft_upright",
    "shard",
    "draw_point",
    "draw_stroke",
    "draw_plane",
    "draw_cloud",
    "draw_comet",
    "dust",
    "shock",
];

export const HOST_TEXTURES: readonly string[] = ["textures/particle/vfx_lab"];

export interface PluginSongEntry {
    id: string;
    name: string;
    duration: number;
    noteCount: number;
    musicFingerprint: string;
    bytes: Uint8Array;
    path: string;
}

export interface PluginPerformanceEntry {
    id: string;
    name: string;
    author?: string;
    description?: string;
    songId: string;
    musicFingerprint?: string;
    cues: readonly PerformanceCue[];
    requiredEffects: readonly string[];
    requiredPlugins?: readonly string[];
    path: string;
}

export interface PluginLibraryEntry {
    id: string;
    name: string;
    description?: string;
    author?: string;
    songs: readonly string[];
    path: string;
}

export interface PbePluginArchive {
    manifest: VfxPluginManifest;
    bytes: Uint8Array;
    size: number;
    hasExecutableCode: boolean;
    vfxEntryJs?: string;
    particles: Map<string, Uint8Array>;
    textures: Map<string, Uint8Array>;
    previews: Map<string, Uint8Array>;
    files: Map<string, Uint8Array>;
    stageProps: readonly StagePropAssets[];
    externalParticleTextures: readonly string[];
    songs: Map<string, PluginSongEntry>;
    performances: readonly PluginPerformanceEntry[];
    libraries: readonly PluginLibraryEntry[];
}

const HOST_TEXTURE_SET = new Set<string>(HOST_TEXTURES);
const ALLOWED_EXTERNAL_IMPORTS = new Set<string>(["@piano/vfx", "@piano/core"]);
const FORBIDDEN_PLUGIN_CODE_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
    { pattern: /\beval\s*\(/, reason: "禁止在插件代码中使用 eval()" },
    { pattern: /\bnew\s+Function\b/, reason: "禁止在插件代码中使用 new Function()" },
    { pattern: /@minecraft\//, reason: "禁止插件直接导入 @minecraft/* API" },
];

export function pluginSlug(pluginId: string): string {
    return pluginId.replace(/[^a-z0-9_]/gi, "_");
}

export function rewritePluginJsForAddon(source: string, hostImportPath = "../../host.js"): string {
    return source.replace(
        /(from\s*|import\s*\(\s*|\bimport\s*)(["'])@piano\/(vfx|core)\2/g,
        (_match, prefix: string, quote: string, pkg: string) =>
            `${prefix}${quote}${pkg === "core" ? hostImportPath.replace(/host\.js$/, "core.js") : hostImportPath}${quote}`,
    );
}

function normalizeArchivePath(rawPath: string): string {
    const clean = rawPath.replace(/\\/g, "/");
    if (!clean || clean.startsWith("/") || clean.includes("\0")) {
        throw new Error(`插件包内存在非法路径：${rawPath}`);
    }
    const parts = clean.split("/");
    if (parts.some(part => !part || part === "." || part === "..")) {
        throw new Error(`插件包内存在越界路径：${rawPath}`);
    }
    return parts.join("/");
}

function validatePluginJsSource(path: string, source: string, files: ReadonlyMap<string, Uint8Array>): void {
    for (const { pattern, reason } of FORBIDDEN_PLUGIN_CODE_PATTERNS) {
        if (pattern.test(source)) {
            throw new Error(`插件脚本 ${path} 校验失败：${reason}`);
        }
    }

    const staticImports = source.matchAll(/(?:^|[;\n}])\s*(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:\{[^}]*\}|\*[^;\n]*)\s+from\s+)(["'])([^"']+)\1/gm);
    const dynamicImports = source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g);
    for (const match of [...staticImports, ...dynamicImports]) {
        const spec = match[2];
        if (ALLOWED_EXTERNAL_IMPORTS.has(spec)) continue;
        if (!spec.startsWith("./") && !spec.startsWith("../")) {
            throw new Error(`插件脚本 ${path} 导入了不允许的外部模块：${spec}`);
        }
        const target = path.split("/").slice(0, -1);
        for (const part of spec.split("/")) {
            if (part === "..") {
                if (target.length <= 1) throw new Error(`插件脚本 ${path} 引用超出 vfx/：${spec}`);
                target.pop();
            } else if (part !== ".") target.push(part);
        }
        if (!spec.endsWith(".js") || !files.has(target.join("/"))) {
            throw new Error(`插件脚本 ${path} 引用了缺失模块：${spec}`);
        }
    }
}

function hasArchiveTexture(textures: ReadonlyMap<string, Uint8Array>, textureRef: string): boolean {
    const clean = textureRef.replace(/\\/g, "/").replace(/^\/+/, "");
    return textures.has(clean)
        || textures.has(`${clean}.png`)
        || textures.has(`${clean}.tga`);
}

export function readStagePropFiles(manifest: VfxPluginManifest, readFile: (path: string) => Uint8Array | undefined) {
    function requireFile(path: string) {
        const bytes = readFile(path);
        if (!bytes?.length) throw new Error(`插件 ${manifest.id} 缺少道具资源：${path}`);
        return bytes;
    }
    const stageProps = readStagePropAssets(manifest, path => {
        const content = requireFile(path);
        try {
            return JSON.parse(strFromU8(content));
        } catch {
            throw new Error(`插件 ${manifest.id} 道具资源 JSON 无效：${path}`);
        }
    });
    for (const { declaration, geometry } of stageProps) {
        for (const path of [declaration.texture, declaration.merTexture]) {
            if (!path) continue;
            const bytes = requireFile(path);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            if (bytes.length < 45 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a
                || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452
                || view.getUint32(16) !== geometry.description.texture_width
                || view.getUint32(20) !== geometry.description.texture_height
                || view.getUint32(bytes.length - 8) !== 0x49454e44) {
                throw new Error(`插件 ${manifest.id} 道具贴图需要是与模型纹理尺寸一致的 PNG：${path}`);
            }
        }
    }
    return stageProps;
}

export function writePbePluginArchive(
    input: Record<string, Uint8Array | string> | ReadonlyMap<string, Uint8Array | string>,
): Uint8Array {
    const pairs = input instanceof Map ? [...input.entries()] : Object.entries(input);
    const normalized: [string, Uint8Array][] = [];
    const seen = new Set<string>();

    for (const [rawPath, content] of pairs) {
        const path = normalizeArchivePath(rawPath);
        if (seen.has(path)) {
            throw new Error(`插件包内存在重复路径：${path}`);
        }
        seen.add(path);
        normalized.push([path, typeof content === "string" ? strToU8(content) : content]);
    }

    normalized.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const entries: Record<string, Uint8Array> = {};
    for (const [path, bytes] of normalized) {
        entries[path] = bytes;
    }
    return zipSync(entries, { level: 6 });
}

export function readPbePluginArchive(bytes: Uint8Array): PbePluginArchive {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new Error("无效插件包：文件为空");
    }
    if (bytes.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) {
        throw new Error(`插件包过大（超过 ${Math.floor(MAX_PLUGIN_ARCHIVE_BYTES / 1024 / 1024)} MB 限制）`);
    }
    const rawEntries = unzipSync(bytes);
    const files = new Map<string, Uint8Array>();
    const particles = new Map<string, Uint8Array>();
    const textures = new Map<string, Uint8Array>();
    const previews = new Map<string, Uint8Array>();
    const songFiles = new Map<string, Uint8Array>();
    const performanceFiles = new Map<string, Uint8Array>();
    const libraryFiles = new Map<string, Uint8Array>();

    let entryCount = 0;
    for (const [rawPath, data] of Object.entries(rawEntries)) {
        if (rawPath.endsWith("/") && data.byteLength === 0) continue;
        if (++entryCount > MAX_PLUGIN_ARCHIVE_FILES) {
            throw new Error(`插件包内文件数量超过上限（${MAX_PLUGIN_ARCHIVE_FILES}）`);
        }
        const path = normalizeArchivePath(rawPath);
        if (STAGE_PROP_RP_TREES.some(tree => path.toLowerCase().startsWith(tree))) {
            throw new Error(`插件包路径 ${path} 由舞台道具装配器管理，请将道具资源放在 stage_props/`);
        }
        if (files.has(path)) {
            throw new Error(`插件包内存在重复文件：${path}`);
        }
        files.set(path, data);
        if (path.startsWith("particles/")) particles.set(path, data);
        else if (path.startsWith("textures/")) {
            if (!/^textures\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:png|tga|texture_set\.json)$/i.test(path)) {
                throw new Error(`插件贴图路径无效：${path}`);
            }
            textures.set(path, data);
        }
        else if (path.startsWith("preview/")) previews.set(path, data);
        else if (path.startsWith("songs/")) songFiles.set(path, data);
        else if (path.startsWith("performances/")) performanceFiles.set(path, data);
        else if (path.startsWith("libraries/")) libraryFiles.set(path, data);
    }

    const manifestBytes = files.get("plugin.json");
    if (!manifestBytes) {
        throw new Error("插件包缺少 plugin.json");
    }
    let rawManifest: unknown;
    try {
        rawManifest = JSON.parse(strFromU8(manifestBytes));
    } catch (error) {
        throw new Error(`plugin.json 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const manifest = validatePluginManifest(rawManifest);
    if (!isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION)) {
        throw new Error(
            `插件 ${manifest.id} API 版本 ${manifest.apiVersion} 与当前宿主 ${VFX_API_VERSION} 不兼容`,
        );
    }
    const stageProps = readStagePropFiles(manifest, path => files.get(path));

    let vfxEntryJs: string | undefined;
    const entryBytes = files.get("vfx/index.js");
    if (entryBytes) {
        vfxEntryJs = strFromU8(entryBytes);
    }
    if (manifest.capabilities.includes("vfx")) {
        if (!vfxEntryJs || !vfxEntryJs.trim()) {
            throw new Error(`VFX 插件 ${manifest.id} 缺少有效的 vfx/index.js`);
        }
    }

    for (const [path, data] of files) {
        if (path.startsWith("vfx/") && path.endsWith(".js")) {
            validatePluginJsSource(path, strFromU8(data), files);
        }
    }

    const foundParticleIds: string[] = [];
    const externalParticleTextures = new Set<string>();
    function requireTexture(ref: string, document: string) {
        if (HOST_TEXTURE_SET.has(ref) || hasArchiveTexture(textures, ref)) return;
        if (!manifest.dependencies?.length) {
            throw new Error(`资源 ${document} 引用的纹理不存在于宿主或插件包内：${ref}`);
        }
        externalParticleTextures.add(ref);
    }
    for (const [path, data] of particles) {
        if (!path.endsWith(".particle.json")) {
            throw new Error(`particles/ 目录包含非粒子定义文件：${path}`);
        }
        let doc: Record<string, unknown>;
        try {
            doc = JSON.parse(strFromU8(data)) as Record<string, unknown>;
        } catch (error) {
            throw new Error(`粒子文档 ${path} JSON 无效：${error instanceof Error ? error.message : String(error)}`);
        }
        const effect = doc?.particle_effect as Record<string, unknown> | undefined;
        const description = effect?.description as Record<string, unknown> | undefined;
        const identifier = description?.identifier;
        if (typeof identifier !== "string" || !identifier.startsWith("pbe:vfx_")) {
            throw new Error(`粒子文档 ${path} 的 identifier 必须以 pbe:vfx_ 开头`);
        }
        const particleId = identifier.slice("pbe:vfx_".length);
        if (HOST_PARTICLE_IDS.includes(particleId)) throw new Error(`插件 ${manifest.id} 使用了宿主粒子 ID：${particleId}`);
        const expectedPath = `particles/pbe_vfx_${particleId}.particle.json`;
        if (path !== expectedPath) {
            throw new Error(`粒子文档路径 ${path} 与标识符 ${identifier} 不匹配（应为 ${expectedPath}）`);
        }
        foundParticleIds.push(particleId);

        const renderParams = description?.basic_render_parameters as Record<string, unknown> | undefined;
        const textureRef = renderParams?.texture;
        if (typeof textureRef !== "string" || !textureRef.trim()) {
            throw new Error(`粒子文档 ${path} 缺少 basic_render_parameters.texture`);
        }
        requireTexture(textureRef, path);
    }
    for (const [path, data] of textures) {
        if (!path.endsWith(".texture_set.json")) continue;
        const doc = JSON.parse(strFromU8(data))?.["minecraft:texture_set"];
        if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`贴图集定义无效：${path}`);
        const directory = path.slice(0, path.lastIndexOf("/") + 1);
        for (const ref of Object.values(doc)) {
            if (typeof ref !== "string") continue;
            if (!/^[a-z0-9_-]+(?:\.(?:png|tga))?$/i.test(ref)) throw new Error(`贴图集 ${path} 引用无效：${ref}`);
            requireTexture(directory + ref, path);
        }
    }

    const declaredParticles = [...(manifest.provides.particles ?? [])].sort();
    const sortedFoundParticles = [...foundParticleIds].sort();
    if (
        declaredParticles.length !== sortedFoundParticles.length
        || declaredParticles.some((id, idx) => id !== sortedFoundParticles[idx])
    ) {
        throw new Error(
            `插件 ${manifest.id} provides.particles ([${declaredParticles.join(", ")}]) 与 particles/ 实际文件 ([${sortedFoundParticles.join(", ")}]) 不一致`,
        );
    }

    const songs = new Map<string, PluginSongEntry>();
    for (const [path, data] of songFiles) {
        if (!path.endsWith(".pbe3")) {
            throw new Error(`songs/ 目录只支持 .pbe3 文件：${path}`);
        }
        validateSong(data);
        const header = readSongHeader(data);
        if (songs.has(header.id)) {
            throw new Error(`插件 ${manifest.id} 包含重复歌曲 ID：${header.id}`);
        }
        songs.set(header.id, {
            id: header.id,
            name: header.name,
            duration: header.duration,
            noteCount: header.noteCount,
            musicFingerprint: computeMusicFingerprint(data),
            bytes: data,
            path,
        });
    }

    const performances: PluginPerformanceEntry[] = [];
    const seenPerfIds = new Set<string>();
    for (const [path, data] of performanceFiles) {
        if (!path.endsWith(".json")) {
            throw new Error(`performances/ 目录只支持 .json 文件：${path}`);
        }
        let raw: Record<string, unknown>;
        try {
            raw = JSON.parse(strFromU8(data)) as Record<string, unknown>;
        } catch (error) {
            throw new Error(`演出文件 ${path} JSON 无效：${error instanceof Error ? error.message : String(error)}`);
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`演出文件 ${path} 必须是 JSON 对象`);
        }
        const stem = path.slice("performances/".length, -".json".length);
        const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${manifest.id}:${stem}`;
        if (seenPerfIds.has(id)) {
            throw new Error(`插件 ${manifest.id} 包含重复演出 ID：${id}`);
        }
        seenPerfIds.add(id);
        const songId = typeof raw.songId === "string" && raw.songId.trim()
            ? raw.songId.trim()
            : typeof raw.song === "string" && raw.song.trim()
              ? raw.song.trim()
              : "";
        if (!songId) {
            throw new Error(`演出文件 ${path} 缺少 songId 或 song 字段`);
        }
        const name = typeof raw.name === "string" && raw.name.trim()
            ? raw.name.trim()
            : typeof raw.title === "string" && raw.title.trim()
              ? raw.title.trim()
              : stem;

        let cues: readonly PerformanceCue[];
        const firstCue = Array.isArray(raw.cues) ? (raw.cues[0] as Record<string, unknown> | undefined) : undefined;
        if (Array.isArray(raw.cues) && raw.cues.length > 0 && typeof firstCue?.tick === "number") {
            cues = raw.cues as PerformanceCue[];
        } else {
            cues = compilePerformanceSource({ ...raw, song: songId });
        }

        performances.push({
            id,
            name,
            ...(typeof raw.author === "string" && raw.author.trim() ? { author: raw.author.trim() } : {}),
            ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim() } : {}),
            songId,
            ...(typeof raw.musicFingerprint === "string" && raw.musicFingerprint.trim()
                ? { musicFingerprint: raw.musicFingerprint.trim() }
                : songs.get(songId)?.musicFingerprint
                  ? { musicFingerprint: songs.get(songId)!.musicFingerprint }
                  : {}),
            cues,
            requiredEffects: extractCueEffects(cues),
            ...(Array.isArray(raw.requiredPlugins)
                ? { requiredPlugins: raw.requiredPlugins.filter((item): item is string => typeof item === "string" && item.trim().length > 0) }
                : {}),
            path,
        });
    }

    const libraries: PluginLibraryEntry[] = [];
    const seenLibIds = new Set<string>();
    for (const [path, data] of libraryFiles) {
        if (!path.endsWith(".json")) {
            throw new Error(`libraries/ 目录只支持 .json 文件：${path}`);
        }
        let raw: Record<string, unknown>;
        try {
            raw = JSON.parse(strFromU8(data)) as Record<string, unknown>;
        } catch (error) {
            throw new Error(`曲库文件 ${path} JSON 无效：${error instanceof Error ? error.message : String(error)}`);
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`曲库文件 ${path} 必须是 JSON 对象`);
        }
        const stem = path.slice("libraries/".length, -".json".length);
        const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${manifest.id}:${stem}`;
        if (seenLibIds.has(id)) {
            throw new Error(`插件 ${manifest.id} 包含重复曲库 ID：${id}`);
        }
        seenLibIds.add(id);
        const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : stem;
        if (!Array.isArray(raw.songs)) {
            throw new Error(`曲库文件 ${path} 缺少 songs 数组`);
        }
        const songIds = raw.songs.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        libraries.push({
            id,
            name,
            ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim() } : {}),
            ...(typeof raw.author === "string" && raw.author.trim() ? { author: raw.author.trim() } : {}),
            songs: songIds,
            path,
        });
    }

    const hasExecutableCode = pluginHasExecutableCode({ manifest, vfxEntryJs, files });

    return {
        manifest,
        bytes,
        size: bytes.byteLength,
        hasExecutableCode,
        ...(vfxEntryJs !== undefined ? { vfxEntryJs } : {}),
        particles,
        textures,
        previews,
        files,
        stageProps,
        externalParticleTextures: [...externalParticleTextures],
        songs,
        performances,
        libraries,
    };
}

export function validatePluginAssembly(plugins: readonly PbePluginArchive[]): PbePluginArchive[] {
    const ordered = orderVfxPlugins(plugins);
    const owners = new Map<string, string>();
    const songOwners = new Map<string, { pluginId: string; song: PluginSongEntry }>();
    const byId = new Map(ordered.map(archive => [archive.manifest.id, archive]));
    function claim(key: string, id: string) {
        const owner = owners.get(key);
        if (owner !== undefined) throw new Error(`插件资源冲突：${key} 同时属于 ${owner} 与 ${id}`);
        owners.set(key, id);
    }

    for (const archive of ordered) {
        const { id, provides, dependencies } = archive.manifest;
        claim(`脚本路径/${pluginSlug(id)}`, id);
        for (const [kind, ids] of Object.entries(provides)) {
            if (kind === "songs" || kind === "performances" || kind === "libraries") continue;
            for (const resource of ids) claim(`${kind}/${resource}`, id);
        }
        for (const [songId, song] of archive.songs) {
            const existing = songOwners.get(songId);
            if (!existing) {
                songOwners.set(songId, { pluginId: id, song });
            } else if (!sameSongMusic(existing.song.bytes, song.bytes)) {
                throw new Error(`插件歌曲 ID 冲突：${songId} 在 ${existing.pluginId} 与 ${id} 中音乐内容不同`);
            }
        }
        for (const perf of archive.performances) {
            claim(`performances/${perf.id}`, id);
        }
        for (const lib of archive.libraries) {
            claim(`libraries/${lib.id}`, id);
        }
        for (const path of [...archive.particles.keys(), ...archive.textures.keys()]) {
            const normalized = path.toLowerCase();
            const stem = normalized.replace(/(?:_mer|_normal)?\.(?:png|tga|texture_set\.json)$/i, "");
            if (HOST_TEXTURE_SET.has(stem)) throw new Error(`插件 ${id} 试图覆盖宿主贴图：${path}`);
            claim(normalized, id);
        }
        for (const ref of archive.externalParticleTextures) {
            if (!(dependencies ?? []).some(dependency => hasArchiveTexture(byId.get(dependency)!.textures, ref))) {
                throw new Error(`插件 ${id} 引用的粒子贴图未由声明依赖提供：${ref}`);
            }
        }
    }
    return ordered;
}
