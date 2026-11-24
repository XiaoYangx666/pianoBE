import type { KeyParticleRenderStyle } from "../domain/keyParticles";
import type { LightAnchor, StageVeilAnchor } from "../spatial/stage";
import type { VfxTheme } from "../domain/themes";
import type { VfxEffectDefinition, VfxResourceVisibility } from "../types";

export const VFX_API_VERSION = "1.0.0";

export const VFX_PLUGIN_CAPABILITIES = [
    "vfx",
    "vfx.stageProps",
    "audio.timbres",
    "audio.sfx",
    "scores",
    "songs",
    "performances",
    "libraries",
] as const;

export type VfxPluginCapability = (typeof VFX_PLUGIN_CAPABILITIES)[number];

export interface VfxPluginProvides {
    effects?: readonly string[];
    themes?: readonly string[];
    layouts?: readonly string[];
    keyStyles?: readonly string[];
    particles?: readonly string[];
    timbres?: readonly string[];
    songs?: readonly string[];
    performances?: readonly string[];
    libraries?: readonly string[];
}

export interface VfxPluginLimits {
    maxParticlesPerBurst?: number;
    maxActiveParticles?: number;
}

export interface VfxPluginIconText {
    text: string;
    color?: string;
}

export type VfxPluginIcon = string | VfxPluginIconText;

export interface VfxPluginPreview {
    thumbnail?: string;
    screenshots?: readonly string[];
    description?: string;
}

export interface VfxStagePropDeclaration {
    id: string;
    geometry: string;
    texture: string;
    merTexture?: string;
    animations?: string;
    preview?: { tall?: boolean; fillLight?: boolean; fullGlow?: boolean };
}

export interface VfxPluginManifest {
    id: string;
    name: string;
    version: string;
    apiVersion: string;
    minPianoBeVersion: string;
    capabilities: readonly VfxPluginCapability[];
    /** 默认资源展示意图：public = 公开选择器可见，internal = 仅供演出/插件内部引用 */
    visibility?: VfxResourceVisibility;
    author: string;
    license: string;
    provides: VfxPluginProvides;
    dependencies?: readonly string[];
    limits?: VfxPluginLimits;
    icon?: VfxPluginIcon;
    preview?: VfxPluginPreview;
    stageProps?: readonly VfxStagePropDeclaration[];
}

export function pluginHasExecutableCode(plugin: {
    manifest?: Pick<VfxPluginManifest, "capabilities">;
    capabilities?: readonly string[];
    vfxEntryJs?: string;
    files?: ReadonlyMap<string, unknown>;
}): boolean {
    const caps = plugin.manifest?.capabilities ?? plugin.capabilities ?? [];
    if (caps.includes("vfx")) return true;
    if (plugin.vfxEntryJs && plugin.vfxEntryJs.trim().length > 0) return true;
    if (plugin.files) {
        for (const path of plugin.files.keys()) {
            if (path.startsWith("vfx/") && path.endsWith(".js")) return true;
        }
    }
    return false;
}

export interface VfxPluginRegistrar {
    registerEffect(def: VfxEffectDefinition): void;
    registerTheme(id: string, theme: VfxTheme): void;
    registerLightLayout(id: string, anchors: readonly LightAnchor[]): void;
    registerVeilLayout(id: string, veils: readonly StageVeilAnchor[]): void;
    registerKeyStyle(id: string, style: KeyParticleRenderStyle): void;
}

export interface VfxPluginModule {
    manifest: VfxPluginManifest;
    register(api: VfxPluginRegistrar): void;
}

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
const ITEM_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const CONTENT_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ICON_PATH_PATTERN = /^preview\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:png|webp|jpg|jpeg|svg)$/i;
const CAPABILITY_SET = new Set<string>(VFX_PLUGIN_CAPABILITIES);

function validatePluginIcon(raw: unknown): VfxPluginIcon {
    if (typeof raw === "string") {
        const path = raw.trim();
        if (!ICON_PATH_PATTERN.test(path)) {
            throw new Error(`插件清单字段 icon 路径必须是 preview/ 下的 .png/.webp/.jpg/.jpeg/.svg 文件：${raw}`);
        }
        return path;
    }
    const obj = asRecord(raw, "icon");
    const text = nonEmptyString(obj.text, "icon.text");
    if ([...text].length > 4) {
        throw new Error(`插件清单字段 icon.text 长度不能超过 4 个字符：${text}`);
    }
    if (obj.color === undefined) return { text };
    const color = nonEmptyString(obj.color, "icon.color");
    if (!HEX_COLOR_PATTERN.test(color)) {
        throw new Error(`插件清单字段 icon.color 需要是 #RRGGBB 十六进制颜色：${color}`);
    }
    return { text, color };
}
const PROVIDES_KEYS = ["effects", "themes", "layouts", "keyStyles", "particles", "timbres", "songs", "performances", "libraries"] as const;
const CONTENT_PROVIDES_KEYS = new Set<string>(["songs", "performances", "libraries"]);

