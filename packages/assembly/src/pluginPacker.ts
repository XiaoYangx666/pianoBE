import { computeMusicFingerprint, crc32Hex, encodeUtf8, readSongHeader, type PerformanceCue } from "@piano/core";
import { VFX_API_VERSION, type VfxPluginManifest } from "@piano/vfx";
import { readPbePluginArchive, writePbePluginArchive } from "@piano/vfx/package";

export interface PackLibrarySongInput {
    id: string;
    name: string;
    bytes: Uint8Array;
    performances?: readonly {
        id: string;
        name: string;
        author?: string;
        description?: string;
        cues: readonly PerformanceCue[];
    }[];
}

export interface PackLibraryPluginInput {
    pluginId?: string;
    libraryId?: string;
    name: string;
    description?: string;
    author?: string;
    version?: string;
    songs: readonly PackLibrarySongInput[];
}

function sanitizeIdPart(raw: string, fallback: string): string {
    const clean = raw
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "_")
        .replace(/^[^a-z]+/, "")
        .replace(/[_.-]+$/g, "");
    return clean.slice(0, 32) || fallback;
}

/**
 * 将用户曲库自动打包为标准 `.pbeplugin` 二进制，无需用户手写 manifest 或目录结构。
 */
export function packLibraryAsPlugin(input: PackLibraryPluginInput): {
    bytes: Uint8Array;
    manifest: VfxPluginManifest;
} {
    const title = input.name.trim() || "我的曲库";
    const hash = crc32Hex(encodeUtf8(`${title}:${Date.now()}:${input.songs.length}`)).slice(0, 8);
    const slug = sanitizeIdPart(title, `lib_${hash}`);
    const pluginId = input.pluginId ?? `user.${slug}_${hash}`.slice(0, 64);
    const libraryId = input.libraryId ?? `${slug}_${hash}`.slice(0, 64);
    const author = input.author?.trim() || "PianoBE User";
    const version = input.version ?? "1.0.0";

    const files = new Map<string, Uint8Array | string>();
    const songIds: string[] = [];
    const perfIds: string[] = [];

    for (const song of input.songs) {
        const header = readSongHeader(song.bytes);
        if (songIds.includes(header.id)) continue;
        songIds.push(header.id);
        files.set(`songs/${header.id}.pbe3`, song.bytes);

        const fp = computeMusicFingerprint(song.bytes);
        for (const perf of song.performances ?? []) {
            if (!perf.cues.length) continue;
            const perfSlug = sanitizeIdPart(perf.id, `perf_${perfIds.length + 1}`);
            const uniquePerfId = perfIds.includes(perfSlug) ? `${perfSlug}_${perfIds.length + 1}` : perfSlug;
            perfIds.push(uniquePerfId);
            files.set(
                `performances/${uniquePerfId}.json`,
                JSON.stringify(
                    {
                        id: perf.id,
                        name: perf.name,
                        ...(perf.author ? { author: perf.author } : {}),
                        ...(perf.description ? { description: perf.description } : {}),
                        songId: header.id,
                        musicFingerprint: fp,
                        cues: perf.cues,
                    },
                    null,
                    2,
                ),
            );
        }
    }

    const capabilities: VfxPluginManifest["capabilities"][number][] = ["libraries"];
    if (songIds.length > 0) capabilities.push("songs");
    if (perfIds.length > 0) capabilities.push("performances");

    const manifest: VfxPluginManifest = {
        id: pluginId,
        name: title,
        version,
        apiVersion: VFX_API_VERSION,
        minPianoBeVersion: "1.3.0",
        capabilities,
        author,
        license: "CC-BY-NC-4.0",
        provides: {
            libraries: [libraryId],
            ...(songIds.length ? { songs: songIds } : {}),
            ...(perfIds.length ? { performances: perfIds } : {}),
        },
        ...(input.description?.trim() ? { preview: { description: input.description.trim() } } : {}),
    };

    files.set("plugin.json", `${JSON.stringify(manifest, null, 4)}\n`);
    files.set(
        `libraries/${libraryId}.json`,
        JSON.stringify(
            {
                id: libraryId,
                name: title,
                ...(input.description?.trim() ? { description: input.description.trim() } : {}),
                author,
                songs: songIds,
            },
            null,
            2,
        ),
    );

    const bytes = writePbePluginArchive(files);
    const verified = readPbePluginArchive(bytes);
    return { bytes, manifest: verified.manifest };
}
