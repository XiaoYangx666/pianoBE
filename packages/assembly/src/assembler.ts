import { AddonTemplate } from "@bepack/addon";
import {
    crc32Hex,
    encodeUtf8,
    mergeSongCatalog,
    metasToAddonIndex,
    readSongHeader,
    songToAddonModule,
} from "@piano/core";
import type { VfxPluginManifest } from "@piano/vfx";
import {
    HOST_PARTICLE_IDS,
    HOST_TEXTURES,
    STAGE_PROP_BP_TREE,
    STAGE_PROP_REGISTRY_SCRIPT,
    STAGE_PROP_RP_TREES,
    assembleStageProp,
    pluginSlug,
    rewritePluginJsForAddon,
    serializeStagePropCatalog,
    validatePluginAssembly,
    type PbePluginArchive,
    type StagePropRegistration,
} from "@piano/vfx/package";
import {
    LEGACY_MIDI_TREE,
    SCORE_PACK_SCRIPT_PATH,
    TIMBRES_SCRIPT_PATH,
    scoreStandPath,
    serializeScorePackModule,
    templateMidiTree,
} from "./template.js";
import type {
    AssemblyOptions,
    AssemblyResult,
    AssemblyScoreEntry,
    AssemblySongEntry,
    TemplateInfo,
    TimbreExportSelection,
} from "./types.js";

const HOST_PARTICLE_SET = new Set(HOST_PARTICLE_IDS);
const HOST_TEXTURE_SET = new Set(HOST_TEXTURES);
const VFX_ASSET_INDEX = "scripts/vfx/pluginAssets.json";
const DEPLOYMENT_INFO_SCRIPT = "scripts/vfx/deploymentInfo.js";

function computeConfigHash(
    plugins: readonly PbePluginArchive[] | undefined,
    timbres: TimbreExportSelection | undefined,
    embedSongs: boolean,
): string {
    const pluginSpecs = (plugins ?? [])
        .map((archive) => `${archive.manifest.id}@${archive.manifest.version}:${crc32Hex(archive.bytes)}`)
        .sort();
    const timbreSpecs = timbres ? [...timbres.enabledIds].sort() : [];
    const payload = JSON.stringify({
        plugins: pluginSpecs,
        timbres: timbreSpecs,
        embedSongs,
    });
    return crc32Hex(encodeUtf8(payload)).padStart(8, "0");
}

function collectPluginSongs(plugins: readonly PbePluginArchive[]): AssemblySongEntry[] {
    const entries: AssemblySongEntry[] = [];
    for (const archive of plugins) {
        const pluginLibs = archive.libraries
            .filter((lib) => lib.songs.length > 0)
            .reduce((map, lib) => {
                for (const songId of lib.songs) {
                    const list = map.get(songId) ?? [];
                    list.push(lib.id);
                    map.set(songId, list);
                }
                return map;
            }, new Map<string, string[]>());

        for (const song of archive.songs.values()) {
            const perfs = archive.performances
                .filter((p) => p.songId === song.id || p.musicFingerprint === song.musicFingerprint)
                .map((p) => ({
                    id: p.id,
                    name: p.name,
                    ...(p.author ? { author: p.author } : {}),
                    songId: song.id,
                    cues: p.cues,
                    requiredEffects: p.requiredEffects,
                    origin: { kind: "plugin" as const, id: archive.manifest.id, name: archive.manifest.name },
                }));
            const libs = pluginLibs.get(song.id);
            entries.push({
                id: song.id,
                name: song.name,
                duration: song.duration,
                noteCount: song.noteCount,
                bytes: song.bytes.length,
                musicFingerprint: song.musicFingerprint,
                isOriginal: false,
                data: song.bytes,
                origin: { kind: "plugin", id: archive.manifest.id, name: archive.manifest.name },
                ...(libs?.length ? { libraries: libs } : {}),
                ...(perfs.length ? { performanceEntries: perfs } : {}),
            });
        }
    }
    return entries;
}

/**
 * 统一核心装配器（供浏览器 Studio 本地模式与 Node/Bun Server 模式共同调用）。
 */