export function stagePropId(pluginId: string, localId: string): string {
    return `${pluginId}:${localId}`;
}

function stagePropPath(value: unknown, field: string, suffix: string): string {
    const path = nonEmptyString(value, field);
    if (!/^stage_props\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(path) || !path.endsWith(suffix)) {
        throw new Error(`${field} 必须是 stage_props/ 下的 ${suffix} 文件：${path}`);
    }
    return path;
}

function validateStageProps(raw: unknown): readonly VfxStagePropDeclaration[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("stageProps 需要是非空数组");
    const declarations = raw.map((value, index) => asRecord(value, `stageProps[${index}]`));
    const ids = validateIdList(declarations.map(value => value.id), "stageProps.id")!;
    return declarations.map((value, index) => {
        const id = ids[index];
        const label = `stageProps.${id}`;
        const prop: VfxStagePropDeclaration = {
            id,
            geometry: stagePropPath(value.geometry, `${label}.geometry`, ".geo.json"),
            texture: stagePropPath(value.texture, `${label}.texture`, ".png"),
        };
        if (value.merTexture !== undefined) {
            prop.merTexture = stagePropPath(value.merTexture, `${label}.merTexture`, ".png");
        }
        if (value.animations !== undefined) {
            prop.animations = stagePropPath(value.animations, `${label}.animations`, ".animation.json");
        }
        if (value.preview !== undefined) {
            const preview = asRecord(value.preview, `${label}.preview`);
            prop.preview = {};
            for (const key of ["tall", "fillLight", "fullGlow"] as const) {
                if (preview[key] === undefined) continue;
                if (typeof preview[key] !== "boolean") throw new Error(`${label}.preview.${key} 需要是布尔值`);
                prop.preview[key] = preview[key];
            }
        }
        return prop;
    });
}

interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
}

