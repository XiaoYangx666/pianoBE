import type { KeyParticleRenderStyle } from "./keyParticles";
import type { LightAnchor, StageVeilAnchor } from "./stage";
import type { VfxTheme } from "./themes";
import type { VfxEffectDefinition } from "./types";

export const VFX_API_VERSION = "1.0.0";

export const VFX_PLUGIN_CAPABILITIES = [
    "vfx",
    "audio.timbres",
    "audio.sfx",
    "scores",
    "songs",
] as const;

export type VfxPluginCapability = (typeof VFX_PLUGIN_CAPABILITIES)[number];

export interface VfxPluginProvides {
    effects?: readonly string[];
    themes?: readonly string[];
    layouts?: readonly string[];
    keyStyles?: readonly string[];
    particles?: readonly string[];
}

export interface VfxPluginLimits {
    maxParticlesPerBurst?: number;
    maxActiveParticles?: number;
}

export interface VfxPluginPreview {
    thumbnail?: string;
    screenshots?: readonly string[];
    description?: string;
}

export interface VfxPluginManifest {
    id: string;
    name: string;
    version: string;
    apiVersion: string;
    minPianoBeVersion: string;
    capabilities: readonly VfxPluginCapability[];
    author: string;
    license: string;
    provides: VfxPluginProvides;
    limits?: VfxPluginLimits;
    preview?: VfxPluginPreview;
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
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CAPABILITY_SET = new Set<string>(VFX_PLUGIN_CAPABILITIES);
const PROVIDES_KEYS = ["effects", "themes", "layouts", "keyStyles", "particles"] as const;

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

function validateIdList(value: unknown, field: string): readonly string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new Error(`插件清单字段 ${field} 需要是字符串数组`);
    }
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of value) {
        const text = nonEmptyString(item, `${field}[]`);
        if (!ITEM_ID_PATTERN.test(text)) {
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
    if (Object.hasOwn(record, "dependencies")) {
        throw new Error("插件清单不允许声明 dependencies：插件之间不可互相依赖");
    }

    const id = nonEmptyString(record.id, "id");
    if (!PLUGIN_ID_PATTERN.test(id)) {
        throw new Error(`插件 id 无效（需以小写字母开头，2-64 位小写字母/数字/._-）：${id}`);
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

    const rawProvides = asRecord(record.provides, "provides");
    const provides: VfxPluginProvides = {};
    for (const key of PROVIDES_KEYS) {
        const parsed = validateIdList(rawProvides[key], `provides.${key}`);
        if (parsed !== undefined) provides[key] = parsed;
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
        author,
        license,
        provides,
        ...(limits ? { limits } : {}),
        ...(preview ? { preview } : {}),
    };
}
