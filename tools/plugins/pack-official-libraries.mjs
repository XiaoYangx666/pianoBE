#!/usr/bin/env bun
/**
 * 将官方曲库（midis/library/*.pbe3）与官方精选演出（midis/performances/*.json）
 * 真正打包为标准的 `.pbeplugin` 分发包，输出到 build/plugins/。
 *
 * 原则：
 * - 插件负责分发，曲库负责组织，歌曲负责音乐，演出负责编排
 * - 曲库分类以 midis/library/genres.json 的人工分类为准（新增曲目必须补登记）
 * - 演出作为独立的 performances/<songId>.json 存在于插件内，不硬焊进 PBE3 字节
 * - 不声明对 VFX 插件的硬性依赖（缺少特效插件时音乐本体仍可安装和播放）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    compilePerformanceSource,
    computeMusicFingerprint,
    readSongHeader,
} from "@piano/core";
import { VFX_API_VERSION } from "@piano/vfx";
import { readPbePluginArchive, writePbePluginArchive } from "@piano/vfx/package";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const libraryDir = join(root, "midis", "library");
const perfDir = join(root, "midis", "performances");

/** 官方曲库人工分类表：歌曲 id -> 曲库 key（维护时直接改 midis/library/genres.json） */
const GENRES_FILE = "genres.json";
const GENRE_KEYS = ["game", "anime-film", "jay-chou", "chinese-pop", "western", "classical"];

function loadGenreMap() {
    const file = join(libraryDir, GENRES_FILE);
    if (!existsSync(file)) {
        throw new Error(`未找到人工分类表：${file}`);
    }
    return JSON.parse(readFileSync(file, "utf8"));
}

function buildPackArchive({
    pluginId,
    pluginName,
    description,
    icon,
    libraryId,
    libraryName,
    songIds,
    songBytesMap,
    performancesBySong = new Map(),
}) {
    const files = new Map();
    const validSongIds = [];
    const perfIds = [];

    for (const songId of songIds) {
        const bytes = songBytesMap.get(songId);
        if (!bytes) continue;
        const header = readSongHeader(bytes);
        if (validSongIds.includes(header.id)) continue;
        validSongIds.push(header.id);
        files.set(`songs/${header.id}.pbe3`, bytes);

        const perf = performancesBySong.get(header.id);
        if (perf) {
            perfIds.push(perf.id);
            files.set(
                `performances/${header.id}.json`,
                JSON.stringify(
                    {
                        id: perf.id,
                        name: perf.name,
                        author: "PianoBE",
                        ...(perf.description ? { description: perf.description } : {}),
                        songId: header.id,
                        musicFingerprint: computeMusicFingerprint(bytes),
                        cues: perf.cues,
                    },
                    null,
                    2,
                ),
            );
        }
    }

    const capabilities = ["libraries", "songs"];
    if (perfIds.length > 0) capabilities.push("performances");

    const manifest = {
        id: pluginId,
        name: pluginName,
        version: "1.0.0",
        apiVersion: VFX_API_VERSION,
        minPianoBeVersion: "1.3.0",
        capabilities,
        author: "PianoBE",
        license: "CC-BY-NC-4.0",
        ...(icon !== undefined ? { icon } : {}),
        provides: {
            libraries: [libraryId],
            songs: validSongIds,
            ...(perfIds.length ? { performances: perfIds } : {}),
        },
        preview: { description },
    };

    files.set("plugin.json", `${JSON.stringify(manifest, null, 4)}\n`);
    files.set(
        `libraries/${libraryId}.json`,
        JSON.stringify(
            {
                id: libraryId,
                name: libraryName,
                description,
                author: "PianoBE",
                songs: validSongIds,
            },
            null,
            2,
        ),
    );

    const bytes = writePbePluginArchive(files);
    const verified = readPbePluginArchive(bytes);
    return { manifest: verified.manifest, bytes, archive: verified };
}

