import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { encodeSong } from "@piano/core";
import { readPbePluginArchive } from "@piano/vfx/package";
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
const bareTemplatePath = join(root, "packages/addon/dist/template-bare.mcaddon");

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

    test("assembleAddonTemplate supports embedSongs=false and pure-song plugin embedding", async () => {
        if (!existsSync(bareTemplatePath)) return;
        const rawTpl = new Uint8Array(readFileSync(bareTemplatePath));
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

        // 1. Client mode: embeds plugin songs automatically
        const outBytes = await assembleAddonBytes(info, [], {
            name: "客户端包",
            plugins: [purePlugin],
            embedSongs: true,
        });
        const reloaded = await loadAddonTemplate(zipSync(unzipSync(outBytes), { level: 0 }));
        expect(reloaded.songs.some((s) => s.id === "abcd1234")).toBe(true);

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
    }, 30000);
});
