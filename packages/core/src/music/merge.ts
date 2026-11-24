import type { PerformanceCue } from "../pbe3/performance.js";
import { readPbe3Header } from "../pbe3/codec.js";
import {
    computeMusicFingerprint,
    findFreeSongId,
    reidentifySong,
    sameSongMusic,
    sameSongPerformance,
} from "../songCodec.js";
import type { MidiSongMeta } from "../types.js";
import {
    defaultPerformanceId,
    extractCueEffects,
    type ContentOrigin,
    type LibraryRecord,
    type PerformanceDescriptor,
    type SongConflict,
} from "./domain.js";

export interface CatalogSongCandidate extends MidiSongMeta {
    data?: Uint8Array;
    /** 若带有默认/内嵌演出，可指定其稳定 ID 与名称 */
    defaultPerformanceId?: string;
    defaultPerformanceName?: string;
    defaultPerformanceAuthor?: string;
}

export interface MergeSongCatalogOptions {
    /** 若 ID 冲突且音乐内容不同，是否自动分配新 ID 而非报错冲突 */
    reidentifyOnIdConflict?: boolean;
}

export interface MergeSongCatalogResult<T extends CatalogSongCandidate = CatalogSongCandidate> {
    songs: T[];
    conflicts: SongConflict[];
    changed: T[];
}

export interface ContentIndexSource<T extends CatalogSongCandidate = CatalogSongCandidate> {
    songs: readonly T[];
    libraries?: readonly LibraryRecord[];
}

export interface RebuiltContentIndex<T extends CatalogSongCandidate = CatalogSongCandidate> {
    songs: T[];
    libraries: LibraryRecord[];
    conflicts: SongConflict[];
}

function originKey(origin?: ContentOrigin): string {
    if (!origin) return "";
    return `${origin.kind}:${origin.id ?? ""}`;
}

function mergeOrigins(
    existing?: readonly ContentOrigin[],
    singleExisting?: ContentOrigin,
    incomingList?: readonly ContentOrigin[],
    incomingSingle?: ContentOrigin,
): ContentOrigin[] | undefined {
    const out: ContentOrigin[] = [];
    const seen = new Set<string>();
    const push = (origin?: ContentOrigin) => {
        if (!origin) return;
        const key = originKey(origin);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(origin);
    };
    if (singleExisting) push(singleExisting);
    for (const item of existing ?? []) push(item);
    if (incomingSingle) push(incomingSingle);
    for (const item of incomingList ?? []) push(item);
    return out.length ? out : undefined;
}

function mergeStrings(a?: readonly string[], b?: readonly string[], extra?: string): string[] | undefined {
    const set = new Set<string>();
    for (const item of a ?? []) if (item) set.add(item);
    for (const item of b ?? []) if (item) set.add(item);
    if (extra) set.add(extra);
    return set.size ? [...set] : undefined;
}

function extractSongPerformanceDescriptors(song: CatalogSongCandidate): PerformanceDescriptor[] {
    const out: PerformanceDescriptor[] = [];
    const seenIds = new Set<string>();

    const push = (desc: PerformanceDescriptor) => {
        if (!desc.id || seenIds.has(desc.id)) return;
        seenIds.add(desc.id);
        out.push({
            ...desc,
            songId: desc.songId ?? song.id,
            ...(desc.cues && !desc.requiredEffects ? { requiredEffects: extractCueEffects(desc.cues) } : {}),
            ...(desc.origin ?? song.origin ? { origin: desc.origin ?? song.origin } : {}),
        });
    };

    for (const entry of song.performanceEntries ?? []) push(entry);

    if (song.data) {
        try {
            const header = readPbe3Header(song.data);
            if (header.performance?.length && out.length === 0) {
                push({
                    id: song.defaultPerformanceId ?? defaultPerformanceId(song.id),
                    name: song.defaultPerformanceName ?? "曲目默认演出",
                    ...(song.defaultPerformanceAuthor ? { author: song.defaultPerformanceAuthor } : {}),
                    songId: song.id,
                    cues: header.performance,
                    requiredEffects: extractCueEffects(header.performance),
                    origin: song.origin,
                });
            }
        } catch {
            // 忽略非 PBE3 或头部不可读的占位条目
        }
    }

    if (song.performances?.length && out.length === 0) {
        song.performances.forEach((cues, index) => {
            if (!cues.length) return;
            push({
                id: `${song.id}:perf:${index + 1}`,
                name: `演出 ${index + 1}`,
                songId: song.id,
                cues,
                requiredEffects: extractCueEffects(cues),
                origin: song.origin,
            });
        });
    }

    return out;
}