export function assembleAddonTemplate(
    info: TemplateInfo,
    songs: readonly AssemblySongEntry[],
    opts: AssemblyOptions = {},
): AssemblyResult {
    const { bpPath, rpPath } = info;
    const addon = new AddonTemplate(info.addon.sourceName, info.addon.entries(), info.addon.packs);
    const embedSongs = opts.embedSongs ?? true;

    if (
        (songs.some((song) => song.performances?.length || song.performanceEntries?.length) ||
            opts.plugins?.some((plugin) => plugin.manifest.dependencies?.length)) &&
        !addon.readTextSync(bpPath + "scripts/vfx/host.js")?.includes("orderVfxPlugins")
    ) {
        throw new Error("导出附加编排或带依赖的插件需要新版 PianoBE 模板");
    }

    const { identity } = addon.updateIdentity(
        {
            name: opts.name ?? info.bpManifest.header?.name ?? "PianoBE",
            description: opts.desc ?? info.bpManifest.header?.description ?? "",
            resourceName: `${opts.name ?? info.bpManifest.header?.name ?? "PianoBE"} (RP)`,
            randomizeUuids: opts.randomUuid ?? false,
        },
        { indent: 4 },
    );

    const scorePackModule = `${bpPath}${SCORE_PACK_SCRIPT_PATH}`;
    const resourcePackId = identity.resourcePack?.headerUuid;
    if (opts.scores && opts.scores.length > 0 && resourcePackId) {
        applyScores(addon, bpPath, rpPath, opts.scores, resourcePackId);
    } else if (resourcePackId && addon.has(scorePackModule)) {
        const existing = addon.readTextSync(scorePackModule) ?? "";
        const idPattern = /(SCORE_RESOURCE_PACK_ID\s*=\s*)([^;]+)/;
        const updated = idPattern.test(existing)
            ? existing.replace(idPattern, `$1${JSON.stringify(resourcePackId)}`)
            : `export const SCORE_RESOURCE_PACK_ID = ${JSON.stringify(resourcePackId)};\n`;
        addon.writeText(scorePackModule, updated);
    }

    const midisDir = templateMidiTree(addon, bpPath);
    addon.removeTree(bpPath + LEGACY_MIDI_TREE);
    addon.removeTree(midisDir);

    if (embedSongs) {
        const pluginSongs = opts.plugins?.length ? collectPluginSongs(opts.plugins) : [];
        const mergedSongs = pluginSongs.length
            ? mergeSongCatalog(songs, pluginSongs, { reidentifyOnIdConflict: true }).songs
            : [...songs];

        for (const entry of mergedSongs) {
            const content = entry.data
                ? songToAddonModule(entry.data)
                : (entry.moduleText ?? "");
            addon.writeText(`${midisDir}${entry.id}.js`, content);
        }
        addon.writeText(
            `${midisDir}index.js`,
            metasToAddonIndex(
                mergedSongs.map((s) => {
                    const embeddedPerf = s.data ? readSongHeader(s.data).performance : undefined;
                    const perfEntries = s.performanceEntries?.length
                        ? s.performanceEntries
                        : undefined;
                    const extraPerfs = s.performances?.length
                        ? s.performances
                        : perfEntries
                          ? perfEntries
                                .filter((p) => p.cues?.length && p.cues !== embeddedPerf)
                                .map((p) => p.cues!)
                          : undefined;
                    return {
                        id: s.id,
                        name: s.name,
                        duration: s.duration,
                        noteCount: s.noteCount,
                        bytes: s.data?.length,
                        ...(s.libraries?.length ? { libraries: s.libraries } : {}),
                        ...(perfEntries?.length ? { performanceEntries: perfEntries } : {}),
                        ...(extraPerfs?.length ? { performances: extraPerfs } : {}),
                    };
                }),
            ),
        );
    } else {
        addon.writeText(`${midisDir}index.js`, "export const midis=[];\n");
    }

    if (opts.timbres) applyTimbres(addon, bpPath, rpPath, opts.timbres);

    let installedPlugins: string[] = [];
    if (opts.plugins !== undefined) {
        installedPlugins = applyVfxPlugins(addon, bpPath, rpPath, opts.plugins);
    }

    const configHash = computeConfigHash(opts.plugins, opts.timbres, embedSongs);
    addon.writeText(
        `${bpPath}${DEPLOYMENT_INFO_SCRIPT}`,
        `export const DEPLOYMENT_INFO = ${JSON.stringify({
            configHash,
            deployedAt: Date.now(),
            plugins: installedPlugins,
        })};\n`,
    );

    return {
        addon,
        bpPath,
        rpPath,
        installedPlugins,
        configHash,
        resourcePackId,
    };
}

export async function assembleAddonBytes(
    info: TemplateInfo,
    songs: readonly AssemblySongEntry[],
    opts: AssemblyOptions = {},
): Promise<Uint8Array> {
    const { addon } = assembleAddonTemplate(info, songs, opts);
    return addon.toBytes();
}

