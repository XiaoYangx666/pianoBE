import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { isApiVersionCompatible, validatePluginManifest, VFX_API_VERSION, type VfxPluginManifest } from "./plugin";

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

export interface PbePluginArchive {
    manifest: VfxPluginManifest;
    bytes: Uint8Array;
    size: number;
    vfxEntryJs?: string;
    particles: Map<string, Uint8Array>;
    textures: Map<string, Uint8Array>;
    previews: Map<string, Uint8Array>;
    files: Map<string, Uint8Array>;
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
        /(from\s*|import\s*\(\s*)(["'])@piano\/vfx\2/g,
        `$1$2${hostImportPath}$2`,
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

function validatePluginJsSource(path: string, source: string): void {
    for (const { pattern, reason } of FORBIDDEN_PLUGIN_CODE_PATTERNS) {
        if (pattern.test(source)) {
            throw new Error(`插件脚本 ${path} 校验失败：${reason}`);
        }
    }

    const staticImports = source.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?(["'])([^"']+)\1/gm);
    for (const match of staticImports) {
        const spec = match[2];
        if (!spec.startsWith("./") && !spec.startsWith("../") && !ALLOWED_EXTERNAL_IMPORTS.has(spec)) {
            throw new Error(`插件脚本 ${path} 导入了不允许的外部模块：${spec}`);
        }
    }

    const dynamicImports = source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g);
    for (const match of dynamicImports) {
        const spec = match[2];
        if (!spec.startsWith("./") && !spec.startsWith("../") && !ALLOWED_EXTERNAL_IMPORTS.has(spec)) {
            throw new Error(`插件脚本 ${path} 动态导入了不允许的外部模块：${spec}`);
        }
    }
}

function hasArchiveTexture(textures: ReadonlyMap<string, Uint8Array>, textureRef: string): boolean {
    const clean = textureRef.replace(/\\/g, "/").replace(/^\/+/, "");
    return textures.has(clean)
        || textures.has(`${clean}.png`)
        || textures.has(`${clean}.tga`);
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
    const rawEntries = unzipSync(bytes);
    const files = new Map<string, Uint8Array>();
    const particles = new Map<string, Uint8Array>();
    const textures = new Map<string, Uint8Array>();
    const previews = new Map<string, Uint8Array>();

    for (const [rawPath, data] of Object.entries(rawEntries)) {
        if (rawPath.endsWith("/") && data.byteLength === 0) continue;
        const path = normalizeArchivePath(rawPath);
        if (files.has(path)) {
            throw new Error(`插件包内存在重复文件：${path}`);
        }
        files.set(path, data);
        if (path.startsWith("particles/")) particles.set(path, data);
        else if (path.startsWith("textures/")) textures.set(path, data);
        else if (path.startsWith("preview/")) previews.set(path, data);
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
            validatePluginJsSource(path, strFromU8(data));
        }
    }

    const foundParticleIds: string[] = [];
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
        if (!HOST_TEXTURE_SET.has(textureRef) && !hasArchiveTexture(textures, textureRef)) {
            throw new Error(`粒子文档 ${path} 引用的纹理不存在于宿主或插件包内：${textureRef}`);
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

    return {
        manifest,
        bytes,
        size: bytes.byteLength,
        ...(vfxEntryJs !== undefined ? { vfxEntryJs } : {}),
        particles,
        textures,
        previews,
        files,
    };
}
