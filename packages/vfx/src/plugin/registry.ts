import {
    VFX_API_VERSION,
    isApiVersionCompatible,
    validatePluginManifest,
    type VfxPluginManifest,
    type VfxPluginModule,
    type VfxPluginRegistrar,
} from "./plugin";
import type { KeyParticleRenderStyle } from "../domain/keyParticles";
import type { LightAnchor, StageVeilAnchor } from "../spatial/stage";
import type { VfxTheme } from "../domain/themes";
import type { ListVisibilityOptions, VfxCategory, VfxEffectDefinition, VfxResourceVisibility } from "../types";

export const VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS = 5;
const MAX_RECENT_PLUGIN_ERRORS = 20;
const RESERVED_KEY_STYLE_IDS = new Set(["inherit", "glimmer", "none"]);
const VALID_CATEGORIES = new Set<string>(["atmosphere", "curve", "stage", "keys", "accent", "control"]);
const VALID_TRIGGERS = new Set<string>(["continuous", "note", "instant", "control"]);
const ITEM_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export interface VfxPluginErrorEntry {
    effectId?: string;
    phase: string;
    message: string;
    timestamp: number;
}

export interface VfxPluginDiagnostic {
    pluginId: string;
    disabled: boolean;
    consecutiveErrors: number;
    totalErrors: number;
    lastError?: VfxPluginErrorEntry;
    recentErrors: readonly VfxPluginErrorEntry[];
}

export interface VfxPluginRecord {
    manifest: VfxPluginManifest;
    effects: readonly string[];
    themes: readonly string[];
    lightLayouts: readonly string[];
    veilLayouts: readonly string[];
    keyStyles: readonly string[];
    disabled: boolean;
}

interface MutablePluginRecord {
    manifest: VfxPluginManifest;
    effects: string[];
    themes: string[];
    lightLayouts: string[];
    veilLayouts: string[];
    keyStyles: string[];
    disabled: boolean;
}

interface MutableDiagnostic {
    pluginId: string;
    disabled: boolean;
    consecutiveErrors: number;
    totalErrors: number;
    lastError?: VfxPluginErrorEntry;
    recentErrors: VfxPluginErrorEntry[];
}

interface OwnedEntry<T> {
    owner: string;
    visibility: VfxResourceVisibility;
    value: T;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function assertValidId(id: unknown, kind: string): string {
    if (typeof id !== "string" || !ITEM_ID_PATTERN.test(id)) {
        throw new Error(`${kind} ID 无效：${String(id)}`);
    }
    return id;
}

export class VfxRegistry {
    private readonly plugins = new Map<string, MutablePluginRecord>();
    private readonly effects = new Map<string, OwnedEntry<VfxEffectDefinition>>();
    private readonly themes = new Map<string, OwnedEntry<VfxTheme>>();
    private readonly lightLayouts = new Map<string, OwnedEntry<readonly LightAnchor[]>>();
    private readonly veilLayouts = new Map<string, OwnedEntry<readonly StageVeilAnchor[]>>();
    private readonly keyStyles = new Map<string, OwnedEntry<KeyParticleRenderStyle>>();
    private readonly diagnostics = new Map<string, MutableDiagnostic>();

    constructor(private readonly maxConsecutiveErrors: number = VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS) {}

    registerPlugin(plugin: VfxPluginModule): VfxPluginRecord {
        if (!plugin || typeof plugin !== "object" || typeof plugin.register !== "function") {
            throw new Error("插件模块需要提供 manifest 与 register(api)");
        }
        const manifest = validatePluginManifest(plugin.manifest);
        if (!isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION)) {
            throw new Error(
                `插件 ${manifest.id} API 版本 ${manifest.apiVersion} 与宿主 API ${VFX_API_VERSION} 不兼容`,
            );
        }
        if (this.plugins.has(manifest.id)) {
            throw new Error(`插件 ${manifest.id} 已注册，禁止重复注册`);
        }
        for (const dependency of manifest.dependencies ?? []) {
            if (!this.plugins.has(dependency) || this.isPluginDisabled(dependency)) {
                throw new Error(`插件 ${manifest.id} 缺少可用依赖 ${dependency}`);
            }
        }

        const stagedEffects = new Map<string, VfxEffectDefinition>();
        const stagedThemes = new Map<string, VfxTheme>();
        const stagedLightLayouts = new Map<string, readonly LightAnchor[]>();
        const stagedVeilLayouts = new Map<string, readonly StageVeilAnchor[]>();
        const stagedKeyStyles = new Map<string, KeyParticleRenderStyle>();

