import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ServerConfig } from "../config.js";
import { NOOP_LOGGER, type Logger } from "../logger.js";
import type { AmtService } from "./amt.js";
import { fetchWithTimeout } from "./http.js";

const DEFAULT_REGISTRY = "https://registry.npmmirror.com";
const MAX_TARBALL_BYTES = 128 * 1024 * 1024;
const META_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface AmtInstallState {
    status: "idle" | "running" | "done" | "error";
    stage?: "resolving" | "downloading_model" | "downloading_binary" | "extracting" | "done" | "error";
    message?: string;
    percent?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    version?: string;
    registry?: string;
    error?: string;
    updatedAt?: number;
}

interface NpmVersionMeta {
    version?: string;
    dist?: { tarball?: string };
    optionalDependencies?: Record<string, string>;
}

interface NpmPackument {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, NpmVersionMeta>;
}

export function resolveNpmRegistryUrl(input?: string, fallback?: string): string {
    const raw = (input?.trim() || fallback?.trim() || "npmmirror").toLowerCase() === "npmmirror"
        ? "https://registry.npmmirror.com"
        : (input?.trim() || fallback?.trim() || "").toLowerCase() === "npm"
          ? "https://registry.npmjs.org"
          : input?.trim() || fallback?.trim() || DEFAULT_REGISTRY;
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`不支持的 npm 源协议：${url.protocol}`);
    }
    return url.toString().replace(/\/+$/, "");
}

function encodePackageName(name: string): string {
    return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

/**
 * 校验并规范化 npm tarball 内的相对路径：
 * - 剥离 npm tarball 固定的 `package/` 顶层前缀
 * - 拒绝空路径、`.`、`..`、绝对路径、盘符、空字节与反斜杠穿越
 */
export function sanitizeTarEntryPath(rawPath: string): string | undefined {
    const clean = rawPath.replace(/\0+$/, "").replaceAll("\\", "/").replace(/^\.\//, "");
    const stripped = clean.startsWith("package/") ? clean.slice("package/".length) : clean;
    if (!stripped || stripped === ".") return undefined;
    if (stripped.startsWith("/") || /^[A-Za-z]:/.test(stripped)) {
        throw new Error(`检测到非法绝对路径：${rawPath}`);
    }
    const parts = stripped.split("/").filter((seg) => seg.length > 0 && seg !== ".");
    if (parts.length === 0) return undefined;
    if (parts.some((seg) => seg === "..")) {
        throw new Error(`检测到路径穿越：${rawPath}`);
    }
    return parts.join("/");
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
    let text = "";
    for (let i = 0; i < length; i++) {
        const ch = buf[offset + i];
        if (ch === 0) break;
        text += String.fromCharCode(ch);
    }
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const val = Number.parseInt(trimmed, 8);
    return Number.isFinite(val) ? val : 0;
}

function readString(buf: Uint8Array, offset: number, length: number): string {
    let end = offset;
    const max = offset + length;
    while (end < max && buf[end] !== 0) end++;
    return Buffer.from(buf.subarray(offset, end)).toString("utf8");
}

function parsePaxPath(payload: Uint8Array): string | undefined {
    const text = Buffer.from(payload).toString("utf8");
    let idx = 0;
    while (idx < text.length) {
        const space = text.indexOf(" ", idx);
        if (space < 0) break;
        const len = Number.parseInt(text.slice(idx, space), 10);
        if (!Number.isFinite(len) || len <= 0) break;
        const record = text.slice(space + 1, idx + len);
        const nl = record.endsWith("\n") ? record.slice(0, -1) : record;
        const eq = nl.indexOf("=");
        if (eq > 0 && nl.slice(0, eq) === "path") {
            return nl.slice(eq + 1);
        }
        idx += len;
    }
    return undefined;
}

/** 纯内存解压 `.tgz` 到目标目录（不依赖外部 `tar` 命令，兼容单文件 exe）。 */
export function extractNpmTarball(tgzBytes: Uint8Array, targetDir: string): string[] {
    const tar = gunzipSync(tgzBytes);
    const written: string[] = [];
    let offset = 0;
    let nextPaxPath: string | undefined;
    let nextGnuLongName: string | undefined;

    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        offset += 512;

        let zeroBlock = true;
        for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) {
                zeroBlock = false;
                break;
            }
        }
        if (zeroBlock) break;

        const name = readString(header, 0, 100);
        const size = readOctal(header, 124, 12);
        const typeFlag = header[156] === 0 ? "0" : String.fromCharCode(header[156]!);
        const prefix = readString(header, 345, 155);
        const fullRawName = prefix ? `${prefix}/${name}` : name;

        const paddedSize = Math.ceil(size / 512) * 512;
        if (offset + size > tar.length) {
            throw new Error("tarball 内容截断");
        }
        const payload = tar.subarray(offset, offset + size);
        offset += paddedSize;

        if (typeFlag === "x") {
            nextPaxPath = parsePaxPath(payload);
            continue;
        }
        if (typeFlag === "L") {
            nextGnuLongName = Buffer.from(payload).toString("utf8").replace(/\0+$/, "");
            continue;
        }
        if (typeFlag === "g") {
            continue;
        }

        const effectiveName = nextPaxPath ?? nextGnuLongName ?? fullRawName;
        nextPaxPath = undefined;
        nextGnuLongName = undefined;

        const rel = sanitizeTarEntryPath(effectiveName);
        if (!rel) continue;

        if (typeFlag === "5") {
            mkdirSync(join(targetDir, rel), { recursive: true });
            continue;
        }
        if (typeFlag !== "0") {
            // 跳过符号链接等非普通文件，防止逃逸
            continue;
        }

        const outPath = join(targetDir, rel);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, payload);
        written.push(rel);
    }

    return written;
}