export async function assembleAddonBlob(
    info: TemplateInfo,
    songs: readonly AssemblySongEntry[],
    opts: AssemblyOptions = {},
): Promise<Blob> {
    const { addon } = assembleAddonTemplate(info, songs, opts);
    return addon.toBlob();
}

export function extractPackFiles(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
): { bpFiles: Map<string, Uint8Array>; rpFiles: Map<string, Uint8Array> } {
    const bpFiles = new Map<string, Uint8Array>();
    const rpFiles = new Map<string, Uint8Array>();
    for (const entry of addon.entries()) {
        const data = addon.readSync(entry.path);
        if (!data) continue;
        if (entry.path.startsWith(bpPath)) {
            bpFiles.set(entry.path.slice(bpPath.length), data.bytes);
        } else if (entry.path.startsWith(rpPath)) {
            rpFiles.set(entry.path.slice(rpPath.length), data.bytes);
        }
    }
    return { bpFiles, rpFiles };
}

function applyTimbres(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
    selection: TimbreExportSelection,
) {
    const soundRoot = `${rpPath}sounds/`;
    const definitionsPath = `${soundRoot}sound_definitions.json`;
    const definitionsText = addon.readTextSync(definitionsPath);
    const definitions = definitionsText
        ? JSON.parse(definitionsText)
        : { format_version: "1.26.0", sound_definitions: {} };
    definitions.sound_definitions ??= {};

    const optionalDirs = new Set<string>();
    for (const timbre of selection.all) {
        if (timbre.id === "piano") continue;
        for (const dir of Object.values(timbre.dirs)) {
            optionalDirs.add(dir);
            optionalDirs.add(`${dir}_stereo`);
            addon.removeTree(`${soundRoot}${dir}/`);
        }
    }
    for (const key of Object.keys(definitions.sound_definitions)) {
        if (optionalDirs.has(key.split(".")[0])) delete definitions.sound_definitions[key];
    }

    for (const pack of selection.selected) {
        for (const [path, data] of pack.files) {
            if (path.startsWith("sounds/")) addon.write(`${rpPath}${path}`, data);
        }
        Object.assign(definitions.sound_definitions, pack.soundDefinitions);
    }

    addon.writeText(definitionsPath, `${JSON.stringify(definitions, null, 4)}\n`);
    const enabled = [...new Set(["piano", ...selection.enabledIds])];
    const timbresModule = `${bpPath}${TIMBRES_SCRIPT_PATH}`;
    if (!addon.has(timbresModule)) {
        console.warn(`[assembly] 模板缺少 ${timbresModule}，音色勾选可能无法在游戏内生效`);
    }
    addon.writeText(
        timbresModule,
        `export const ENABLED_PIANO_TIMBRES = ${JSON.stringify(enabled)};\n`,
    );
}

function applyScores(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
    scores: readonly AssemblyScoreEntry[],
    resourcePackId: string,
) {
    const uiRoot = `${rpPath}textures/ui/piano_score/`;
    const standRoot = `${rpPath}textures/entity/piano_score/`;

    const planned = scores.map((score) => {
        const files = new Map<string, Uint8Array>();
        for (const page of score.pages) {
            const bytes = score.assets?.get(page) ?? addon.readSync(`${rpPath}${page}`)?.bytes;
            if (bytes) files.set(page, bytes);
            else console.warn(`[assembly] 曲谱 ${score.id} 缺少页面纹理：${page}`);
        }
        const stand = scoreStandPath(score.id);
        const standBytes = score.assets?.get(stand) ?? addon.readSync(`${rpPath}${stand}`)?.bytes;
        if (standBytes) files.set(stand, standBytes);
        else console.warn(`[assembly] 曲谱 ${score.id} 缺少谱架纹理：${stand}`);
        return files;
    });

    addon.removeTree(uiRoot);
    addon.removeTree(standRoot);
    for (const files of planned) {
        for (const [path, bytes] of files) addon.write(`${rpPath}${path}`, bytes);
    }

    addon.writeText(`${bpPath}${SCORE_PACK_SCRIPT_PATH}`, serializeScorePackModule(scores, resourcePackId));

    const firstId = scores[0].id;
    updateRpEntityTextures(addon, rpPath, firstId, scores.map((score) => score.id));
    updateRpRenderController(addon, rpPath, scores.length);
    updateBpScoreVariant(addon, bpPath, scores.length);
}

