import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    attachSongPerformance,
    encodeSong,
    reidentifySong,
    renameSong,
    type MidiSong,
    type PerformanceCue,
} from "@piano/core";
import { readPbePluginArchive, writePbePluginArchive } from "@piano/vfx/package";
import { packLibraryAsPlugin } from "@piano/assembly";
import { openDb } from "../src/db";
import { createApp, type AppDeps } from "../src/app";
import { createToken, ensureBootstrapToken } from "../src/auth";
import { SqliteSongPort } from "../src/drivers/sqlitePorts";
import { loadConfig } from "../src/config";
import { PluginService } from "../src/services/plugins";
import { DeploymentService } from "../src/services/deployment";

function makeSong(id: string, name: string, pitchOffset = 0): MidiSong {
    return {
        id,
        name,
        duration: 160,
        tracks: [
            {
                instrument: { family: "piano", number: 0, name: "Acoustic Grand Piano" },
                notes: [
                    60 + pitchOffset, 0, 40, 100,
                    64 + pitchOffset, 20, 40, 95,
                    67 + pitchOffset, 40, 40, 90,
                ],
            },
        ],
    };
}

const CUE_STAR: readonly PerformanceCue[] = [
    { tick: 0, op: "set", effect: "starfield", color: "#8EB8FF", level: 80, scale: 100, fade: 20 },
];

const ADMIN = "studio-admin-token";
let deps: AppDeps;
let app: ReturnType<typeof createApp>;
let writerToken = "";
let tempRoot = "";
let pluginsDir = "";
let dataDir = "";
let bdsDir = "";
let mockRegistryServer: ReturnType<typeof Bun.serve> | undefined;
let remoteSongId = "";

function req(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    const { token: _t, ...rest } = init;
    return app.request(path, { ...rest, headers });
}

beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "piano-studio-api-"));
    pluginsDir = join(tempRoot, "custom-root", "plugins");
    dataDir = join(tempRoot, "isolated-data");
    bdsDir = join(tempRoot, "bds");
    mkdirSync(join(bdsDir, "worlds", "MyWorld"), { recursive: true });
    writeFileSync(join(bdsDir, "server.properties"), "level-name=MyWorld\n");
    writeFileSync(
        join(bdsDir, "worlds", "MyWorld", "world_behavior_packs.json"),
        JSON.stringify([{ pack_id: "unrelated-pack-1", version: [1, 0, 0] }]),
    );

    const remoteSongBytes = encodeSong(makeSong("ff123456", "远程歌单曲", 3));
    remoteSongId = "ff123456";
    const { manifest: remoteManifest, bytes: remoteBytes } = packLibraryAsPlugin({
        pluginId: "official.remote_pack",
        libraryId: "official:remote",
        name: "远程官方曲包",
        songs: [{ id: remoteSongId, name: "远程歌单曲", bytes: remoteSongBytes }],
    });
    const registryIndex = [
        {
            id: remoteManifest.id,
            manifest: remoteManifest,
            size: remoteBytes.byteLength,
            file: "official.remote_pack.pbeplugin",
            hasExecutableCode: false,
            contents: {
                songs: 1,
                performances: 0,
                libraries: 1,
                timbres: 0,
                effects: 0,
                themes: 0,
                keyStyles: 0,
                particles: 0,
                stageProps: 0,
            },
        },
    ];
    mockRegistryServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === "/plugins/index.json") {
                return Response.json(registryIndex);
            }
            if (url.pathname === "/plugins/official.remote_pack.pbeplugin") {
                return new Response(Uint8Array.from(remoteBytes), {
                    headers: { "content-type": "application/octet-stream" },
                });
            }
            return new Response("Not Found", { status: 404 });
        },
    });

    const db = openDb(":memory:");
    ensureBootstrapToken(db, ADMIN);
    const songPort = new SqliteSongPort(db);
    const config = loadConfig({
        PIANOBE_HOME: tempRoot,
        DATA_DIR: dataDir,
        PLUGINS_DIR: pluginsDir,
        PLUGIN_REGISTRY_URL: `http://127.0.0.1:${mockRegistryServer.port}/plugins/index.json`,
        BDS_DIR: bdsDir,
        BDS_WORLD: "MyWorld",
    });
    const pluginService = new PluginService(songPort, config);
    const deploymentService = new DeploymentService(songPort, pluginService, config);
    deps = { db, songPort, config, pluginService, deploymentService };
    app = createApp(deps);
    writerToken = createToken(db, "studio-writer", "admin").token;
});

