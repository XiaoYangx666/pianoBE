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
let bdsDir = "";

function req(path: string, init: RequestInit & { token?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    const { token: _t, ...rest } = init;
    return app.request(path, { ...rest, headers });
}

beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "piano-studio-api-"));
    const midisDir = join(tempRoot, "midis");
    const pluginsDir = join(tempRoot, "plugins");
    bdsDir = join(tempRoot, "bds");
    mkdirSync(join(bdsDir, "worlds", "MyWorld"), { recursive: true });
    writeFileSync(join(bdsDir, "server.properties"), "level-name=MyWorld\n");
    writeFileSync(
        join(bdsDir, "worlds", "MyWorld", "world_behavior_packs.json"),
        JSON.stringify([{ pack_id: "unrelated-pack-1", version: [1, 0, 0] }]),
    );

    const db = openDb(":memory:");
    ensureBootstrapToken(db, ADMIN);
    const songPort = new SqliteSongPort(db, midisDir);
    const config = loadConfig({
        PLUGINS_DIR: pluginsDir,
        BDS_DIR: bdsDir,
        BDS_WORLD: "MyWorld",
    });
    const pluginService = new PluginService(songPort, config);
    const deploymentService = new DeploymentService(songPort, pluginService, config);
    deps = { db, songPort, config, pluginService, deploymentService };
    app = createApp(deps);
    writerToken = createToken(db, "studio-writer", "write").token;
});

afterAll(() => {
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
    });

    test("BDS 部署：重新装配 BP/RP、写入世界配置并维护 pending_deploy -> pending_restart -> active", async () => {
        const bareTemplate = resolve(import.meta.dir, "../../../packages/addon/dist/template-bare.mcaddon");
        const serverTemplate = resolve(import.meta.dir, "../../../packages/addon/dist/server.mcaddon");
        if (!existsSync(serverTemplate) && !existsSync(bareTemplate)) return;

        // 安装内置 atmosphere 插件用于验证 BP/RP 部署
        const builtinsRes = await req("/api/plugins", { token: ADMIN });
        const builtins = ((await builtinsRes.json()) as { items: Array<{ id: string }> }).items;
        if (builtins.some((b) => b.id === "pianobe.atmosphere")) {
            const installBuiltin = await req("/api/plugins", {
                token: ADMIN,
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ builtinId: "pianobe.atmosphere" }),
            });
            expect(installBuiltin.status).toBe(201);
        }

        const beforeStatus = (await (await req("/api/addon/status", { token: ADMIN })).json()) as {
            status: string;
            targetConfigHash: string;
        };
        expect(beforeStatus.status).toBe("pending_deploy");

        const deployRes = await req("/api/addon/deploy", { token: ADMIN, method: "POST" });
        expect(deployRes.status).toBe(200);
        const afterDeploy = (await deployRes.json()) as {
            status: string;
            deployedConfigHash: string;
            targetConfigHash: string;
        };
        expect(afterDeploy.status).toBe("pending_restart");
        expect(afterDeploy.deployedConfigHash).toBe(afterDeploy.targetConfigHash);

        expect(existsSync(join(bdsDir, "behavior_packs", "pianoServerBP", "manifest.json"))).toBe(true);
        expect(existsSync(join(bdsDir, "resource_packs", "pianoServerRP", "manifest.json"))).toBe(true);
        expect(existsSync(join(bdsDir, "behavior_packs", "pianoServerBP", "scripts", "vfx", "deploymentInfo.js"))).toBe(
            true,
        );

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