        const registrar: VfxPluginRegistrar = {
            registerEffect: (def) => {
                if (!def || typeof def !== "object") throw new Error(`插件 ${manifest.id} 注册了无效特效`);
                const id = assertValidId(def.id, "特效");
                if (typeof def.label !== "string" || !def.label.trim()) {
                    throw new Error(`特效 ${id} 缺少有效 label`);
                }
                if (!VALID_CATEGORIES.has(def.category)) {
                    throw new Error(`特效 ${id} 分类无效：${String(def.category)}`);
                }
                if (!VALID_TRIGGERS.has(def.trigger)) {
                    throw new Error(`特效 ${id} 触发类型无效：${String(def.trigger)}`);
                }
                if (def.trigger === "control" && typeof def.resolveKeyParticle !== "function") {
                    throw new Error(`控制特效 ${id} 需要实现 resolveKeyParticle`);
                }
                if (def.trigger !== "control" && typeof def.emit !== "function") {
                    throw new Error(`特效 ${id} 需要实现 emit`);
                }
                if (this.effects.has(id) || stagedEffects.has(id)) {
                    const existing = this.effects.get(id)?.owner ?? manifest.id;
                    throw new Error(`特效 ID 冲突：${id} 已被 ${existing} 注册`);
                }
                stagedEffects.set(id, def);
            },

            registerTheme: (id, theme) => {
                const validId = assertValidId(id, "主题");
                if (validId === "off") throw new Error("主题 ID 'off' 为宿主保留值");
                if (!theme || typeof theme !== "object" || !Array.isArray(theme.layers) || theme.layers.length === 0) {
                    throw new Error(`主题 ${validId} 需要至少 1 个图层`);
                }
                if (this.themes.has(validId) || stagedThemes.has(validId)) {
                    const existing = this.themes.get(validId)?.owner ?? manifest.id;
                    throw new Error(`主题 ID 冲突：${validId} 已被 ${existing} 注册`);
                }
                stagedThemes.set(validId, theme);
            },

            registerLightLayout: (id, anchors) => {
                const validId = assertValidId(id, "灯光布局");
                if (!Array.isArray(anchors)) {
                    throw new Error(`灯光布局 ${validId} 需要锚点数组`);
                }
                if (this.lightLayouts.has(validId) || stagedLightLayouts.has(validId)) {
                    const existing = this.lightLayouts.get(validId)?.owner ?? manifest.id;
                    throw new Error(`灯光布局 ID 冲突：${validId} 已被 ${existing} 注册`);
                }
                stagedLightLayouts.set(validId, anchors);
            },

            registerVeilLayout: (id, veils) => {
                const validId = assertValidId(id, "光幕布局");
                if (!Array.isArray(veils)) {
                    throw new Error(`光幕布局 ${validId} 需要锚点数组`);
                }
                if (this.veilLayouts.has(validId) || stagedVeilLayouts.has(validId)) {
                    const existing = this.veilLayouts.get(validId)?.owner ?? manifest.id;
                    throw new Error(`光幕布局 ID 冲突：${validId} 已被 ${existing} 注册`);
                }
                stagedVeilLayouts.set(validId, veils);
            },

            registerKeyStyle: (id, style) => {
                const validId = assertValidId(id, "琴键粒子样式");
                if (RESERVED_KEY_STYLE_IDS.has(validId)) {
                    throw new Error(`琴键粒子样式 ID '${validId}' 为宿主保留值`);
                }
                if (!style || typeof style !== "object" || typeof style.label !== "string" || !style.label.trim()) {
                    throw new Error(`琴键粒子样式 ${validId} 缺少有效 label`);
                }
                if (this.keyStyles.has(validId) || stagedKeyStyles.has(validId)) {
                    const existing = this.keyStyles.get(validId)?.owner ?? manifest.id;
                    throw new Error(`琴键粒子样式 ID 冲突：${validId} 已被 ${existing} 注册`);
                }
                if (style.value !== undefined) {
                    for (const [otherId, entry] of this.keyStyles) {
                        if (entry.value.value === style.value) {
                            throw new Error(`琴键粒子样式数值冲突：${validId} 与 ${otherId} 使用了相同的持久化值 ${style.value}`);
                        }
                    }
                    for (const [otherId, otherStyle] of stagedKeyStyles) {
                        if (otherStyle.value === style.value) {
                            throw new Error(`琴键粒子样式数值冲突：${validId} 与 ${otherId} 使用了相同的持久化值 ${style.value}`);
                        }
                    }
                }
                stagedKeyStyles.set(validId, style);
            },
        };

        // Any failure during register() leaves all registry maps untouched.
        plugin.register(registrar);