afterAll(() => {
    mockRegistryServer?.stop(true);
    deps.db.close();
    rmSync(tempRoot, { recursive: true, force: true });
});

describe("PianoBE Server Studio API：PBE3、曲库、插件与 BDS 部署", () => {
    test("PBE3 上传按音乐指纹合并，同 ID 不同内容返回 409", async () => {
        const base = encodeSong(makeSong("aa112233", "青花瓷"));
        const res1 = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            headers: { "X-File-Name": encodeURIComponent("青花瓷.pbe3") },
            body: base,
        });
        expect(res1.status).toBe(201);

        // 改名、改 ID、附加演出但音乐相同 -> 合并到同一首歌曲
        const variant = attachSongPerformance(renameSong(reidentifySong(base, "bb445566"), "Blue Porcelain"), CUE_STAR);
        const res2 = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            headers: { "X-File-Name": encodeURIComponent("Blue Porcelain.pbe3") },
            body: variant,
        });
        expect(res2.status).toBe(201);
        const merged = (await res2.json()) as { id: string; aliases?: string[]; performanceEntries?: unknown[] };
        expect(merged.id).toBe("aa112233");
        expect(merged.aliases).toContain("Blue Porcelain");
        expect(merged.performanceEntries).toHaveLength(1);

        // 相同 ID 但不同音乐内容 -> 409
        const conflictBytes = encodeSong(makeSong("aa112233", "青花瓷（完全不同）", 5));
        const resConflict = await req("/api/songs", {
            token: writerToken,
            method: "POST",
            headers: { "X-File-Name": encodeURIComponent("冲突.pbe3") },
            body: conflictBytes,
        });
        expect(resConflict.status).toBe(409);
    });

    test("曲库 CRUD 与导出为 .pbeplugin", async () => {
        const createRes = await req("/api/libraries", {
            token: writerToken,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "我的国风合集", description: "测试导出", songIds: ["aa112233"] }),
        });
        expect(createRes.status).toBe(201);
        const lib = (await createRes.json()) as { id: string; songIds: string[] };
        expect(lib.songIds).toEqual(["aa112233"]);

        const exportRes = await req(`/api/libraries/${lib.id}/export-plugin`, { token: writerToken });
        expect(exportRes.status).toBe(200);
        const pluginBytes = new Uint8Array(await exportRes.arrayBuffer());
        const archive = readPbePluginArchive(pluginBytes);
        expect(archive.hasExecutableCode).toBe(false);
        expect(archive.songs.has("aa112233")).toBe(true);
        expect(archive.libraries).toHaveLength(1);

        const clearRes = await req(`/api/libraries/${lib.id}/songs`, {
            token: writerToken,
            method: "DELETE",
        });
        expect(clearRes.status).toBe(204);
        const listAfterClear = await req("/api/libraries", { token: writerToken });
        expect(listAfterClear.status).toBe(200);
        const libsJson = (await listAfterClear.json()) as { items: Array<{ id: string; songIds: string[] }> };
        expect(libsJson.items.find((item) => item.id === lib.id)?.songIds).toEqual([]);
    });

    test("纯数据插件免脚本信任直接生效，含脚本插件需信任且卸载受依赖保护", async () => {
        // 1. 纯曲库插件：无需管理员脚本信任，安装即 active
        const pureSong = encodeSong(makeSong("cc778899", "插件歌曲", 7));
        const { bytes: pureBytes } = packLibraryAsPlugin({
            pluginId: "community.pure_songs",
            libraryId: "pure_lib",
            name: "纯曲库插件",
            songs: [{ id: "cc778899", name: "插件歌曲", bytes: pureSong }],
        });

        const pureInstall = await req("/api/plugins", {
            token: ADMIN,
            method: "POST",
            body: pureBytes,
        });
        expect(pureInstall.status).toBe(201);
        const pureBody = (await pureInstall.json()) as {
            trusted: boolean;
            enabled: boolean;
            hasExecutableCode: boolean;
            status: string;
        };
        expect(pureBody.hasExecutableCode).toBe(false);
        expect(pureBody.trusted).toBe(true);
        expect(pureBody.enabled).toBe(true);
        expect(pureBody.status).toBe("active");

        // 歌曲已在服务器曲库中立即可见
        const songGet = await req("/api/songs/cc778899", { token: writerToken });
        expect(songGet.status).toBe(200);

        // 2. 含脚本的第三方 VFX 插件：未信任前 unavailable，信任后 pending_deploy
        const scriptBytes = writePbePluginArchive({
            "plugin.json": JSON.stringify({
                id: "acme.base_fx",
                name: "Acme Base FX",
                version: "1.0.0",
                apiVersion: "1.0.0",
                minPianoBeVersion: "1.3.0",
                capabilities: ["vfx"],
                author: "Acme",
                license: "MIT",
                provides: { effects: ["acme_glow"] },
            }),
            "vfx/index.js": `import { drawPoints } from "@piano/vfx"; export default { manifest: { id: "acme.base_fx" }, register(api) { api.registerEffect({ id: "acme_glow", label: "Glow", category: "accent", trigger: "instant", interval: 0, priority: 5, emit: () => ({ priority: 5, emitters: [drawPoints({ count: 1, life: 1, brush: "star", color: "#FFFFFF", opacity: 1 })] }) }); } };`,
        });
        const scriptInstall = await req("/api/plugins", {
            token: ADMIN,
            method: "POST",
            body: scriptBytes,
        });
        expect(scriptInstall.status).toBe(201);
        const scriptBody = (await scriptInstall.json()) as { trusted: boolean; enabled: boolean; status: string };
        expect(scriptBody.trusted).toBe(false);
        expect(scriptBody.enabled).toBe(false);
        expect(scriptBody.status).toBe("unavailable");

        const trustedRes = await req("/api/plugins/acme.base_fx/trust", {
            token: ADMIN,
            method: "POST",
        });
        expect(trustedRes.status).toBe(200);
        expect(((await trustedRes.json()) as { status: string }).status).toBe("pending_deploy");

        // 3. 依赖保护：安装依赖 acme.base_fx 的子插件后禁止直接卸载父插件
        const childBytes = writePbePluginArchive({
            "plugin.json": JSON.stringify({
                id: "acme.child_fx",
                name: "Acme Child FX",
                version: "1.0.0",
                apiVersion: "1.0.0",
                minPianoBeVersion: "1.3.0",
                capabilities: ["vfx"],
                dependencies: ["acme.base_fx"],
                author: "Acme",
                license: "MIT",
                provides: { effects: ["acme_child"] },
            }),
            "vfx/index.js": `export default { manifest: { id: "acme.child_fx" }, register() {} };`,
        });
        await req("/api/plugins", { token: ADMIN, method: "POST", body: childBytes });
        await req("/api/plugins/acme.child_fx/trust", { token: ADMIN, method: "POST" });

        const blockedUninstall = await req("/api/plugins/acme.base_fx", { token: ADMIN, method: "DELETE" });
        expect(blockedUninstall.status).toBe(409);

        // 先卸载子插件，再卸载父插件
        expect((await req("/api/plugins/acme.child_fx", { token: ADMIN, method: "DELETE" })).status).toBe(204);
        expect((await req("/api/plugins/acme.base_fx", { token: ADMIN, method: "DELETE" })).status).toBe(204);

        // 4. 卸载纯曲库插件前先把歌曲加入用户曲库 -> 歌曲仍保留，未加入的随插件清理
        await req("/api/libraries/default/songs", {
            token: writerToken,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ songIds: ["cc778899"] }),
        });
        expect((await req("/api/plugins/community.pure_songs", { token: ADMIN, method: "DELETE" })).status).toBe(204);
        expect((await req("/api/songs/cc778899", { token: writerToken })).status).toBe(200);

        // 5. 支持下载插件归档（/api/plugins/:id/archive），且重叠曲目的两个曲库插件可按指纹共存合并
        const sharedSong = encodeSong(makeSong("dd112233", "共有歌曲", 9));
        const { bytes: packA } = packLibraryAsPlugin({
            pluginId: "official.pack_a",
            libraryId: "official:a",
            name: "合集 A",
            songs: [{ id: "dd112233", name: "共有歌曲", bytes: sharedSong }],
        });
        const { bytes: packB } = packLibraryAsPlugin({
            pluginId: "official.pack_b",
            libraryId: "official:b",
            name: "合集 B",
            songs: [
                {
                    id: "ee445566",
                    name: "共有歌曲（别名）",
                    bytes: reidentifySong(sharedSong, "ee445566"),
                    performances: [{ id: "official.pack_b:show", name: "独立演出", cues: CUE_STAR }],
                },
            ],
        });
        expect((await req("/api/plugins", { token: ADMIN, method: "POST", body: packA })).status).toBe(201);
        expect((await req("/api/plugins", { token: ADMIN, method: "POST", body: packB })).status).toBe(201);
        const archiveRes = await req("/api/plugins/official.pack_b/archive", { token: writerToken });
        expect(archiveRes.status).toBe(200);
        const fetchedArchive = readPbePluginArchive(new Uint8Array(await archiveRes.arrayBuffer()));
        expect(fetchedArchive.manifest.id).toBe("official.pack_b");
        const perfsRes = await req("/api/songs/dd112233/performances", { token: writerToken });
        expect(perfsRes.status).toBe(200);
        const perfsJson = (await perfsRes.json()) as { items: Array<{ id: string }> };
        expect(perfsJson.items.some((p) => p.id === "official.pack_b:show")).toBe(true);
    });

    test("外置 plugins/ 目录扫描对账：直接放入为未启用、启用/停用同步数据、删除文件自动清理", async () => {
        const dropSong = encodeSong(makeSong("ab998877", "目录投递曲目", 4));
        const { bytes: dropBytes } = packLibraryAsPlugin({
            pluginId: "community.disk_drop",
            libraryId: "disk_lib",
            name: "磁盘投递曲包",
            songs: [{ id: "ab998877", name: "目录投递曲目", bytes: dropSong }],
        });
        const droppedPath = join(pluginsDir, "arbitrary-filename.pbeplugin");
        writeFileSync(droppedPath, dropBytes);

        // 1. 放入目录后：自动发现但默认不启用（规则 B），歌曲尚未进入曲库
        const scanRes = await req("/api/plugins/scan", { token: ADMIN, method: "POST" });
        expect(scanRes.status).toBe(200);
        const scanJson = (await scanRes.json()) as {
            items: Array<{ id: string; source: string; installed: boolean; enabled: boolean }>;
        };
        const found = scanJson.items.find((item) => item.id === "community.disk_drop");
        expect(found).toBeTruthy();
        expect(found?.source).toBe("local");
        expect(found?.installed).toBe(true);
        expect(found?.enabled).toBe(false);
        expect((await req("/api/songs/ab998877", { token: writerToken })).status).toBe(404);

        // 2. 管理员启用后：曲目立即可见
        const enableRes = await req("/api/plugins/community.disk_drop", {
            token: ADMIN,
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: true }),
        });
        expect(enableRes.status).toBe(200);
        expect((await req("/api/songs/ab998877", { token: writerToken })).status).toBe(200);

        // 3. 停用后：独占动态数据清理，但插件保留在列表中为已停用
        const disableRes = await req("/api/plugins/community.disk_drop", {
            token: ADMIN,
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: false }),
        });
        expect(disableRes.status).toBe(200);
        expect((await req("/api/songs/ab998877", { token: writerToken })).status).toBe(404);

        // 4. 删除磁盘文件后再次扫描：记录自动移除
        rmSync(droppedPath, { force: true });
        const afterRmRes = await req("/api/plugins", { token: ADMIN });
        const afterRmJson = (await afterRmRes.json()) as { items: Array<{ id: string }> };
        expect(afterRmJson.items.some((item) => item.id === "community.disk_drop")).toBe(false);
    });

    test("远程插件源清单与按需下载（下载后保持未启用）", async () => {
        const listRes = await req("/api/plugins", { token: ADMIN });
        expect(listRes.status).toBe(200);
        const listJson = (await listRes.json()) as {
            items: Array<{ id: string; source: string; installed: boolean }>;
            registryUrl?: string;
        };
        expect(listJson.registryUrl).toContain("/plugins/index.json");
        const remoteItem = listJson.items.find((item) => item.id === "official.remote_pack");
        expect(remoteItem).toBeTruthy();
        expect(remoteItem?.source).toBe("remote");
        expect(remoteItem?.installed).toBe(false);

        const installRes = await req("/api/plugins", {
            token: ADMIN,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ remoteId: "official.remote_pack" }),
        });
        expect(installRes.status).toBe(201);
        const installed = (await installRes.json()) as { id: string; installed: boolean; enabled: boolean };
        expect(installed.installed).toBe(true);
        expect(installed.enabled).toBe(false);
        expect(existsSync(join(pluginsDir, "official.remote_pack.pbeplugin"))).toBe(true);
        expect((await req(`/api/songs/${remoteSongId}`, { token: writerToken })).status).toBe(404);

        const enableRes = await req("/api/plugins/official.remote_pack", {
            token: ADMIN,
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: true }),
        });
        expect(enableRes.status).toBe(200);
        expect((await req(`/api/songs/${remoteSongId}`, { token: writerToken })).status).toBe(200);

        expect((await req("/api/plugins/official.remote_pack", { token: ADMIN, method: "DELETE" })).status).toBe(204);
    });

    test("音色插件启用状态由插件控制，曲谱与自定义模板落在 dataDir", async () => {
        const timbreBytes = writePbePluginArchive({
            "plugin.json": JSON.stringify({
                id: "pianobe.timbre.classic_grand",
                name: "经典三角钢琴",
                version: "1.0.0",
                apiVersion: "1.0.0",
                minPianoBeVersion: "1.3.0",
                capabilities: ["audio.timbres"],
                author: "PianoBE",
                license: "CC0-1.0",
                provides: { timbres: ["classic_grand"] },
            }),
            "timbres/classic_grand.json": JSON.stringify({
                id: "classic_grand",
                value: 1,
                label: "经典三角",
                description: "测试音色",
                dirs: { v1: "classic_grand_v1" },
                notes: ["C4"],
                layers: ["v1"],
                soundDefinitions: {
                    "classic_grand_v1.C4": { category: "record", sounds: [{ name: "sounds/classic_grand_v1/C4", is3D: true }] },
                },
            }),
            "sounds/classic_grand_v1/C4.ogg": new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
        });
        const upRes = await req("/api/plugins", { token: ADMIN, method: "POST", body: timbreBytes });
        expect(upRes.status).toBe(201);

        const statusRes = await req("/api/addon/status", { token: ADMIN });
        const statusBody = (await statusRes.json()) as { enabledTimbres: string[] };
        expect(statusBody.enabledTimbres).toEqual(["piano", "classic_grand"]);

        const disableRes = await req("/api/plugins/pianobe.timbre.classic_grand", {
            token: ADMIN,
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: false }),
        });
        expect(disableRes.status).toBe(200);
        const statusAfterDisable = (await (await req("/api/addon/status", { token: ADMIN })).json()) as {
            enabledTimbres: string[];
        };
        expect(statusAfterDisable.enabledTimbres).toEqual(["piano"]);

        expect((await req("/api/plugins/pianobe.timbre.classic_grand", { token: ADMIN, method: "DELETE" })).status).toBe(
            204,
        );

        // 自定义曲谱与模板路径落在 dataDir 而非 dirname(pluginsDir)
        const scoreRes = await req("/api/addon/scores", {
            token: ADMIN,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                id: "test_score",
                title: "测试曲谱",
                pages: ["textures/scores/test_score_0.png"],
                assets: { "textures/scores/test_score_0.png": "AQID" },
            }),
        });
        expect(scoreRes.status).toBe(201);
        expect(existsSync(join(dataDir, "scores", "scores.json"))).toBe(true);
        expect(existsSync(join(tempRoot, "custom-root", "scores"))).toBe(false);
        expect((await req("/api/addon/scores/test_score", { token: ADMIN })).status).toBe(404);
        expect((await req("/api/addon/scores/test_score", { token: ADMIN, method: "DELETE" })).status).toBe(200);
    });

    test("BDS 部署：重新装配 BP/RP、写入世界配置并维护 pending_deploy -> pending_restart -> active", async () => {
        const clientTemplate = resolve(import.meta.dir, "../../../packages/addon/dist/template.mcaddon");
        const serverTemplate = resolve(import.meta.dir, "../../../packages/addon/dist/server.mcaddon");
        if (!existsSync(serverTemplate) && !existsSync(clientTemplate)) return;

        // 挂载一个不含脚本冲突的纯数据测试插件验证 BP/RP 部署
        const pluginBytes = writePbePluginArchive({
            "plugin.json": JSON.stringify({
                id: "pianobe.atmosphere",
                name: "测试氛围特效",
                version: "1.0.0",
                apiVersion: "1.0.0",
                minPianoBeVersion: "1.3.0",
                capabilities: ["vfx"],
                author: "PianoBE",
                license: "MIT",
                provides: { effects: ["test_atmo"] },
            }),
            "vfx/index.js": `export default { manifest: { id: "pianobe.atmosphere" }, register() {} };`,
        });
        expect((await req("/api/plugins", { token: ADMIN, method: "POST", body: pluginBytes })).status).toBe(201);
        expect((await req("/api/plugins/pianobe.atmosphere/trust", { token: ADMIN, method: "POST" })).status).toBe(200);

        const beforeStatus = (await (await req("/api/addon/status", { token: ADMIN })).json()) as {
            status: string;
            targetConfigHash: string;
        };
        expect(beforeStatus.status).toBe("pending_deploy");

        const configRes = await req("/api/addon/config", {
            token: ADMIN,
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                bdsPackMode: "development",
                packName: "自定义钢琴包",
                packDescription: "自定义服务器描述",
            }),
        });
        expect(configRes.status).toBe(200);

        const deployRes = await req("/api/addon/deploy", { token: ADMIN, method: "POST" });
        expect(deployRes.status).toBe(200);
        const afterDeploy = (await deployRes.json()) as {
            status: string;
            deployedConfigHash: string;
            targetConfigHash: string;
        };
        expect(afterDeploy.status).toBe("pending_restart");
        expect(afterDeploy.deployedConfigHash).toBe(afterDeploy.targetConfigHash);

        expect(existsSync(join(bdsDir, "development_behavior_packs", "pianoServerBP", "manifest.json"))).toBe(true);
        expect(existsSync(join(bdsDir, "development_resource_packs", "pianoServerRP", "manifest.json"))).toBe(true);
        expect(
            existsSync(
                join(bdsDir, "development_behavior_packs", "pianoServerBP", "scripts", "vfx", "deploymentInfo.js"),
            ),
        ).toBe(true);

        const bpManifest = JSON.parse(
            readFileSync(
                join(bdsDir, "development_behavior_packs", "pianoServerBP", "manifest.json"),
                "utf8",
            ),
        ) as { header: { name: string; description: string } };
        const rpManifest = JSON.parse(
            readFileSync(
                join(bdsDir, "development_resource_packs", "pianoServerRP", "manifest.json"),
                "utf8",
            ),
        ) as { header: { name: string; description: string } };
        expect(bpManifest.header.name).toBe("自定义钢琴包");
        expect(bpManifest.header.description).toBe("自定义服务器描述");
        expect(rpManifest.header.name).toBe("自定义钢琴包 (RP)");

        const worldBps = JSON.parse(
            readFileSync(join(bdsDir, "worlds", "MyWorld", "world_behavior_packs.json"), "utf8"),
        ) as Array<{ pack_id: string }>;
        expect(worldBps.some((p) => p.pack_id === "unrelated-pack-1")).toBe(true);
        expect(worldBps.length).toBe(2);

        // 模拟 BDS 重启加载并上报实际版本 -> active
        const loadedRes = await req("/api/addon/loaded", {
            token: ADMIN,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                configHash: afterDeploy.targetConfigHash,
                installedPlugins: ["pianobe.atmosphere"],
            }),
        });
        expect(loadedRes.status).toBe(200);
        expect(((await loadedRes.json()) as { status: string }).status).toBe("active");
    }, 30000);
});
