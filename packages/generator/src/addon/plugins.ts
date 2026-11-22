import { readAddonArchive } from "@bepack/addon";
import { decodeSong, estimateSongVoiceLoad, readSongHeader } from "@piano/core";
import {
    VFX_API_VERSION,
    isApiVersionCompatible,
    type VfxPluginManifest,
} from "@piano/vfx";
import { readPbePluginArchive, type PbePluginArchive } from "@piano/vfx/package";
import { pbe3ToEntry } from "../music/convert";
import type { StoredPlugin } from "./localPlugins";
import type { SongEntry } from "../types";

export type PluginSource = "builtin" | "local" | "song";

/** public/plugins/index.json 中的内置插件索引项。 */
export interface PluginIndexEntry {
    id: string;
    manifest: VfxPluginManifest;
    size: number;
    file: string;
    source: "builtin";
}

/** 生成器内展示与装配的插件条目。 */
export interface GeneratorPluginEntry {
    id: string;
    manifest: VfxPluginManifest;
    size: number;
    source: PluginSource;
    /** 内置插件的文件名（位于 public/plugins/<file>） */
    file?: string;
    /** 本地 / 歌曲附带插件的原始 .pbeplugin 字节 */
    bytes?: Uint8Array;
    /** 用户是否已明确信任此插件（内置插件默认信任） */
    trusted: boolean;
    /** 当前插件与宿主 VFX API 是否兼容 */
    compatible: boolean;
    compatibilityReason?: string;
    previewDataUrl?: string;
    /** 若随歌曲包导入，记录来源包名 */
    songSourceName?: string;
}

export interface SongPluginMatchReason {
    effects: string[];
    songs: string[];
}

export interface MissingEffectDemand {
    effect: string;
    songs: string[];
}

export interface DisabledRequiredEffectDemand {
    effect: string;
    pluginId: string;
    pluginName: string;
    songs: string[];
    untrusted: boolean;
}

export interface SongPluginMatchResult {
    songEffects: Map<string, string[]>;
    autoSelectedIds: string[];
    reasons: Map<string, SongPluginMatchReason>;
    missingEffects: MissingEffectDemand[];
    disabledRequiredEffects: DisabledRequiredEffectDemand[];
}

export interface UnpackedSongBundle {
    songs: SongEntry[];
    plugins: GeneratorPluginEntry[];
    errors: string[];
}

const archiveCache = new Map<string, Promise<PbePluginArchive>>();

function checkCompatibility(manifest: VfxPluginManifest): { compatible: boolean; reason?: string } {
    if (isApiVersionCompatible(manifest.apiVersion, VFX_API_VERSION)) {
        return { compatible: true };
    }
    return {
        compatible: false,
        reason: `插件需要 VFX API ${manifest.apiVersion}，当前宿主为 ${VFX_API_VERSION}`,
    };
}

function previewMimeType(path: string): string | null {
    const lower = path.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    return null;
}

function bytesToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function extractPreviewDataUrl(archive: PbePluginArchive): string | undefined {
    const preferred = archive.manifest.preview?.thumbnail ?? archive.manifest.preview?.screenshots?.[0];
    const candidates = preferred
        ? [preferred, ...archive.previews.keys()]
        : [...archive.previews.keys()];
    for (const relPath of candidates) {
        const normalized = relPath.replace(/^\/+/, "");
        const bytes = archive.previews.get(normalized) ?? archive.files.get(normalized);
        if (!bytes) continue;
        const mime = previewMimeType(normalized);
        if (!mime) continue;
        return `data:${mime};base64,${bytesToBase64(bytes)}`;
    }
    return undefined;
}

export function archiveToPluginEntry(
    archive: PbePluginArchive,
    source: PluginSource,
    options: { file?: string; trusted?: boolean; songSourceName?: string } = {},
): GeneratorPluginEntry {
    const compatibility = checkCompatibility(archive.manifest);
    return {
        id: archive.manifest.id,
        manifest: archive.manifest,
        size: archive.size,
        source,
        ...(options.file ? { file: options.file } : {}),
        ...(source !== "builtin" ? { bytes: archive.bytes } : {}),
        trusted: options.trusted ?? source === "builtin",
        compatible: compatibility.compatible,
        ...(compatibility.reason ? { compatibilityReason: compatibility.reason } : {}),
        previewDataUrl: extractPreviewDataUrl(archive),
        ...(options.songSourceName ? { songSourceName: options.songSourceName } : {}),
    };
}

export function parsePbePluginBytes(
    bytes: Uint8Array,
    source: PluginSource = "local",
    options: { trusted?: boolean; songSourceName?: string } = {},
): GeneratorPluginEntry {
    const archive = readPbePluginArchive(bytes);
    return archiveToPluginEntry(archive, source, options);
}

export async function parsePbePluginFile(
    file: File,
    source: "local" | "song" = "local",
    songSourceName?: string,
): Promise<GeneratorPluginEntry> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parsePbePluginBytes(bytes, source, { trusted: false, songSourceName });
}