function sameCues(baseData: Uint8Array | undefined, left?: readonly PerformanceCue[], right?: readonly PerformanceCue[]): boolean {
    if (!left || !right) return false;
    if (baseData) return sameSongPerformance(baseData, left, right);
    return left.length === right.length && JSON.stringify(left) === JSON.stringify(right);
}

function mergePerformanceLists(
    baseData: Uint8Array | undefined,
    existing: readonly PerformanceDescriptor[],
    incoming: readonly PerformanceDescriptor[],
): PerformanceDescriptor[] {
    const next = existing.map((item) => ({ ...item }));
    for (const candidate of incoming) {
        const byIdIndex = next.findIndex((item) => item.id === candidate.id);
        if (byIdIndex >= 0) {
            const current = next[byIdIndex];
            const samePluginOwner =
                current.origin?.kind === "plugin" &&
                candidate.origin?.kind === "plugin" &&
                current.origin.id !== undefined &&
                current.origin.id === candidate.origin.id;
            if (samePluginOwner || sameCues(baseData, current.cues, candidate.cues)) {
                next[byIdIndex] = {
                    ...current,
                    ...candidate,
                    cues: candidate.cues ?? current.cues,
                    requiredEffects: candidate.requiredEffects ?? current.requiredEffects,
                };
            }
            continue;
        }
        if (candidate.cues && next.some((item) => sameCues(baseData, item.cues, candidate.cues))) {
            // 音乐与编排完全相同：去重，不新增重复演出条目
            continue;
        }
        next.push(candidate);
    }
    return next;
}

function fingerprintOf(song: CatalogSongCandidate): string | undefined {
    if (song.musicFingerprint) return song.musicFingerprint;
    if (!song.data) return undefined;
    try {
        return computeMusicFingerprint(song.data);
    } catch {
        return undefined;
    }
}

function sameMusicCandidate(a: CatalogSongCandidate, b: CatalogSongCandidate, fpA?: string, fpB?: string): boolean {
    if (a.data && b.data) {
        return a.duration === b.duration && a.noteCount === b.noteCount && sameSongMusic(a.data, b.data);
    }
    if (fpA && fpB) return fpA === fpB;
    return false;
}

/**
 * 按设计方案 3.3 规则合并歌曲与演出：
 * - 基于规范化音乐本体/指纹合并同一首歌，不以歌名判断；
 * - 同 ID 但音乐不同时不静默覆盖（报告冲突，或按选项重分配 ID）；
 * - 同一首歌的多套独立演出按稳定 ID 共存，同插件同 ID 演出可原地更新，相同编排去重。
 */
