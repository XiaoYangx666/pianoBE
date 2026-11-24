import { readAddon, type AddonTemplate } from "@bepack/addon";
import {
    attachSongPerformance,
    computeMusicFingerprint,
    decodeBase64Url,
    readSongHeader,
    type PerformanceCue,
    type PerformanceDescriptor,
} from "@piano/core";
import type { AssemblyScoreEntry, AssemblySongEntry, TemplateInfo } from "./types.js";

export const LEGACY_MIDI_TREE = "scripts/midis/";
export const MIDI_TREE = "scripts/packages/addon/src/midis/";
export const TIMBRES_SCRIPT_PATH = "scripts/packages/addon/src/domain/piano/timbres.js";
export const SCORE_PACK_SCRIPT_PATH = "scripts/packages/addon/src/data/scorePack.js";
export const MAX_SCORES = 16;
export const SCORE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function scoreUiDir(id: string): string {
    return `textures/ui/piano_score/${id}/`;
}

export function scoreStandPath(id: string): string {
    return `textures/entity/piano_score/${id}.png`;
}

export function templateMidiTree(addon: AddonTemplate, bpPath: string): string {
    return bpPath + (addon.has(bpPath + MIDI_TREE + "index.js") ? MIDI_TREE : LEGACY_MIDI_TREE);
}

export async function loadAddonTemplate(fileOrBlob: Blob | Uint8Array): Promise<TemplateInfo> {
    const addon = await readAddon(fileOrBlob);
    const bp = addon.packs.bp;
    const rp = addon.packs.rp;
    if (!bp || !rp) throw new Error("模板不完整：未找到 bp/rp manifest");

    const bpPath = bp.root;
    const rpPath = rp.root;
    const legacyDir = bpPath + LEGACY_MIDI_TREE;
    const songs = parseExistingMidis(
        addon,
        addon.has(legacyDir + "index.js") ? legacyDir : templateMidiTree(addon, bpPath),
    );
    const scores = parseTemplateScores(addon, bpPath);

    return {
        addon,
        bpPath,
        rpPath,
        bpManifest: bp.manifest,
        rpManifest: rp.manifest,
        songs,
        scores,
    };
}

function readOptionalObjectLiteral(source: string, prefix: string): { raw?: string; rest: string } {
    if (!source.startsWith(prefix)) return { rest: source };
    const start = prefix.length;
    const opener = source[start];
    if (opener !== "[" && opener !== "{") return { rest: source };
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === opener) depth++;
        else if (ch === closer) {
            depth--;
            if (depth === 0) {
                const after = source.slice(i + 1);
                if (after.startsWith(",")) {
                    return { raw: source.slice(start, i + 1), rest: after.slice(1) };
                }
                return { raw: source.slice(start, i + 1), rest: after };
            }
        }
    }
    return { rest: source };
}