function updateRpEntityTextures(
    addon: AddonTemplate,
    rpPath: string,
    firstId: string,
    ids: readonly string[],
) {
    const path = `${rpPath}entity/grand_score.entity.json`;
    const text = addon.readTextSync(path);
    if (!text) return;
    const json = JSON.parse(text) as { "minecraft:client_entity"?: { description?: { textures?: Record<string, unknown> } } };
    const description = json["minecraft:client_entity"]?.description;
    if (!description) return;
    const textures: Record<string, string> = {
        default: `textures/entity/piano_score/${firstId}`,
    };
    ids.forEach((id, index) => {
        textures[`score_${index}`] = `textures/entity/piano_score/${id}`;
    });
    description.textures = textures;
    addon.writeText(path, `${JSON.stringify(json, null, 4)}\n`);
}

function updateRpRenderController(addon: AddonTemplate, rpPath: string, count: number) {
    const path = `${rpPath}render_controllers/grand_score.render_controllers.json`;
    const text = addon.readTextSync(path);
    if (!text) return;
    const json = JSON.parse(text) as {
        render_controllers?: Record<string, { arrays?: { textures?: Record<string, unknown> }; textures?: unknown }>;
    };
    const controller = json.render_controllers?.["controller.render.pbe.grand_score"];
    if (!controller) return;
    controller.arrays ??= {};
    controller.arrays.textures ??= {};
    controller.arrays.textures["Array.scores"] = Array.from(
        { length: count },
        (_, index) => `Texture.score_${index}`,
    );
    controller.textures = ["Array.scores[q.property('pbe:score_variant')]"];
    addon.writeText(path, `${JSON.stringify(json, null, 4)}\n`);
}

function updateBpScoreVariant(addon: AddonTemplate, bpPath: string, count: number) {
    const path = `${bpPath}entities/grand_score.json`;
    const text = addon.readTextSync(path);
    if (!text) return;
    const json = JSON.parse(text) as {
        "minecraft:entity"?: { description?: { properties?: Record<string, unknown> } };
    };
    const description = json["minecraft:entity"]?.description;
    if (!description) return;
    description.properties ??= {};
    description.properties["pbe:score_variant"] = {
        type: "int",
        range: [0, Math.max(1, count - 1)],
        default: 0,
        client_sync: true,
    };
    addon.writeText(path, `${JSON.stringify(json, null, 4)}\n`);
}

function isHostParticleAsset(fileName: string): boolean {
    const match = fileName.match(/^pbe_vfx_(.+)\.particle\.json$/);
    return match ? HOST_PARTICLE_SET.has(match[1]) : false;
}

function isHostParticleTexture(relPath: string): boolean {
    const stem = relPath.replace(/(?:_mer|_normal)?\.(?:png|tga|texture_set\.json)$/i, "");
    return HOST_TEXTURE_SET.has(stem);
}

function stripExistingVfxPlugins(addon: AddonTemplate, bpPath: string, rpPath: string) {
    addon.removeTree(`${bpPath}scripts/plugins/`);
    addon.removeTree(bpPath + STAGE_PROP_BP_TREE);
    for (const tree of STAGE_PROP_RP_TREES) addon.removeTree(rpPath + tree);

    const previousExtras: unknown = JSON.parse(addon.readTextSync(bpPath + VFX_ASSET_INDEX) ?? "[]");
    if (Array.isArray(previousExtras)) {
        for (const path of previousExtras) {
            if (
                typeof path === "string" &&
                /^textures\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:png|tga|texture_set\.json)$/i.test(path) &&
                !path.split("/").some((part) => part === "." || part === "..") &&
                !isHostParticleTexture(path)
            ) {
                addon.remove(rpPath + path);
            }
        }
    }

    const particlesPrefix = `${rpPath}particles/`;
    const particleTexturesPrefix = `${rpPath}textures/particle/`;
    for (const entry of addon.entries()) {
        if (entry.path.startsWith(particlesPrefix)) {
            const name = entry.path.slice(particlesPrefix.length);
            if (!isHostParticleAsset(name)) addon.remove(entry.path);
        } else if (entry.path.startsWith(particleTexturesPrefix)) {
            const relPath = entry.path.slice(rpPath.length);
            if (!isHostParticleTexture(relPath)) addon.remove(entry.path);
        }
    }
}