export function parseSemver(version: unknown): ParsedSemver | undefined {
    if (typeof version !== "string") return undefined;
    const match = SEMVER_PATTERN.exec(version.trim());
    if (!match) return undefined;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

export function isApiVersionCompatible(pluginApi: string, hostApi: string = VFX_API_VERSION): boolean {
    const plugin = parseSemver(pluginApi);
    const host = parseSemver(hostApi);
    if (!plugin || !host) return false;
    return plugin.major === host.major && plugin.minor <= host.minor;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 需要是 JSON 对象`);
    }
    return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`插件清单字段 ${field} 必须是非空字符串`);
    }
    return value.trim();
}

function semverString(value: unknown, field: string): string {
    const text = nonEmptyString(value, field);
    if (!parseSemver(text)) {
        throw new Error(`插件清单字段 ${field} 需要是有效 semver 版本号（收到 ${text}）`);
    }
    return text;
}

function validateIdList(value: unknown, field: string, pattern: RegExp = ITEM_ID_PATTERN): readonly string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new Error(`插件清单字段 ${field} 需要是字符串数组`);
    }
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of value) {
        const text = nonEmptyString(item, `${field}[]`);
        if (!pattern.test(text)) {
            throw new Error(`插件清单字段 ${field} 包含无效标识符 ${text}`);
        }
        if (seen.has(text)) {
            throw new Error(`插件清单字段 ${field} 包含重复标识符 ${text}`);
        }
        seen.add(text);
        list.push(text);
    }
    return list;
}

export function validatePluginManifest(raw: unknown): VfxPluginManifest {
    const record = asRecord(raw, "plugin.json");
    const id = nonEmptyString(record.id, "id");
    if (!PLUGIN_ID_PATTERN.test(id)) {
        throw new Error(`插件 id 无效（需以小写字母开头，2-64 位小写字母/数字/._-）：${id}`);
    }
    const dependencies = validateIdList(record.dependencies, "dependencies");
    if (dependencies?.some(dependency => dependency === id || !PLUGIN_ID_PATTERN.test(dependency))) {
        throw new Error(`插件 ${id} 的 dependencies 包含自身或无效插件 ID`);
    }

    const name = nonEmptyString(record.name, "name");
    const version = semverString(record.version, "version");
    const apiVersion = semverString(record.apiVersion, "apiVersion");
    const minPianoBeVersion = semverString(record.minPianoBeVersion, "minPianoBeVersion");
    const author = nonEmptyString(record.author, "author");
    const license = nonEmptyString(record.license, "license");

    if (!Array.isArray(record.capabilities) || record.capabilities.length === 0) {
        throw new Error("插件清单字段 capabilities 需要是非空能力列表");
    }
    const capabilities: VfxPluginCapability[] = [];
    const seenCaps = new Set<string>();
    for (const cap of record.capabilities) {
        if (typeof cap !== "string" || !CAPABILITY_SET.has(cap)) {
            throw new Error(`插件清单包含未知能力类型：${String(cap)}`);
        }
        if (!seenCaps.has(cap)) {
            seenCaps.add(cap);
            capabilities.push(cap as VfxPluginCapability);
        }
    }

    const hasStageProps = seenCaps.has("vfx.stageProps");
    if (hasStageProps && !seenCaps.has("vfx")) throw new Error("vfx.stageProps 需要同时声明 vfx");
    if (hasStageProps !== (record.stageProps !== undefined)) {
        throw new Error("vfx.stageProps 能力与 stageProps 声明必须同时存在");
    }
    const stageProps = hasStageProps ? validateStageProps(record.stageProps) : undefined;

    const rawProvides = record.provides === undefined ? {} : asRecord(record.provides, "provides");
    const provides: VfxPluginProvides = {};
    for (const key of PROVIDES_KEYS) {
        const pattern = CONTENT_PROVIDES_KEYS.has(key) ? CONTENT_ID_PATTERN : ITEM_ID_PATTERN;
        const parsed = validateIdList(rawProvides[key], `provides.${key}`, pattern);
        if (parsed !== undefined) provides[key] = parsed;
    }

    let visibility: VfxResourceVisibility | undefined;
    if (record.visibility !== undefined) {
        if (record.visibility !== "public" && record.visibility !== "internal") {
            throw new Error(`插件清单字段 visibility 必须为 public 或 internal（收到 ${String(record.visibility)}）`);
        }
        visibility = record.visibility;
    }

    let limits: VfxPluginLimits | undefined;
    if (record.limits !== undefined) {
        const rawLimits = asRecord(record.limits, "limits");
        limits = {};
        if (rawLimits.maxParticlesPerBurst !== undefined) {
            const v = rawLimits.maxParticlesPerBurst;
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
                throw new Error("limits.maxParticlesPerBurst 需要是非负有限数字");
            }
            limits.maxParticlesPerBurst = v;
        }
        if (rawLimits.maxActiveParticles !== undefined) {
            const v = rawLimits.maxActiveParticles;
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
                throw new Error("limits.maxActiveParticles 需要是非负有限数字");
            }
            limits.maxActiveParticles = v;
        }
    }

    const icon = record.icon !== undefined ? validatePluginIcon(record.icon) : undefined;

    let preview: VfxPluginPreview | undefined;
    if (record.preview !== undefined) {
        const rawPreview = asRecord(record.preview, "preview");
        preview = {};
        if (rawPreview.thumbnail !== undefined) {
            preview.thumbnail = nonEmptyString(rawPreview.thumbnail, "preview.thumbnail");
        }
        if (rawPreview.description !== undefined) {
            preview.description = nonEmptyString(rawPreview.description, "preview.description");
        }
        if (rawPreview.screenshots !== undefined) {
            if (!Array.isArray(rawPreview.screenshots)) {
                throw new Error("preview.screenshots 需要是字符串数组");
            }
            preview.screenshots = rawPreview.screenshots.map((item) => nonEmptyString(item, "preview.screenshots[]"));
        }
    }

    return {
        id,
        name,
        version,
        apiVersion,
        minPianoBeVersion,
        capabilities,
        ...(visibility ? { visibility } : {}),
        author,
        license,
        provides,
        ...(dependencies?.length ? { dependencies } : {}),
        ...(limits ? { limits } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(preview ? { preview } : {}),
        ...(stageProps ? { stageProps } : {}),
    };
}

/** 按声明顺序遍历，每个依赖只装配一次。 */
export function orderVfxPlugins<T extends { manifest: VfxPluginManifest }>(plugins: readonly T[]): T[] {
    const byId = new Map<string, T>();
    for (const plugin of plugins) {
        const { id } = plugin.manifest;
        if (byId.has(id)) throw new Error(`插件 ID 重复：${id}`);
        byId.set(id, plugin);
    }
    const ordered: T[] = [];
    const active = new Set<string>();
    const visited = new Set<string>();
    function visit(plugin: T) {
        const { id, dependencies } = plugin.manifest;
        if (active.has(id)) throw new Error(`插件循环依赖：${[...active, id].join(" → ")}`);
        if (visited.has(id)) return;
        active.add(id);
        for (const dependency of dependencies ?? []) {
            const required = byId.get(dependency);
            if (!required) throw new Error(`插件 ${id} 缺少依赖 ${dependency}`);
            visit(required);
        }
        active.delete(id);
        visited.add(id);
        ordered.push(plugin);
    }
    for (const plugin of plugins) visit(plugin);
    return ordered;
}