export class AmtInstaller {
    private state: AmtInstallState = { status: "idle" };
    private activeTask: Promise<void> | undefined;

    constructor(
        private readonly deps: {
            config: ServerConfig;
            amt: AmtService;
            logger?: Logger;
        },
    ) {}

    getState(): AmtInstallState {
        return { ...this.state };
    }

    start(registryInput?: string): AmtInstallState {
        if (this.activeTask && this.state.status === "running") {
            return this.getState();
        }
        const registry = resolveNpmRegistryUrl(registryInput, this.deps.config.npmRegistry);
        const target = `${process.platform}-${process.arch}`;
        if (target !== "win32-x64" && target !== "linux-x64") {
            throw new Error(`当前平台 ${target} 暂不支持一键下载 amt-cli，请手动设置 AMT_CLI`);
        }

        this.state = {
            status: "running",
            stage: "resolving",
            message: "正在查询 amt-cli 最新版本信息…",
            percent: -1,
            downloadedBytes: 0,
            totalBytes: 0,
            registry,
            updatedAt: Date.now(),
        };

        this.activeTask = this.runInstall(registry, target)
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.deps.logger?.error("下载安装 amt-cli 失败", error, { registry, target });
                this.state = {
                    ...this.state,
                    status: "error",
                    stage: "error",
                    message,
                    error: message,
                    updatedAt: Date.now(),
                };
            })
            .finally(() => {
                this.activeTask = undefined;
            });

        return this.getState();
    }

    private async fetchPackument(registry: string, pkgName: string): Promise<NpmPackument> {
        const url = `${registry}/${encodePackageName(pkgName)}`;
        const res = await fetchWithTimeout(
            url,
            {
                headers: {
                    accept: "application/vnd.npm.install-v1+json, application/json",
                },
            },
            META_TIMEOUT_MS,
        );
        if (!res.ok) {
            throw new Error(`查询包 ${pkgName} 失败（HTTP ${res.status}）`);
        }
        return (await res.json()) as NpmPackument;
    }

    private async downloadTarball(
        url: string,
        stage: "downloading_model" | "downloading_binary",
        label: string,
        baseOffsetBytes: number,
        estimatedCombinedBytes: number,
    ): Promise<Uint8Array> {
        const res = await fetchWithTimeout(url, {}, DOWNLOAD_TIMEOUT_MS);
        if (!res.ok) {
            throw new Error(`下载 ${label} 失败（HTTP ${res.status}）`);
        }
        const contentLength = Number(res.headers.get("content-length") ?? 0);
        if (contentLength > MAX_TARBALL_BYTES) {
            throw new Error(`${label} 体积超过限制`);
        }
        const total =
            contentLength > 0
                ? baseOffsetBytes + contentLength
                : estimatedCombinedBytes > 0
                  ? estimatedCombinedBytes
                  : 0;

        if (!res.body) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.byteLength > MAX_TARBALL_BYTES) {
                throw new Error(`${label} 体积超过限制`);
            }
            return bytes;
        }

        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value?.byteLength) continue;
                received += value.byteLength;
                if (received > MAX_TARBALL_BYTES) {
                    throw new Error(`${label} 体积超过限制`);
                }
                chunks.push(value);
                const downloadedBytes = baseOffsetBytes + received;
                const percent =
                    total > 0 ? Math.min(99, Math.round((downloadedBytes / total) * 100)) : -1;
                this.state = {
                    ...this.state,
                    stage,
                    message: `正在下载 ${label}…`,
                    downloadedBytes,
                    ...(total > 0 ? { totalBytes: total } : {}),
                    percent,
                    updatedAt: Date.now(),
                };
            }
        } finally {
            reader.releaseLock();
        }

        const merged = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) {
            merged.set(chunk, pos);
            pos += chunk.byteLength;
        }
        return merged;
    }

    private async runInstall(registry: string, target: string): Promise<void> {
        const log = this.deps.logger;
        log?.info("开始从 npm 下载 AMT 组件", { registry, target });

        const mainPackument = await this.fetchPackument(registry, "amt-cli");
        const latestVersion = mainPackument["dist-tags"]?.latest;
        const mainMeta = latestVersion ? mainPackument.versions?.[latestVersion] : undefined;
        const mainTarballUrl = mainMeta?.dist?.tarball;
        if (!latestVersion || !mainMeta || !mainTarballUrl) {
            throw new Error("amt-cli 元信息缺少 dist.tarball");
        }

        const optional = mainMeta.optionalDependencies ?? {};
        const platformPkg = Object.keys(optional).find((name) => name.endsWith(`amt-cli-${target}`));
        if (!platformPkg) {
            throw new Error(`amt-cli@${latestVersion} 不包含平台包 ${target}`);
        }
        const wantedVersion = optional[platformPkg];

        const platPackument = await this.fetchPackument(registry, platformPkg);
        const platVersion =
            (wantedVersion && platPackument.versions?.[wantedVersion] ? wantedVersion : undefined) ??
            platPackument["dist-tags"]?.latest;
        const platMeta = platVersion ? platPackument.versions?.[platVersion] : undefined;
        const platTarballUrl = platMeta?.dist?.tarball;
        if (!platVersion || !platTarballUrl) {
            throw new Error(`平台包 ${platformPkg} 缺少 dist.tarball`);
        }

        this.state = {
            ...this.state,
            version: latestVersion,
            stage: "downloading_model",
            message: `正在下载 amt-cli@${latestVersion} 模型包…`,
            percent: 0,
            updatedAt: Date.now(),
        };

        const mainTgz = await this.downloadTarball(
            mainTarballUrl,
            "downloading_model",
            `amt-cli@${latestVersion}`,
            0,
            0,
        );

        this.state = {
            ...this.state,
            stage: "downloading_binary",
            message: `正在下载 ${platformPkg}@${platVersion} 二进制…`,
            downloadedBytes: mainTgz.byteLength,
            updatedAt: Date.now(),
        };

        const platTgz = await this.downloadTarball(
            platTarballUrl,
            "downloading_binary",
            `${platformPkg}@${platVersion}`,
            mainTgz.byteLength,
            0,
        );

        this.state = {
            ...this.state,
            stage: "extracting",
            message: "正在解压并校验 AMT 组件…",
            percent: 98,
            downloadedBytes: mainTgz.byteLength + platTgz.byteLength,
            totalBytes: mainTgz.byteLength + platTgz.byteLength,
            updatedAt: Date.now(),
        };

        const dataDir = this.deps.config.dataDir;
        mkdirSync(dataDir, { recursive: true });
        const stageDir = join(dataDir, `.amt.staging_${Date.now()}`);
        const targetDir = join(dataDir, "amt");
        const oldDir = join(dataDir, `.amt.old_${Date.now()}`);

        try {
            extractNpmTarball(mainTgz, stageDir);
            extractNpmTarball(platTgz, stageDir);

            const exe = process.platform === "win32" ? "amt-cli.exe" : "amt-cli";
            const cliPath = join(stageDir, exe);
            const modelPath = join(stageDir, "models", "run4_int8.onnx");
            if (!existsSync(cliPath)) {
                throw new Error(`解压后缺少二进制文件：${exe}`);
            }
            if (!existsSync(modelPath)) {
                throw new Error("解压后缺少模型文件：models/run4_int8.onnx");
            }
            if (process.platform !== "win32") {
                chmodSync(cliPath, 0o755);
            }
            writeFileSync(
                join(stageDir, "installed.json"),
                `${JSON.stringify(
                    {
                        version: latestVersion,
                        platformPkg,
                        platformVersion: platVersion,
                        registry,
                        installedAt: Date.now(),
                    },
                    null,
                    2,
                )}\n`,
            );

            if (existsSync(targetDir)) {
                renameSync(targetDir, oldDir);
            }
            try {
                renameSync(stageDir, targetDir);
            } catch (swapErr) {
                if (existsSync(oldDir) && !existsSync(targetDir)) {
                    try {
                        renameSync(oldDir, targetDir);
                    } catch {
                        // best effort rollback
                    }
                }
                throw swapErr;
            }
            if (existsSync(oldDir)) {
                rmSync(oldDir, { recursive: true, force: true });
            }
        } catch (err) {
            rmSync(stageDir, { recursive: true, force: true });
            throw err;
        }

        const reloaded = this.deps.amt.reload();
        if (!reloaded.available) {
            throw new Error(reloaded.message ?? "AMT 安装完成但校验失败");
        }

        log?.info("AMT 组件下载并启用成功", {
            version: latestVersion,
            cli: reloaded.cli,
            model: reloaded.model,
        });

        this.state = {
            status: "done",
            stage: "done",
            message: `AMT ${latestVersion} 已就绪`,
            percent: 100,
            downloadedBytes: mainTgz.byteLength + platTgz.byteLength,
            totalBytes: mainTgz.byteLength + platTgz.byteLength,
            version: latestVersion,
            registry,
            updatedAt: Date.now(),
        };
    }
}
