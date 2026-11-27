import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { encodeSong } from "@piano/core";
import { readPbePluginArchive, writePbePluginArchive } from "@piano/vfx/package";
import {
    assembleAddonBytes,
    assembleAddonTemplate,
    checkPluginUninstall,
    computePluginDeployStatus,
    extractPackFiles,
    loadAddonTemplate,
    packLibraryAsPlugin,
    resolvePluginDependencies,
} from "../src/index";

const root = join(import.meta.dir, "..", "..", "..");
const templatePath = join(root, "packages/addon/dist/template.mcaddon");

describe("@piano/assembly", () => {
    test("packLibraryAsPlugin packs songs and performances into a valid .pbeplugin", () => {
        const songBytes = encodeSong({
            id: "abcd1234",
            name: "测试曲",
            duration: 160,
            tracks: [{ instrument: { family: "piano", number: 0, name: "Piano" }, notes: [60, 0, 40, 100] }],
        });
        const { bytes, manifest } = packLibraryAsPlugin({
            name: "流行精选",
            description: "用户导出合集",
            author: "Tester",
            songs: [
                {
                    id: "abcd1234",
                    name: "测试曲",
                    bytes: songBytes,
                    performances: [
                        {
                            id: "user.pop:show1",
                            name: "星尘夜",
                            cues: [{ tick: 0, op: "set", effect: "starfield", color: "#8EB8FF", level: 80, scale: 100, fade: 20 }],
                        },
                    ],
                },
            ],
        });

        expect(manifest.capabilities).toEqual(["libraries", "songs", "performances"]);
        const archive = readPbePluginArchive(bytes);
        expect(archive.hasExecutableCode).toBe(false);
        expect(archive.songs.size).toBe(1);
        expect(archive.performances).toHaveLength(1);
        expect(archive.libraries).toHaveLength(1);
        expect(archive.libraries[0].name).toBe("流行精选");
    });

    test("accepts digit-leading song IDs and namespaced performance IDs in manifest", () => {
        const songBytes = encodeSong({
            id: "28a2cb50",
            name: "数字开头ID曲目",
            duration: 160,
            tracks: [{ instrument: { family: "piano", number: 0, name: "Piano" }, notes: [60, 0, 40, 100] }],
        });
        const { bytes } = packLibraryAsPlugin({
            pluginId: "pianobe.pack.featured",
            libraryId: "official:featured",
            name: "官方精选",
            songs: [
                {
                    id: "28a2cb50",
                    name: "数字开头ID曲目",
                    bytes: songBytes,
                    performances: [
                        {
                            id: "pianobe.pack.featured:28a2cb50",
                            name: "罪人的终幕",
                            cues: [{ tick: 0, op: "set", effect: "starfield", color: "#8EB8FF", level: 80, scale: 100, fade: 20 }],
                        },
                    ],
                },
            ],
        });
        const archive = readPbePluginArchive(bytes);
        expect(archive.songs.has("28a2cb50")).toBe(true);
        expect(archive.performances[0].id).toBe("pianobe.pack.featured:28a2cb50");
        expect(archive.libraries[0].id).toBe("official:featured");
    });

    test("dependency resolution & uninstall guard protect active dependents", () => {
        const plugins = [
            {
                id: "pianobe.atmosphere",
                manifest: {
                    id: "pianobe.atmosphere",
                    name: "Atmosphere",
                    version: "1.0.0",
                    apiVersion: "1.0.0",
                    minPianoBeVersion: "1.3.0",
                    capabilities: ["vfx" as const],
                    author: "PianoBE",
                    license: "MIT",
                    provides: { effects: ["starfield"] },
                },
                trusted: true,
                compatible: true,
            },
            {
                id: "pianobe.themes",
                manifest: {
                    id: "pianobe.themes",
                    name: "Themes",
                    version: "1.0.0",
                    apiVersion: "1.0.0",
                    minPianoBeVersion: "1.3.0",
                    capabilities: ["vfx" as const],
                    dependencies: ["pianobe.atmosphere"],
                    author: "PianoBE",
                    license: "MIT",
                    provides: { themes: ["galaxy"] },
                },
                trusted: true,
                compatible: true,
            },
        ];

        const resolved = resolvePluginDependencies(["pianobe.themes"], plugins);
        expect(resolved.resolvedIds).toEqual(["pianobe.atmosphere", "pianobe.themes"]);
        expect(resolved.missingDependencies).toEqual([]);

        const uninstallBlocked = checkPluginUninstall("pianobe.atmosphere", plugins);
        expect(uninstallBlocked.ok).toBe(false);
        expect(checkPluginUninstall("pianobe.themes", plugins).ok).toBe(true);

        expect(
            computePluginDeployStatus({
                enabled: true,
                trusted: true,
                compatible: true,
                requiresPackDeploy: true,
                deployedPluginIds: [],
                loadedPluginIds: [],
                pluginId: "pianobe.atmosphere",
            }),
        ).toBe("pending_deploy");

        expect(
            computePluginDeployStatus({
                enabled: true,
                trusted: true,
                compatible: true,
                requiresPackDeploy: true,
                deployedPluginIds: ["pianobe.atmosphere"],
                loadedPluginIds: [],
                pluginId: "pianobe.atmosphere",
            }),
        ).toBe("pending_restart");

        expect(
            computePluginDeployStatus({
                enabled: true,
                trusted: true,
                compatible: true,
                requiresPackDeploy: false,
                deployedPluginIds: [],
                loadedPluginIds: [],
                pluginId: "user.pure_lib",
            }),
        ).toBe("active");
    });

    test("[artifact] assembleAddonTemplate supports embedSongs=false and pure-song plugin embedding", async () => {
        const rawTpl = new Uint8Array(readFileSync(templatePath));
        const tplBytes = zipSync(unzipSync(rawTpl), { level: 0 });
        const info = await loadAddonTemplate(tplBytes);

        const songBytes = encodeSong({
            id: "abcd1234",
            name: "合集歌曲",
            duration: 160,
            tracks: [{ instrument: { family: "piano", number: 0, name: "Piano" }, notes: [60, 0, 40, 100] }],
        });
        const purePlugin = readPbePluginArchive(
            packLibraryAsPlugin({
                name: "内嵌测试曲库",
                songs: [{ id: "abcd1234", name: "合集歌曲", bytes: songBytes }],
            }).bytes,
        );

        // 1. Client mode: embeds plugin songs and referenced libraries automatically
        const outBytes = await assembleAddonBytes(info, [], {
            name: "客户端包",
            plugins: [purePlugin],
            embedSongs: true,
        });
        const reloaded = await loadAddonTemplate(zipSync(unzipSync(outBytes), { level: 0 }));
        expect(reloaded.songs.some((s) => s.id === "abcd1234")).toBe(true);
        const indexJs = reloaded.addon.readTextSync(`${reloaded.bpPath}scripts/packages/addon/src/midis/index.js`) ?? "";
        expect(indexJs).toContain("export const libraries=");
        expect(indexJs).toContain("内嵌测试曲库");

        // 2. Server mode: skips embedded songs and generates deploymentInfo.js
        const serverResult = assembleAddonTemplate(info, [], {
            name: "服务器包",
            plugins: [purePlugin],
            embedSongs: false,
        });
        const { bpFiles, rpFiles } = extractPackFiles(serverResult.addon, serverResult.bpPath, serverResult.rpPath);
        expect(bpFiles.has("scripts/vfx/deploymentInfo.js")).toBe(true);
        expect(bpFiles.has("scripts/packages/addon/src/midis/abcd1234.js")).toBe(false);
        expect(rpFiles.size).toBeGreaterThan(0);

        // 3. Timbre .pbeplugin in opts.plugins writes sounds/, sound_definitions.json, and ENABLED_PIANO_TIMBRES,
        // and re-exporting with plugins: [] strips optional timbres cleanly.
        const oggStub = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
        const timbrePlugin = readPbePluginArchive(
            writePbePluginArchive({
                "plugin.json": JSON.stringify({
                    id: "pianobe.timbre.classic_grand",
                    name: "经典三角钢琴",
                    version: "1.0.0",
                    apiVersion: "1.0.0",
                    minPianoBeVersion: "1.3.0",
                    capabilities: ["audio.timbres"],
                    visibility: "public",
                    author: "PianoBE",
                    license: "CC0-1.0",
                    provides: { timbres: ["classic_grand"] },
                }),
                "timbres/classic_grand.json": JSON.stringify({
                    id: "classic_grand",
                    value: 1,
                    label: "经典三角",
                    dirs: { v1: "classic_grand_v1" },
                    notes: ["C4"],
                    layers: ["v1"],
                    soundDefinitions: {
                        "classic_grand_v1.C4": {
                            category: "record",
                            sounds: [{ name: "sounds/classic_grand_v1/C4", is3D: true }],
                            min_distance: 8,
                            max_distance: 32,
                        },
                    },
                }),
                "sounds/classic_grand_v1/C4.ogg": oggStub,
            }),
        );
        const withTimbreBytes = await assembleAddonBytes(info, [], {
            name: "音色插件装配测试",
            plugins: [timbrePlugin],
            embedSongs: false,
        });
        const withTimbreTpl = await loadAddonTemplate(zipSync(unzipSync(withTimbreBytes), { level: 0 }));
        expect(withTimbreTpl.addon.has(`${withTimbreTpl.rpPath}sounds/classic_grand_v1/C4.ogg`)).toBe(true);
        const timbresJs = withTimbreTpl.addon.readTextSync(`${withTimbreTpl.bpPath}scripts/packages/addon/src/domain/piano/timbres.js`) ?? "";
        expect(timbresJs).toContain('"piano"');
        expect(timbresJs).toContain('"classic_grand"');
        const defsText = withTimbreTpl.addon.readTextSync(`${withTimbreTpl.rpPath}sounds/sound_definitions.json`) ?? "";
        expect(defsText).toContain("classic_grand_v1.C4");
        expect(defsText).toContain('"min_distance": 8.0');

        const strippedBytes = await assembleAddonBytes(withTimbreTpl, [], {
            name: "清空音色测试",
            plugins: [],
            embedSongs: false,
        });
        const strippedTpl = await loadAddonTemplate(zipSync(unzipSync(strippedBytes), { level: 0 }));
        expect(strippedTpl.addon.has(`${strippedTpl.rpPath}sounds/classic_grand_v1/C4.ogg`)).toBe(false);
        const strippedJs = strippedTpl.addon.readTextSync(`${strippedTpl.bpPath}scripts/packages/addon/src/domain/piano/timbres.js`) ?? "";
        expect(strippedJs).toContain('["piano"]');
        expect(strippedJs).not.toContain("classic_grand");
    }, 30000);

    /**
     * 回归：本地构建/零曲库装配时生成器曾省略 `export const libraries`，
     * 而编译产物里的 midiManager.js 是 `import { libraries, midis } from ".../index.js"`，
     * 导致游戏内 QuickJS 在模块链接阶段报"未导出"。
     */
    test("[artifact] zero-library assembly still exports libraries for the compiled named import", async () => {
        const info = await loadAddonTemplate(new Uint8Array(readFileSync(templatePath)));
        const bytes = await assembleAddonBytes(info, [], {
            name: "零曲库装配",
            plugins: [],
            embedSongs: true,
        });
        const reloaded = await loadAddonTemplate(zipSync(unzipSync(bytes), { level: 0 }));
        const indexJs = reloaded.addon.readTextSync(`${reloaded.bpPath}scripts/packages/addon/src/midis/index.js`) ?? "";

        expect(indexJs).toContain("export const midis=");
        expect(indexJs).toContain("export const libraries=[];");
        expect(reloaded.addon.readTextSync(`${reloaded.bpPath}scripts/midiManager.js`) ?? "")
            .toContain('import { libraries, midis }');
    }, 30000);
});