export function storedPluginToEntry(stored: StoredPlugin): GeneratorPluginEntry | null {
    try {
        return parsePbePluginBytes(stored.bytes, stored.source, {
            trusted: stored.trusted,
            songSourceName: stored.songSourceName,
        });
    } catch (error) {
        console.warn(`[generator] 跳过损坏的本地插件 ${stored.id}:`, error);
        return null;
    }
}

/** 加载内置插件清单；失败时返回空数组，不阻断生成器使用。 */
export async function loadPluginIndex(): Promise<GeneratorPluginEntry[]> {
    try {
        const res = await fetch(`./plugins/index.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const entries = (await res.json()) as PluginIndexEntry[];
        return entries.map((entry) => {
            const compatibility = checkCompatibility(entry.manifest);
            return {
                id: entry.id,
                manifest: entry.manifest,
                size: entry.size,
                source: "builtin",
                file: entry.file,
                trusted: true,
                compatible: compatibility.compatible,
                ...(compatibility.reason ? { compatibilityReason: compatibility.reason } : {}),
            };
        });
    } catch (error) {
        console.error("[generator] 插件清单加载失败：", error);
        return [];
    }
}

/** 按需加载并验证单个插件包字节（内置插件会按 id+version 缓存）。 */
export function loadPluginArchive(entry: GeneratorPluginEntry): Promise<PbePluginArchive> {
    if (entry.bytes) {
        return Promise.resolve(readPbePluginArchive(entry.bytes));
    }
    if (!entry.file) {
        return Promise.reject(new Error(`插件 ${entry.manifest.name} 缺少数据包文件`));
    }
    const cacheKey = `${entry.id}@${entry.manifest.version}:${entry.file}`;
    let pending = archiveCache.get(cacheKey);
    if (!pending) {
        pending = (async () => {
            const res = await fetch(`./plugins/${entry.file}?t=${Date.now()}`);
            if (!res.ok) throw new Error(`插件加载失败：${entry.manifest.name} (${res.status})`);
            const bytes = new Uint8Array(await res.arrayBuffer());
            return readPbePluginArchive(bytes);
        })();
        pending.catch(() => archiveCache.delete(cacheKey));
        archiveCache.set(cacheKey, pending);
    }
    return pending;
}

/** 从 PBE3 二进制头部提取曲目演出中引用的全部唯一 Effect ID。 */
export function extractSongEffectIds(data?: Uint8Array): string[] {
    if (!data || data.length === 0) return [];
    try {
        const header = readSongHeader(data);
        const cues = header.performance;
        if (!cues || cues.length === 0) return [];
        const ids = new Set<string>();
        for (const cue of cues) {
            if (typeof cue.effect === "string" && cue.effect.trim()) {
                ids.add(cue.effect.trim());
            }
        }
        return [...ids].sort();
    } catch {
        return [];
    }
}

function chooseProvider(
    candidates: readonly GeneratorPluginEntry[],
    selectedSet: ReadonlySet<string>,
): GeneratorPluginEntry | undefined {
    if (candidates.length === 0) return undefined;
    return (
        candidates.find((plugin) => plugin.compatible && plugin.trusted && selectedSet.has(plugin.id)) ??
        candidates.find((plugin) => plugin.compatible && plugin.trusted && plugin.source === "builtin") ??
        candidates.find((plugin) => plugin.compatible && plugin.trusted) ??
        candidates.find((plugin) => plugin.compatible) ??
        candidates[0]
    );
}

/**
 * 解析当前工作区曲目对特效 ID 的需求，匹配已安装插件并报告原因与缺失/未启用项。
 */
export function matchSongPlugins(
    songs: readonly SongEntry[],
    plugins: readonly GeneratorPluginEntry[],
    selectedPluginIds: readonly string[],
): SongPluginMatchResult {
    const selectedSet = new Set(selectedPluginIds);
    const songEffects = new Map<string, string[]>();
    const effectToSongs = new Map<string, Set<string>>();

    for (const song of songs) {
        const effects = extractSongEffectIds(song.data);
        songEffects.set(song.id, effects);
        for (const effect of effects) {
            let names = effectToSongs.get(effect);
            if (!names) {
                names = new Set<string>();
                effectToSongs.set(effect, names);
            }
            names.add(song.name);
        }
    }

    const providersByEffect = new Map<string, GeneratorPluginEntry[]>();
    for (const plugin of plugins) {
        for (const effect of plugin.manifest.provides.effects ?? []) {
            let list = providersByEffect.get(effect);
            if (!list) {
                list = [];
                providersByEffect.set(effect, list);
            }
            list.push(plugin);
        }
    }

    const reasons = new Map<string, { effects: Set<string>; songs: Set<string> }>();
    const autoSelectedSet = new Set<string>();
    const missingEffects: MissingEffectDemand[] = [];
    const disabledRequiredEffects: DisabledRequiredEffectDemand[] = [];

    for (const [effect, songSet] of effectToSongs) {
        const songNames = [...songSet];
        const compatibleProviders = (providersByEffect.get(effect) ?? []).filter((plugin) => plugin.compatible);
        const provider = chooseProvider(compatibleProviders, selectedSet);
        if (!provider) {
            missingEffects.push({ effect, songs: songNames });
            continue;
        }

        let entry = reasons.get(provider.id);
        if (!entry) {
            entry = { effects: new Set<string>(), songs: new Set<string>() };
            reasons.set(provider.id, entry);
        }
        entry.effects.add(effect);
        for (const songName of songNames) entry.songs.add(songName);

        if (provider.trusted) {
            autoSelectedSet.add(provider.id);
            if (!selectedSet.has(provider.id)) {
                disabledRequiredEffects.push({
                    effect,
                    pluginId: provider.id,
                    pluginName: provider.manifest.name,
                    songs: songNames,
                    untrusted: false,
                });
            }
        } else {
            disabledRequiredEffects.push({
                effect,
                pluginId: provider.id,
                pluginName: provider.manifest.name,
                songs: songNames,
                untrusted: true,
            });
        }
    }

    const normalizedReasons = new Map<string, SongPluginMatchReason>();
    for (const [id, value] of reasons) {
        normalizedReasons.set(id, {
            effects: [...value.effects].sort(),
            songs: [...value.songs],
        });
    }

    return {
        songEffects,
        autoSelectedIds: [...autoSelectedSet],
        reasons: normalizedReasons,
        missingEffects,
        disabledRequiredEffects,
    };
}

function pbe3ToSongWithPeak(bytes: Uint8Array): SongEntry {
    const entry = pbe3ToEntry(bytes);
    try {
        const song = decodeSong(bytes);
        const voiceLoad = estimateSongVoiceLoad(song);
        return { ...entry, voicePeak: voiceLoad.peakVoices };
    } catch {
        return entry;
    }
}

/**
 * 解析导入的歌曲包 / `.pbe3` / 附带 `.pbeplugin` 压缩包（`.zip` / `.pbesong`）。
 * 随包识别出的插件统一标记 `trusted = false`，由上层弹窗交用户确认后再允许装配。
 */
export async function unpackSongBundles(files: readonly File[]): Promise<UnpackedSongBundle> {
    const songs: SongEntry[] = [];
    const plugins: GeneratorPluginEntry[] = [];
    const errors: string[] = [];

    for (const file of files) {
        const lower = file.name.toLowerCase();
        try {
            if (lower.endsWith(".pbe3")) {
                const bytes = new Uint8Array(await file.arrayBuffer());
                songs.push(pbe3ToSongWithPeak(bytes));
                continue;
            }
            if (lower.endsWith(".pbeplugin")) {
                plugins.push(await parsePbePluginFile(file, "local"));
                continue;
            }
            if (lower.endsWith(".zip") || lower.endsWith(".pbesong")) {
                const entries = await readAddonArchive(new Uint8Array(await file.arrayBuffer()));
                let found = 0;
                for (const item of entries) {
                    const entryLower = item.path.toLowerCase();
                    if (entryLower.endsWith(".pbe3")) {
                        songs.push(pbe3ToSongWithPeak(item.bytes));
                        found++;
                    } else if (entryLower.endsWith(".pbeplugin")) {
                        plugins.push(
                            parsePbePluginBytes(item.bytes, "song", {
                                trusted: false,
                                songSourceName: file.name,
                            }),
                        );
                        found++;
                    }
                }
                if (found === 0) {
                    errors.push(`${file.name}：压缩包中未包含 .pbe3 曲目或 .pbeplugin 插件`);
                }
                continue;
            }
            errors.push(`${file.name}：不支持的导入格式`);
        } catch (error) {
            errors.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return { songs, plugins, errors };
}

export function summarizePluginProvides(
    plugin: GeneratorPluginEntry,
    emptyLabel = "基础能力",
): string {
    const p = plugin.manifest.provides;
    const parts: string[] = [];
    if (p.effects?.length) parts.push(`${p.effects.length} 特效`);
    if (p.themes?.length) parts.push(`${p.themes.length} 主题`);
    if (p.layouts?.length) parts.push(`${p.layouts.length} 舞台布局`);
    if (p.keyStyles?.length) parts.push(`${p.keyStyles.length} 键粒样式`);
    if (p.particles?.length) parts.push(`${p.particles.length} 粒子`);
    return parts.join(" · ") || emptyLabel;
}

export function mergePluginLists(
    builtins: readonly GeneratorPluginEntry[],
    locals: readonly GeneratorPluginEntry[],
): GeneratorPluginEntry[] {
    const merged = new Map<string, GeneratorPluginEntry>();
    for (const entry of builtins) merged.set(entry.id, entry);
    for (const entry of locals) merged.set(entry.id, entry);
    return [...merged.values()];
}