export function mergeSongCatalog<T extends CatalogSongCandidate>(
    existing: readonly T[],
    incoming: readonly T[],
    options: MergeSongCatalogOptions = {},
): MergeSongCatalogResult<T> {
    const rows: T[] = existing.map((item) => {
        const fp = fingerprintOf(item);
        const perfEntries = extractSongPerformanceDescriptors(item);
        return {
            ...item,
            ...(fp ? { musicFingerprint: fp } : {}),
            ...(perfEntries.length ? { performanceEntries: perfEntries } : {}),
        };
    });
    const conflicts: SongConflict[] = [];
    const changed = new Map<string, T>();

    for (const rawSong of incoming) {
        const fp = fingerprintOf(rawSong);
        const incomingPerfs = extractSongPerformanceDescriptors(rawSong);
        const song: T = {
            ...rawSong,
            ...(fp ? { musicFingerprint: fp } : {}),
            ...(incomingPerfs.length ? { performanceEntries: incomingPerfs } : {}),
        };

        const matchIndex = rows.findIndex((row) =>
            sameMusicCandidate(row, song, row.musicFingerprint, fp),
        );

        if (matchIndex >= 0) {
            const current = rows[matchIndex];
            const currentPerfs = extractSongPerformanceDescriptors(current);
            const mergedPerfs = mergePerformanceLists(
                current.data ?? song.data,
                currentPerfs,
                incomingPerfs.map((perf) => ({ ...perf, songId: current.id })),
            );
            const aliases = mergeStrings(
                current.aliases,
                song.aliases,
                song.name && song.name !== current.name ? song.name : undefined,
            );
            const libraries = mergeStrings(current.libraries, song.libraries);
            const origins = mergeOrigins(current.origins, current.origin, song.origins, song.origin);
            const merged: T = {
                ...current,
                ...(current.data ? {} : song.data ? { data: song.data } : {}),
                ...(fp && !current.musicFingerprint ? { musicFingerprint: fp } : {}),
                ...(aliases ? { aliases } : {}),
                ...(libraries ? { libraries } : {}),
                ...(origins ? { origins, origin: current.origin ?? origins[0] } : {}),
                ...(mergedPerfs.length ? { performanceEntries: mergedPerfs } : {}),
            };
            rows[matchIndex] = merged;
            changed.set(merged.id, merged);
            continue;
        }

        const idConflict = rows.find((row) => row.id === song.id);
        if (idConflict) {
            if (options.reidentifyOnIdConflict && song.data) {
                const freeId = findFreeSongId(song.data, (candidate) => rows.some((r) => r.id === candidate));
                const reidentified: T = {
                    ...song,
                    id: freeId,
                    data: reidentifySong(song.data, freeId),
                };
                rows.push(reidentified);
                changed.set(reidentified.id, reidentified);
                continue;
            }
            conflicts.push({
                kind: "id_content_mismatch",
                songId: song.id,
                existingName: idConflict.name,
                incomingName: song.name,
                message: `歌曲 ID 冲突：${song.id}（已有《${idConflict.name}》，导入《${song.name}》内容不同）`,
            });
            continue;
        }

        rows.push(song);
        changed.set(song.id, song);
    }

    return {
        songs: rows,
        conflicts,
        changed: [...changed.values()],
    };
}

/**
 * 根据当前所有有效来源重建最终歌曲、演出与曲库索引。
 * 卸载某个插件时无需全局引用计数，只需从剩余有效来源重建即可自动清理孤立条目。
 */
export function rebuildContentIndex<T extends CatalogSongCandidate>(
    sources: readonly ContentIndexSource<T>[],
    options: MergeSongCatalogOptions = {},
): RebuiltContentIndex<T> {
    let songs: T[] = [];
    const conflicts: SongConflict[] = [];
    const librariesById = new Map<string, LibraryRecord>();

    for (const source of sources) {
        const result = mergeSongCatalog(songs, source.songs, options);
        songs = result.songs;
        conflicts.push(...result.conflicts);

        for (const lib of source.libraries ?? []) {
            const existing = librariesById.get(lib.id);
            if (!existing) {
                librariesById.set(lib.id, { ...lib, songIds: [...new Set(lib.songIds)] });
            } else {
                librariesById.set(lib.id, {
                    ...existing,
                    ...lib,
                    songIds: [...new Set([...existing.songIds, ...lib.songIds])],
                });
            }
        }
    }

    const validSongIds = new Set(songs.map((song) => song.id));
    const libraries = [...librariesById.values()].map((lib) => ({
        ...lib,
        songIds: lib.songIds.filter((id) => validSongIds.has(id)),
    }));

    return { songs, libraries, conflicts };
}