function serializeVfxPluginsLoaderModule(
    entries: readonly { manifest: VfxPluginManifest; slug: string; hasJs: boolean }[],
): string {
    const jsEntries = entries.filter((entry) => entry.hasJs);
    const installed = JSON.stringify(entries.map(({ manifest }) => manifest.id));
    if (jsEntries.length === 0) {
        return `export const INSTALLED_VFX_PLUGINS = ${installed};\nexport function registerVfxPlugins() {}\n`;
    }
    const imports = [
        `import { registerVfxPlugin, vfxRegistry } from "./host.js";`,
        ...jsEntries.map((entry, index) => `import plugin_${index} from "../plugins/${entry.slug}/vfx/index.js";`),
    ];
    const refs = jsEntries.map(({ manifest }, index) => `    [plugin_${index}, ${JSON.stringify(manifest)}],`);
    return [
        ...imports,
        "",
        "const ASSEMBLED_PLUGINS = [",
        ...refs,
        "];",
        "",
        `export const INSTALLED_VFX_PLUGINS = ${installed};`,
        "",
        "let registered = false;",
        "export function registerVfxPlugins() {",
        "    if (registered) return;",
        "    registered = true;",
        "    for (const [plugin, manifest] of ASSEMBLED_PLUGINS) {",
        "        const pluginId = manifest.id;",
        "        if (vfxRegistry.hasPlugin(pluginId)) continue;",
        "        try {",
        "            registerVfxPlugin({ manifest, register: api => plugin.register(api) }, vfxRegistry);",
        "        } catch (error) {",
        "            console.warn(`[piano-vfx] 注册插件 ${pluginId} 失败`, error);",
        "        }",
        "    }",
        "}",
        "",
    ].join("\n");
}

function applyVfxPlugins(
    addon: AddonTemplate,
    bpPath: string,
    rpPath: string,
    plugins: readonly PbePluginArchive[],
): string[] {
    const orderedPlugins = validatePluginAssembly(plugins);
    const catalogPath = bpPath + STAGE_PROP_REGISTRY_SCRIPT;
    const hasCatalog = addon.has(catalogPath);
    if (!hasCatalog && plugins.some((plugin) => plugin.stageProps.length)) {
        throw new Error("当前模板不支持插件舞台道具，请使用新版 PianoBE 模板");
    }
    stripExistingVfxPlugins(addon, bpPath, rpPath);

    const loaderEntries: { manifest: VfxPluginManifest; slug: string; hasJs: boolean }[] = [];
    const writtenRpPaths: string[] = [];
    const catalog: StagePropRegistration[] = [];

    const occupied = new Set(addon.entries().map((entry) => entry.path.toLowerCase()));
    for (const archive of orderedPlugins) {
        const { manifest } = archive;
        const slug = pluginSlug(manifest.id);

        const hasJs = Boolean(archive.vfxEntryJs?.trim());
        for (const [path, content] of archive.files) {
            if (!path.startsWith("vfx/") || !path.endsWith(".js")) continue;
            const host = `${"../".repeat(path.split("/").length + 1)}vfx/host.js`;
            const source = new TextDecoder().decode(content);
            const rewritten = rewritePluginJsForAddon(source, host);
            if (rewritten.includes(host.replace(/host\.js$/, "core.js")) && !addon.has(bpPath + "scripts/vfx/core.js")) {
                throw new Error(`插件 ${manifest.id} 使用 @piano/core，需要新版 PianoBE 模板`);
            }
            addon.writeText(`${bpPath}scripts/plugins/${slug}/${path}`, rewritten);
        }

        for (const [relPath, bytes] of [...archive.particles, ...archive.textures]) {
            const fullPath = `${rpPath}${relPath}`;
            if (occupied.has(fullPath.toLowerCase())) throw new Error(`插件 ${manifest.id} 试图覆盖模板资源：${relPath}`);
            addon.write(fullPath, bytes);
            if (relPath.startsWith("textures/")) writtenRpPaths.push(relPath);
        }

        for (const prop of archive.stageProps) {
            const { bp, rp } = assembleStageProp(prop, (path) => archive.files.get(path)!);
            for (const [pack, files] of [[bpPath, bp], [rpPath, rp]] as const) {
                for (const [path, content] of files) {
                    const target = pack + path;
                    if (addon.has(target)) throw new Error(`[assembly] 舞台道具资源冲突：${target}`);
                    if (typeof content === "string") addon.writeText(target, content);
                    else addon.write(target, content);
                }
            }
            catalog.push(prop.registration);
        }

        loaderEntries.push({ manifest, slug, hasJs });
    }

    addon.writeText(bpPath + VFX_ASSET_INDEX, JSON.stringify(writtenRpPaths));
    if (hasCatalog) addon.writeText(catalogPath, serializeStagePropCatalog(catalog));
    addon.writeText(`${bpPath}scripts/vfx/plugins.js`, serializeVfxPluginsLoaderModule(loaderEntries));
    return orderedPlugins.map((p) => p.manifest.id);
}