        const defaultVisibility: VfxResourceVisibility = manifest.visibility ?? "public";
        for (const [id, def] of stagedEffects) {
            this.effects.set(id, { owner: manifest.id, visibility: def.visibility ?? defaultVisibility, value: def });
        }
        for (const [id, theme] of stagedThemes) {
            this.themes.set(id, { owner: manifest.id, visibility: theme.visibility ?? defaultVisibility, value: theme });
        }
        for (const [id, anchors] of stagedLightLayouts) {
            this.lightLayouts.set(id, { owner: manifest.id, visibility: defaultVisibility, value: anchors });
        }
        for (const [id, veils] of stagedVeilLayouts) {
            this.veilLayouts.set(id, { owner: manifest.id, visibility: defaultVisibility, value: veils });
        }
        for (const [id, style] of stagedKeyStyles) {
            this.keyStyles.set(id, { owner: manifest.id, visibility: style.visibility ?? defaultVisibility, value: style });
        }

        const record: MutablePluginRecord = {
            manifest,
            effects: [...stagedEffects.keys()],
            themes: [...stagedThemes.keys()],
            lightLayouts: [...stagedLightLayouts.keys()],
            veilLayouts: [...stagedVeilLayouts.keys()],
            keyStyles: [...stagedKeyStyles.keys()],
            disabled: false,
        };
        this.plugins.set(manifest.id, record);
        this.diagnostics.set(manifest.id, {
            pluginId: manifest.id,
            disabled: false,
            consecutiveErrors: 0,
            totalErrors: 0,
            recentErrors: [],
        });
        return this.snapshotRecord(record);
    }

    unregisterPlugin(pluginId: string): boolean {
        const record = this.plugins.get(pluginId);
        if (!record) return false;
        for (const id of record.effects) {
            if (this.effects.get(id)?.owner === pluginId) this.effects.delete(id);
        }
        for (const id of record.themes) {
            if (this.themes.get(id)?.owner === pluginId) this.themes.delete(id);
        }
        for (const id of record.lightLayouts) {
            if (this.lightLayouts.get(id)?.owner === pluginId) this.lightLayouts.delete(id);
        }
        for (const id of record.veilLayouts) {
            if (this.veilLayouts.get(id)?.owner === pluginId) this.veilLayouts.delete(id);
        }
        for (const id of record.keyStyles) {
            if (this.keyStyles.get(id)?.owner === pluginId) this.keyStyles.delete(id);
        }
        this.plugins.delete(pluginId);
        this.diagnostics.delete(pluginId);
        return true;
    }

    clear(): void {
        this.plugins.clear();
        this.effects.clear();
        this.themes.clear();
        this.lightLayouts.clear();
        this.veilLayouts.clear();
        this.keyStyles.clear();
        this.diagnostics.clear();
    }

    private snapshotRecord(record: MutablePluginRecord): VfxPluginRecord {
        return {
            manifest: record.manifest,
            effects: [...record.effects],
            themes: [...record.themes],
            lightLayouts: [...record.lightLayouts],
            veilLayouts: [...record.veilLayouts],
            keyStyles: [...record.keyStyles],
            disabled: record.disabled,
        };
    }

    private snapshotDiagnostic(diag: MutableDiagnostic): VfxPluginDiagnostic {
        return {
            pluginId: diag.pluginId,
            disabled: diag.disabled,
            consecutiveErrors: diag.consecutiveErrors,
            totalErrors: diag.totalErrors,
            ...(diag.lastError ? { lastError: { ...diag.lastError } } : {}),
            recentErrors: diag.recentErrors.map(entry => ({ ...entry })),
        };
    }

    hasPlugin(id: string): boolean {
        return this.plugins.has(id);
    }

    getPlugin(id: string): VfxPluginRecord | undefined {
        const record = this.plugins.get(id);
        return record ? this.snapshotRecord(record) : undefined;
    }

    listPlugins(): VfxPluginRecord[] {
        return [...this.plugins.values()].map(record => this.snapshotRecord(record));
    }

    private isVisible<T>(entry: OwnedEntry<T>, options?: ListVisibilityOptions): boolean {
        return options?.includeInternal !== false || entry.visibility === "public";
    }

    hasEffect(id: string): boolean {
        return this.effects.has(id);
    }

    isEffectPublic(id: string): boolean {
        return this.effects.get(id)?.visibility === "public";
    }

    getEffect(id: string): VfxEffectDefinition | undefined {
        return this.effects.get(id)?.value;
    }

    getEffectOwner(id: string): string | undefined {
        return this.effects.get(id)?.owner;
    }

    getEffectIds(options?: ListVisibilityOptions): string[] {
        return [...this.effects.entries()]
            .filter(([, entry]) => this.isVisible(entry, options))
            .map(([id]) => id);
    }

    listEffects(category?: VfxCategory, options?: ListVisibilityOptions): VfxEffectDefinition[] {
        const all = [...this.effects.values()]
            .filter(entry => this.isVisible(entry, options))
            .map(entry => entry.value);
        return category ? all.filter(effect => effect.category === category) : all;
    }

    hasTheme(id: string): boolean {
        return this.themes.has(id);
    }