export async function packOfficialLibraries(outDir = join(root, "build/plugins")) {
    if (!existsSync(join(libraryDir, "index.json"))) {
        throw new Error(`未找到官方曲库索引：${join(libraryDir, "index.json")}`);
    }
    const indexSongs = JSON.parse(readFileSync(join(libraryDir, "index.json"), "utf8"));
    const genreMap = loadGenreMap();
    const unclassified = [];
    const songBytesMap = new Map();
    for (const entry of indexSongs) {
        const filePath = join(libraryDir, `${entry.id}.pbe3`);
        if (existsSync(filePath)) {
            songBytesMap.set(entry.id, new Uint8Array(readFileSync(filePath)));
        }
    }

    const performancesBySong = new Map();
    const featuredIds = [];
    if (existsSync(perfDir)) {
        for (const file of readdirSync(perfDir).sort()) {
            if (!file.endsWith(".json")) continue;
            const songId = file.replace(/\.json$/i, "");
            if (!songBytesMap.has(songId)) continue;
            const parsed = JSON.parse(readFileSync(join(perfDir, file), "utf8"));
            const cues = compilePerformanceSource(parsed, { expectedSongId: songId });
            const title = typeof parsed.title === "string" && parsed.title.trim()
                ? parsed.title.trim()
                : `${songId} 精选演出`;
            featuredIds.push(songId);
            performancesBySong.set(songId, {
                id: `pianobe.pack.featured:${songId}`,
                name: title,
                description: "PianoBE 官方精选舞台演出编排",
                cues,
            });
        }
    }

    const buckets = new Map(GENRE_KEYS.map((key) => [key, []]));

    for (const entry of indexSongs) {
        if (!songBytesMap.has(entry.id)) continue;
        const genre = genreMap[entry.id];
        if (!genre || !buckets.has(genre)) {
            unclassified.push(`${entry.id}\t${entry.name}`);
            continue;
        }
        buckets.get(genre).push(entry.id);
    }
    if (unclassified.length > 0) {
        throw new Error(
            `以下曲目缺少人工分类（请在 midis/library/genres.json 中补充，可选值：${[...buckets.keys()].join(" / ")}）：\n${unclassified.join("\n")}`,
        );
    }

    const specs = [
        {
            pluginId: "pianobe.pack.featured",
            pluginName: "官方精选演出包",
            description: "7 首官方编排舞台演出的精选曲目与独立演出脚本（需搭配对应特效插件呈现完整舞台效果）",
            icon: { text: "精", color: "#14b8a6" },
            libraryId: "official:featured",
            libraryName: "精选演出",
            songIds: featuredIds,
            performancesBySong,
        },
        {
            pluginId: "pianobe.pack.jay-chou",
            pluginName: "周杰伦精选曲库",
            description: "精选周杰伦热门钢琴改编曲目合集",
            icon: { text: "杰", color: "#f59e0b" },
            libraryId: "official:jay-chou",
            libraryName: "周杰伦精选",
            songIds: buckets.get("jay-chou"),
        },
        {
            pluginId: "pianobe.pack.chinese-pop",
            pluginName: "华语流行曲库",
            description: "华语经典与当代流行钢琴曲目合集",
            icon: { text: "华", color: "#ec4899" },
            libraryId: "official:chinese-pop",
            libraryName: "华语流行",
            songIds: buckets.get("chinese-pop"),
        },
        {
            pluginId: "pianobe.pack.game",
            pluginName: "游戏音乐曲库",
            description: "原神、崩坏、Minecraft、东方与各大游戏原声合集",
            icon: { text: "游", color: "#8b5cf6" },
            libraryId: "official:game",
            libraryName: "游戏音乐",
            songIds: buckets.get("game"),
        },
        {
            pluginId: "pianobe.pack.anime-film",
            pluginName: "影视与动漫曲库",
            description: "吉卜力、新海诚、经典动画与影视配乐合集",
            icon: { text: "漫", color: "#38bdf8" },
            libraryId: "official:anime-film",
            libraryName: "影视与动漫",
            songIds: buckets.get("anime-film"),
        },
        {
            pluginId: "pianobe.pack.classical",
            pluginName: "古典钢琴曲库",
            description: "古典大师名曲、浪漫派与现代钢琴独奏合集",
            icon: { text: "古", color: "#d97706" },
            libraryId: "official:classical",
            libraryName: "古典钢琴",
            songIds: buckets.get("classical"),
        },
        {
            pluginId: "pianobe.pack.western",
            pluginName: "欧美音乐曲库",
            description: "欧美流行、电音与海外经典钢琴曲目合集",
            icon: { text: "欧", color: "#6366f1" },
            libraryId: "official:western",
            libraryName: "欧美音乐",
            songIds: buckets.get("western"),
        },
    ];

    mkdirSync(outDir, { recursive: true });
    const results = [];
    for (const spec of specs) {
        if (!spec.songIds.length) continue;
        const { manifest, bytes } = buildPackArchive({
            ...spec,
            songBytesMap,
        });
        const outPath = join(outDir, `${manifest.id}.pbeplugin`);
        writeFileSync(outPath, bytes);
        console.log(
            `[pack-official] ${manifest.id} v${manifest.version} -> ${outPath} (${(bytes.byteLength / 1024).toFixed(1)} KB, ${spec.songIds.length} songs)`,
        );
        results.push({ id: manifest.id, bytes, songCount: spec.songIds.length });
    }
    return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    let outDir = join(root, "build/plugins");
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--out" && args[i + 1]) {
            outDir = resolve(root, args[++i]);
        }
    }
    await packOfficialLibraries(outDir);
}
