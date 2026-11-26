import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { openDb } from "../src/db";
import { createApp } from "../src/app";
import { createToken, ensureBootstrapToken } from "../src/auth";
import { SqliteSongPort } from "../src/drivers/sqlitePorts";
import { loadConfig, loadHomeEnv, resolveHomeDir } from "../src/config";
import { AmtService } from "../src/services/amt";
import { extractNpmTarball, sanitizeTarEntryPath } from "../src/services/amtInstaller";

function createTgz(entries: Array<{ name: string; content: Uint8Array }>): Uint8Array {
    const blocks: Uint8Array[] = [];
    const encoder = new TextEncoder();

    for (const entry of entries) {
        const header = new Uint8Array(512);
        const nameBytes = encoder.encode(entry.name);
        header.set(nameBytes.subarray(0, 100), 0);
        header.set(encoder.encode("0000644\0"), 100);
        header.set(encoder.encode("0000000\0"), 108);
        header.set(encoder.encode("0000000\0"), 116);
        header.set(encoder.encode(`${entry.content.byteLength.toString(8).padStart(11, "0")}\0`), 124);
        header.set(encoder.encode(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`), 136);
        header.fill(0x20, 148, 156);
        header[156] = "0".charCodeAt(0);
        header.set(encoder.encode("ustar\0"), 257);
        header.set(encoder.encode("00"), 263);

        let sum = 0;
        for (let i = 0; i < 512; i++) sum += header[i]!;
        header.set(encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
        blocks.push(header);

        blocks.push(entry.content);
        const rem = entry.content.byteLength % 512;
        if (rem !== 0) {
            blocks.push(new Uint8Array(512 - rem));
        }
    }
    blocks.push(new Uint8Array(1024));

    const totalLen = blocks.reduce((acc, b) => acc + b.byteLength, 0);
    const tar = new Uint8Array(totalLen);
    let offset = 0;
    for (const b of blocks) {
        tar.set(b, offset);
        offset += b.byteLength;
    }
    return Uint8Array.from(gzipSync(tar));
}

function makeFakeBinary(): Uint8Array {
    // Windows 下写入 MZ 头使 platformMatches 通过；Linux 下写入 ELF 头
    if (process.platform === "win32") {
        return new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    }
    return new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
}

let tempRoot = "";
let mockRegistry: ReturnType<typeof Bun.serve> | undefined;

beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "piano-amt-test-"));
});

afterAll(() => {
    mockRegistry?.stop(true);
    rmSync(tempRoot, { recursive: true, force: true });
});

describe("AMT 4 级解析与离线一键安装", () => {
    test("解析优先级：AMT_CLI(env) > dataDir/amt(managed) > node_modules(npm) > PATH(path)", () => {
        const home = join(tempRoot, "prio-home");
        const dataDir = join(home, "data");
        const managedDir = join(dataDir, "amt");
        const envDir = join(tempRoot, "env-amt");
        const pathDir = join(tempRoot, "path-amt");
        mkdirSync(join(managedDir, "models"), { recursive: true });
        mkdirSync(join(envDir, "models"), { recursive: true });
        mkdirSync(join(pathDir, "models"), { recursive: true });

        const exe = process.platform === "win32" ? "amt-cli.exe" : "amt-cli";
        const bin = makeFakeBinary();
        const modelBytes = new Uint8Array([1, 2, 3, 4]);

        writeFileSync(join(envDir, exe), bin);
        writeFileSync(join(envDir, "models", "run4_int8.onnx"), modelBytes);
        writeFileSync(join(managedDir, exe), bin);
        writeFileSync(join(managedDir, "models", "run4_int8.onnx"), modelBytes);
        writeFileSync(join(pathDir, exe), bin);
        writeFileSync(join(pathDir, "models", "run4_int8.onnx"), modelBytes);

        // 1. AMT_CLI 优先级最高
        const envSvc = new AmtService(
            loadConfig({
                PIANOBE_HOME: home,
                AMT_CLI: join(envDir, exe),
                PATH: pathDir,
            }),
        );
        expect(envSvc.status().available).toBe(true);
        expect(envSvc.status().source).toBe("env");
        expect(envSvc.status().cli).toBe(join(envDir, exe));

        // 2. 无 AMT_CLI 时优先托管目录 managed（高于 npm）
        const managedSvc = new AmtService(loadConfig({ PIANOBE_HOME: home, PATH: pathDir }));
        expect(managedSvc.status().available).toBe(true);
        expect(managedSvc.status().source).toBe("managed");
        expect(managedSvc.status().cli).toBe(join(managedDir, exe));

        // 3. 删除 managed 后：优先命中 npm（当前工作区已安装 amt-cli）
        rmSync(managedDir, { recursive: true, force: true });
        const npmSvc = new AmtService(loadConfig({ PIANOBE_HOME: home }));
        expect(npmSvc.status().available).toBe(true);
        expect(npmSvc.status().source).toBe("npm");

        // 4. 无 managed 且跳过 npm 时：回退到 PATH
        const origPath = process.env.PATH;
        try {
            process.env.PATH = pathDir;
            const pathSvc = new AmtService(
                loadConfig({ PIANOBE_HOME: home }),
                { skipNpmLookup: true },
            );
            expect(pathSvc.status().available).toBe(true);
            expect(pathSvc.status().source).toBe("path");
            expect(pathSvc.status().cli).toBe(join(pathDir, exe));

            // 5. 全部不存在时返回友好引导文案
            process.env.PATH = "";
            const emptySvc = new AmtService(
                loadConfig({ PIANOBE_HOME: home }),
                { skipNpmLookup: true },
            );
            expect(emptySvc.status().available).toBe(false);
            expect(emptySvc.status().message).toContain("一键下载");
        } finally {
            process.env.PATH = origPath;
        }
    });

    test("tarball 路径安全检查拒绝目录穿越与绝对路径", () => {
        expect(sanitizeTarEntryPath("package/models/run4_int8.onnx")).toBe("models/run4_int8.onnx");
        expect(() => sanitizeTarEntryPath("package/../../evil.txt")).toThrow("路径穿越");
        expect(() => sanitizeTarEntryPath("/etc/passwd")).toThrow("绝对路径");

        const evilTgz = createTgz([{ name: "package/../escape.txt", content: new Uint8Array([1]) }]);
        const out = join(tempRoot, "evil-extract");
        expect(() => extractNpmTarball(evilTgz, out)).toThrow("路径穿越");
        expect(existsSync(join(tempRoot, "escape.txt"))).toBe(false);
    });

    test("管理员可通过 /api/transcribe/amt/install 从 npm registry 离线安装并热重载", async () => {
        const target = `${process.platform}-${process.arch}`;
        const exe = process.platform === "win32" ? "amt-cli.exe" : "amt-cli";
        const platformPkg = `@xiaoyangx666/amt-cli-${target}`;

        const mainTgz = createTgz([
            { name: "package/package.json", content: new TextEncoder().encode(`{"name":"amt-cli","version":"0.1.1"}`) },
            { name: "package/models/run4_int8.onnx", content: new Uint8Array([0x08, 0x09, 0x0a]) },
        ]);
        const platTgz = createTgz([
            { name: "package/package.json", content: new TextEncoder().encode(`{"name":"${platformPkg}","version":"0.1.1"}`) },
            { name: `package/${exe}`, content: makeFakeBinary() },
        ]);

        let baseUrl = "";
        mockRegistry = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(request) {
                const url = new URL(request.url);
                if (url.pathname === "/amt-cli") {
                    return Response.json({
                        "dist-tags": { latest: "0.1.1" },
                        versions: {
                            "0.1.1": {
                                version: "0.1.1",
                                dist: { tarball: `${baseUrl}/tar/amt-cli-0.1.1.tgz` },
                                optionalDependencies: { [platformPkg]: "0.1.1" },
                            },
                        },
                    });
                }
                if (url.pathname === `/@xiaoyangx666%2Famt-cli-${target}`) {
                    return Response.json({
                        "dist-tags": { latest: "0.1.1" },
                        versions: {
                            "0.1.1": {
                                version: "0.1.1",
                                dist: { tarball: `${baseUrl}/tar/plat-0.1.1.tgz` },
                            },
                        },
                    });
                }
                if (url.pathname === "/tar/amt-cli-0.1.1.tgz") {
                    return new Response(Uint8Array.from(mainTgz));
                }
                if (url.pathname === "/tar/plat-0.1.1.tgz") {
                    return new Response(Uint8Array.from(platTgz));
                }
                return new Response("Not Found", { status: 404 });
            },
        });
        baseUrl = `http://127.0.0.1:${mockRegistry.port}`;

        const home = join(tempRoot, "install-home");
        const config = loadConfig({
            PIANOBE_HOME: home,
            NPM_REGISTRY: baseUrl,
            PATH: "",
        });
        const db = openDb(":memory:");
        const ADMIN = "amt-admin";
        ensureBootstrapToken(db, ADMIN);
        const userToken = createToken(db, "amt-user", "user").token;
        const songPort = new SqliteSongPort(db);
        const amt = new AmtService(config, { skipNpmLookup: true });
        const app = createApp({ db, songPort, config, amt });

        expect(amt.status().available).toBe(false);

        // 非 admin 拒绝触发下载
        const forbidden = await app.request("/api/transcribe/amt/install", {
            method: "POST",
            headers: { Authorization: `Bearer ${userToken}` },
        });
        expect(forbidden.status).toBe(403);

        // admin 触发下载
        const startRes = await app.request("/api/transcribe/amt/install", {
            method: "POST",
            headers: { Authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        expect(startRes.status).toBe(202);

        let finalState: { status: string; error?: string } | undefined;
        for (let i = 0; i < 40; i++) {
            const poll = await app.request("/api/transcribe/amt/install", {
                headers: { Authorization: `Bearer ${ADMIN}` },
            });
            expect(poll.status).toBe(200);
            const json = (await poll.json()) as { install: { status: string; error?: string } };
            finalState = json.install;
            if (finalState.status === "done" || finalState.status === "error") break;
            await Bun.sleep(25);
        }
        expect(finalState?.status).toBe("done");

        const managedRoot = join(home, "data", "amt");
        expect(existsSync(join(managedRoot, exe))).toBe(true);
        expect(existsSync(join(managedRoot, "models", "run4_int8.onnx"))).toBe(true);
        expect(existsSync(join(managedRoot, "installed.json"))).toBe(true);
        const meta = JSON.parse(readFileSync(join(managedRoot, "installed.json"), "utf8")) as { version: string };
        expect(meta.version).toBe("0.1.1");

        // 热重载立即生效，无需重启
        const statusRes = await app.request("/api/transcribe/status", {
            headers: { Authorization: `Bearer ${ADMIN}` },
        });
        const statusJson = (await statusRes.json()) as { available: boolean; source?: string; cli?: string };
        expect(statusJson.available).toBe(true);
        expect(statusJson.source).toBe("managed");
        expect(statusJson.cli).toBe(join(managedRoot, exe));

        db.close();
    });

    test("loadHomeEnv 从 homeDir/.env 补充环境变量且不覆盖已有显式环境", () => {
        const home = join(tempRoot, "env-home");
        mkdirSync(home, { recursive: true });
        writeFileSync(
            join(home, ".env"),
            [
                "# 注释",
                "PORT=35666",
                'BOOTSTRAP_TOKEN="home-token-123"',
                "export PLUGIN_REGISTRY_URL='https://example.com/plugins/index.json'",
                "EMPTY=",
            ].join("\n"),
        );

        const target: Record<string, string | undefined> = { PORT: "39999" };
        const resolved = resolveHomeDir(target, ["--dir", home]);
        expect(resolved).toBe(home);
        loadHomeEnv(resolved, target);
        expect(target.PORT).toBe("39999");
        expect(target.BOOTSTRAP_TOKEN).toBe("home-token-123");
        expect(target.PLUGIN_REGISTRY_URL).toBe("https://example.com/plugins/index.json");
        expect(target.EMPTY).toBe("");
    });
});