export function parseExistingMidis(
    addon: AddonTemplate,
    midisDir: string,
): AssemblySongEntry[] {
    const content = addon.readTextSync(`${midisDir}index.js`);
    if (!content) return [];

    const headRegex =
        /\{id:("(?:[^"\\]|\\.)*"),name:("(?:[^"\\]|\\.)*"),duration:([\d.]+),(?:noteCount:(\d+),)?(?:bytes:(\d+),)?/g;

    const items: AssemblySongEntry[] = [];
    let match: RegExpExecArray | null;
    while ((match = headRegex.exec(content)) !== null) {
        const id = JSON.parse(match[1]) as string;
        const tail = content.slice(match.index + match[0].length);
        const libs = readOptionalObjectLiteral(tail, "libraries:");
        const perfEntriesRaw = readOptionalObjectLiteral(libs.rest, "performanceEntries:");
        const legacyPerfsRaw = readOptionalObjectLiteral(perfEntriesRaw.rest, "performances:");
        const valueMatch = /^value:async\(\)=>\s*\(await\s*import\("\.\/([^"]+)\.js"\)\)\.default\}/.exec(
            legacyPerfsRaw.rest,
        );
        if (!valueMatch) continue;
        const fileId = valueMatch[1];

        const jsContent = addon.readTextSync(`${midisDir}${fileId}.js`);
        if (!jsContent) continue;
        const encoded = /export\s+default\s+"([^"]+)"\s*;?/.exec(jsContent)?.[1];
        if (!encoded) continue;

        try {
            const data = decodeBase64Url(encoded);
            const header = readSongHeader(data);
            if (header.id !== id) continue;

            const entry: AssemblySongEntry = {
                id: header.id,
                name: header.name,
                duration: header.duration,
                noteCount: header.noteCount,
                bytes: data.length,
                musicFingerprint: computeMusicFingerprint(data),
                isOriginal: true,
                moduleText: jsContent,
                data,
            };

            if (libs.raw) {
                try {
                    const parsedLibs = JSON.parse(libs.raw);
                    if (Array.isArray(parsedLibs)) {
                        entry.libraries = parsedLibs.filter((item): item is string => typeof item === "string");
                    }
                } catch { /* ignore */ }
            }

            if (perfEntriesRaw.raw) {
                try {
                    const parsedEntries = JSON.parse(perfEntriesRaw.raw);
                    if (Array.isArray(parsedEntries)) {
                        entry.performanceEntries = parsedEntries.filter(
                            (item): item is PerformanceDescriptor =>
                                Boolean(item && typeof item === "object" && typeof item.id === "string"),
                        );
                    }
                } catch { /* ignore */ }
            }

            const performances: (readonly PerformanceCue[])[] = [];
            if (legacyPerfsRaw.raw) {
                try {
                    for (const cues of JSON.parse(legacyPerfsRaw.raw)) {
                        if (Array.isArray(cues) && cues.length) {
                            try {
                                const validated = readSongHeader(attachSongPerformance(data, cues)).performance;
                                if (validated) performances.push(validated);
                            } catch { /* ignore malformed performance */ }
                        }
                    }
                } catch { /* ignore */ }
            }
            if (performances.length) entry.performances = performances;
            items.push(entry);
        } catch (error) {
            console.warn(`[assembly] 模板曲目 ${id} 解析失败`, error);
        }
    }
    return items;
}

export function parseTemplateScores(addon: AddonTemplate, bpPath: string): AssemblyScoreEntry[] {
    const text = addon.readTextSync(`${bpPath}${SCORE_PACK_SCRIPT_PATH}`);
    if (!text) return [];
    try {
        const raw = extractPianoScores(text);
        return raw ? normalizeTemplateScores(raw) : [];
    } catch (e) {
        console.warn("[assembly] 模板曲谱解析失败，按无曲谱处理：", e);
        return [];
    }
}

function extractPianoScores(source: string): unknown {
    const identifier = /\bPIANO_SCORES\b/g;
    let match: RegExpExecArray | null;
    while ((match = identifier.exec(source)) !== null) {
        let cursor = match.index + match[0].length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== "=") continue;
        cursor++;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== "[") continue;

        const end = matchBracket(source, cursor);
        if (end < 0) return null;
        const json = source.slice(cursor, end + 1).replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(json);
    }
    return null;
}

function matchBracket(source: string, start: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "[") depth++;
        else if (ch === "]") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function normalizeRelativePath(raw: string): string {
    return raw.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

function normalizeTemplateScores(raw: unknown): AssemblyScoreEntry[] {
    if (!Array.isArray(raw)) throw new Error("PIANO_SCORES 不是数组");
    const scores: AssemblyScoreEntry[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const title = typeof record.title === "string" ? record.title.trim() : "";
        const pages = Array.isArray(record.pages)
            ? record.pages
                  .filter((page): page is string => typeof page === "string" && page.trim().length > 0)
                  .map((page) => normalizeRelativePath(page.trim()))
            : [];
        const pageCount = typeof record.pageCount === "number" && Number.isInteger(record.pageCount) &&
            record.pageCount > 0 ? record.pageCount : undefined;
        if (!SCORE_ID_PATTERN.test(id) || !title || pages.length === 0 || seen.has(id)) continue;
        seen.add(id);
        scores.push({ id, title, pages, pageCount, source: "template" });
        if (scores.length >= MAX_SCORES) break;
    }
    return scores;
}

export function serializeScorePackModule(
    scores: readonly AssemblyScoreEntry[],
    resourcePackId: string,
): string {
    const data = scores.map(({ id, title, pageCount, pages }) => ({
        id,
        title,
        ...(pageCount !== undefined ? { pageCount } : {}),
        pages,
    }));
    return (
        `export const SCORE_RESOURCE_PACK_ID = ${JSON.stringify(resourcePackId)};\n` +
        `export const PIANO_SCORES = ${JSON.stringify(data, null, 4)};\n`
    );
}