    isThemePublic(id: string): boolean {
        return this.themes.get(id)?.visibility === "public";
    }

    getTheme(id: string): VfxTheme | undefined {
        return this.themes.get(id)?.value;
    }

    getThemeOwner(id: string): string | undefined {
        return this.themes.get(id)?.owner;
    }

    getThemeIds(options?: ListVisibilityOptions): string[] {
        return [...this.themes.entries()]
            .filter(([, entry]) => this.isVisible(entry, options))
            .map(([id]) => id);
    }

    listThemes(options?: ListVisibilityOptions): { id: string; theme: VfxTheme }[] {
        return [...this.themes.entries()]
            .filter(([, entry]) => this.isVisible(entry, options))
            .map(([id, entry]) => ({ id, theme: entry.value }));
    }

    getLightLayout(id: string): readonly LightAnchor[] | undefined {
        return this.lightLayouts.get(id)?.value;
    }

    listLightLayouts(): string[] {
        return [...this.lightLayouts.keys()];
    }

    getVeilLayout(id: string): readonly StageVeilAnchor[] | undefined {
        return this.veilLayouts.get(id)?.value;
    }

    listVeilLayouts(): string[] {
        return [...this.veilLayouts.keys()];
    }

    hasKeyStyle(id: string): boolean {
        return this.keyStyles.has(id);
    }

    isKeyStylePublic(id: string): boolean {
        return this.keyStyles.get(id)?.visibility === "public";
    }

    getKeyStyle(id: string): KeyParticleRenderStyle | undefined {
        return this.keyStyles.get(id)?.value;
    }

    getKeyStyleOwner(id: string): string | undefined {
        return this.keyStyles.get(id)?.owner;
    }

    getKeyStyleIds(options?: ListVisibilityOptions): string[] {
        return [...this.keyStyles.entries()]
            .filter(([, entry]) => this.isVisible(entry, options))
            .map(([id]) => id);
    }

    listKeyStyles(options?: ListVisibilityOptions): { id: string; style: KeyParticleRenderStyle }[] {
        return [...this.keyStyles.entries()]
            .filter(([, entry]) => this.isVisible(entry, options))
            .map(([id, entry]) => ({ id, style: entry.value }));
    }

    recordPluginError(
        pluginId: string,
        info: { effectId?: string; phase: string; error: unknown },
    ): boolean {
        const diag = this.diagnostics.get(pluginId);
        if (!diag) return false;
        const entry: VfxPluginErrorEntry = {
            ...(info.effectId ? { effectId: info.effectId } : {}),
            phase: info.phase,
            message: errorMessage(info.error),
            timestamp: Date.now(),
        };
        diag.consecutiveErrors++;
        diag.totalErrors++;
        diag.lastError = entry;
        diag.recentErrors.push(entry);
        if (diag.recentErrors.length > MAX_RECENT_PLUGIN_ERRORS) {
            diag.recentErrors.shift();
        }
        if (diag.consecutiveErrors >= this.maxConsecutiveErrors) {
            diag.disabled = true;
            const record = this.plugins.get(pluginId);
            if (record) record.disabled = true;
        }
        return diag.disabled;
    }

    recordPluginSuccess(pluginId: string): void {
        const diag = this.diagnostics.get(pluginId);
        if (!diag || diag.disabled) return;
        diag.consecutiveErrors = 0;
    }

    isPluginDisabled(pluginId: string): boolean {
        const record = this.plugins.get(pluginId);
        return Boolean(record?.disabled || record?.manifest.dependencies?.some(
            id => !this.plugins.has(id) || this.isPluginDisabled(id),
        ));
    }

    reEnablePlugin(pluginId: string): void {
        const record = this.plugins.get(pluginId);
        const diag = this.diagnostics.get(pluginId);
        if (record) record.disabled = false;
        if (diag) {
            diag.disabled = false;
            diag.consecutiveErrors = 0;
        }
    }

    getPluginDiagnostic(pluginId: string): VfxPluginDiagnostic | undefined {
        const diag = this.diagnostics.get(pluginId);
        return diag ? this.snapshotDiagnostic(diag) : undefined;
    }

    getPluginDiagnostics(): VfxPluginDiagnostic[] {
        return [...this.diagnostics.values()].map(diag => this.snapshotDiagnostic(diag));
    }
}

export const vfxRegistry = new VfxRegistry();

export function registerVfxPlugin(plugin: VfxPluginModule, registry: VfxRegistry = vfxRegistry): VfxPluginRecord {
    return registry.registerPlugin(plugin);
}

export function unregisterVfxPlugin(pluginId: string, registry: VfxRegistry = vfxRegistry): boolean {
    return registry.unregisterPlugin(pluginId);
}

export function listVfxPlugins(registry: VfxRegistry = vfxRegistry): VfxPluginRecord[] {
    return registry.listPlugins();
}
