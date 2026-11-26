import {
    accessSync,
    chmodSync,
    closeSync,
    constants,
    existsSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { ServerConfig } from "../config.js";

/**
 * AMT（Automated Music Transcription）服务端封装。
 *
 * 直接调用 muscriptor 的 Rust CLI：amt-cli <audio> -o out.mid --model ...
 * 音频解码、CQT、ONNX 推理、音符解码和 MIDI 写出都在 CLI 内完成，
 * 服务端只负责排队、超时控制和临时文件清理。
 */

export type AmtSource = "env" | "managed" | "npm" | "path";

export interface AmtStatus {
    available: boolean;
    source?: AmtSource;
    cli?: string;
    model?: string;
    platform: string;
    canInstall: boolean;
    decoder: "native" | "ffmpeg";
    threads: number;
    eco: boolean;
    message?: string;
}

export interface AmtResult {
    midi: Uint8Array<ArrayBuffer>;
    elapsedMs: number;
    log: string;
    /** --events 统计到的 note-on 数量（仅供参考，最终以解析 MIDI 为准） */
    noteCount: number;
}

export interface AmtProgress {
    /** 已解码到的音频时间（秒） */
    audioTime: number;
    noteCount: number;
}

export class AmtUnavailableError extends Error {}
export class AmtTimeoutError extends Error {}
export class AmtAbortedError extends Error {}

interface AmtRuntime {
    cli: string;
    model: string;
}

/** 模型优先级：静态 int8（约 3.9 MB，默认）→ fp32 回退（约 15 MB） */const AMT_MODEL_NAMES = ["run4_int8.onnx", "run4_best.onnx"] as const;

function firstExisting(paths: Array<string | undefined>): string | undefined {
    for (const p of paths) {
        if (p && existsSync(p)) return p;
    }
    return undefined;
}

/** 读取文件头判断二进制平台；shell 脚本等无法判断时当作 other。 */
function binaryKind(file: string): "pe" | "elf" | "other" {
    let fd: number | undefined;
    try {
        fd = openSync(file, "r");
        const head = Buffer.alloc(4);
        if (readSync(fd, head, 0, 4, 0) < 4) return "other";
        if (head[0] === 0x4d && head[1] === 0x5a) return "pe"; // MZ
        if (head[0] === 0x7f && head.toString("ascii", 1, 4) === "ELF") return "elf";
        return "other";
    } catch {
        return "other";
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/** 自动发现的 CLI 必须与当前平台一致，避免同步过 Windows 版后在 Linux 上直接 spawn 失败。 */
function platformMatches(file: string): boolean {
    const kind = binaryKind(file);
    if (kind === "pe") return process.platform === "win32";
    if (kind === "elf") return process.platform === "linux";
    return true;
}

function isExecutable(file: string): boolean {
    if (process.platform === "win32") return true;
    try {
        accessSync(file, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function pathCandidates(exeNames: string[]): string[] {
    const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    return dirs.flatMap((dir) => exeNames.map((name) => join(dir, name)));
}

interface AmtResolution {
    runtime?: AmtRuntime;
    source?: AmtSource;
    message?: string;
}

const SUPPORTED_INSTALL_TARGETS = new Set(["win32-x64", "linux-x64"]);

/** 解析托管下载目录（<dataDir>/amt/）中的 CLI 与模型 */
function resolveManagedPackage(config: ServerConfig): AmtResolution {
    const exe = process.platform === "win32" ? "amt-cli.exe" : "amt-cli";
    const root = join(config.dataDir, "amt");
    const cli = join(root, exe);
    if (!existsSync(cli)) return {};
    if (!platformMatches(cli)) {
        return { message: `托管目录中的 amt-cli 与本机平台不匹配（当前 ${process.platform}）：${cli}` };
    }
    ensureExecutable(cli);
    if (!isExecutable(cli)) {
        return { message: `amt-cli 缺少执行权限：chmod +x ${cli}` };
    }
    const model = firstExisting([
        config.amtModel ? resolve(config.amtModel) : undefined,
        ...AMT_MODEL_NAMES.map((name) => join(root, "models", name)),
        ...AMT_MODEL_NAMES.map((name) => join(root, name)),
    ]);
    if (!model) {
        return { message: `托管目录缺少 AMT 模型（${AMT_MODEL_NAMES.join(" / ")}）：${join(root, "models")}` };
    }
    return { runtime: { cli, model }, source: "managed" };
}

/** 手动按 node_modules 向上查找，编译成单文件后 require.resolve 不可用 */
function findPackagePath(spec: string): string | undefined {
    for (const start of [process.cwd(), dirname(process.execPath), import.meta.dir]) {
        let dir = start;
        for (;;) {
            const candidate = join(dir, "node_modules", spec);
            if (existsSync(candidate)) return candidate;
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return undefined;
}

/** npm tarball 不保留普通文件的执行位，首次运行时补上（只读安装则留待权限检查报错）。 */
function ensureExecutable(file: string): void {
    if (process.platform === "win32" || isExecutable(file)) return;
    try {
        chmodSync(file, 0o755);
    } catch {
        // 只读安装（全局 prefix 等）可能失败，交由调用方检查
    }
}

/** 读取已安装包的 package.json（用于发现分平台可选依赖），失败返回 undefined */
function readPackageJson(file: string): { optionalDependencies?: Record<string, string> } | undefined {
    try {
        return JSON.parse(readFileSync(file, "utf8")) as { optionalDependencies?: Record<string, string> };
    } catch {
        return undefined;
    }
}

/**
 * 从 npm 依赖 amt-cli 解析二进制与模型。
 * 0.1.1+：二进制放在分平台 optionalDependency（如 @xiaoyangx666/amt-cli-linux-x64），
 * 模型仍由 amt-cli 主包提供；0.1.0 的包内 `${platform}-${arch}/` 目录作为回退。
 */
function resolveNpmPackage(config: ServerConfig): AmtResolution {
    const pkgJson = findPackagePath("amt-cli/package.json");
    if (!pkgJson) return {};
    const root = dirname(pkgJson);
    const target = `${process.platform}-${process.arch}`;
    const exe = process.platform === "win32" ? "amt-cli.exe" : "amt-cli";

    // 分平台包名从 optionalDependencies 里取，避免服务端硬编码发布者的 scope
    const optional = readPackageJson(pkgJson)?.optionalDependencies ?? {};
    const platformPkg = Object.keys(optional).find((name) => name.endsWith(`amt-cli-${target}`));

    let cli: string;
    if (platformPkg) {
        try {
            const platformJson = findPackagePath(`${platformPkg}/package.json`);
            if (!platformJson) throw new Error("missing");
            cli = join(dirname(platformJson), exe);
        } catch {
            return {
                message: `未安装 amt-cli 的当前平台可选依赖 ${platformPkg}（${target}）：请重新 npm install，且不要使用 --omit=optional`,
            };
        }
        if (!existsSync(cli)) {
            return { message: `可选依赖 ${platformPkg} 缺少二进制：${cli}` };
        }
    } else {
        // 0.1.0 的包内布局：amt-cli/${platform}-${arch}/${exe}
        cli = join(root, target, exe);
        if (!existsSync(cli)) {
            return { message: `amt-cli 依赖不含当前平台（${target}）的二进制：${cli}` };
        }
    }

    const model = firstExisting([
        config.amtModel ? resolve(config.amtModel) : undefined,
        ...AMT_MODEL_NAMES.map((name) => join(root, "models", name)),
    ]);
    if (!model) {
        return { message: `amt-cli 依赖缺少模型（${AMT_MODEL_NAMES.join(" / ")}）：${join(root, "models")}` };
    }
    ensureExecutable(cli);
    return { runtime: { cli, model } };
}

/** 手工指定（AMT_CLI）时的模型查找：同目录、models/ 子目录与上级 models/ */
function findModel(config: ServerConfig, cli: string): string | undefined {
    return firstExisting([
        config.amtModel ? resolve(config.amtModel) : undefined,
        ...AMT_MODEL_NAMES.map((name) => join(dirname(cli), name)),
        ...AMT_MODEL_NAMES.map((name) => join(dirname(cli), "models", name)),
        ...AMT_MODEL_NAMES.map((name) => join(dirname(cli), "..", "models", name)),
    ]);
}

/** 解析 CLI 与模型路径：AMT_CLI(env) > 托管下载(managed) > npm 依赖(npm) > PATH(path) */
function resolveRuntime(config: ServerConfig, options: { skipNpmLookup?: boolean } = {}): AmtResolution {
    const exeNames = process.platform === "win32" ? ["amt-cli.exe", "amt-cli"] : ["amt-cli"];

    if (config.amtCli) {
        const cli = resolve(config.amtCli);
        if (!existsSync(cli)) {
            return { message: `AMT_CLI 指向的文件不存在：${cli}` };
        }
        if (!platformMatches(cli)) {
            return { message: `AMT_CLI 与本机平台不匹配（当前 ${process.platform}）：${cli}` };
        }
        if (!isExecutable(cli)) {
            return { message: `amt-cli 缺少执行权限：chmod +x ${cli}` };
        }
        const model = findModel(config, cli);
        if (!model) {
            return {
                message: `未找到 AMT 模型（${AMT_MODEL_NAMES.join(" / ")}）：请设置 AMT_MODEL`,
            };
        }
        return { runtime: { cli, model }, source: "env" };
    }

    const fromManaged = resolveManagedPackage(config);
    if (fromManaged.runtime) {
        return fromManaged;
    }

    const fromNpm = options.skipNpmLookup ? {} : resolveNpmPackage(config);
    if (fromNpm.runtime) {
        if (!isExecutable(fromNpm.runtime.cli)) {
            return { message: `amt-cli 缺少执行权限：chmod +x ${fromNpm.runtime.cli}` };
        }
        return { runtime: fromNpm.runtime, source: "npm" };
    }

    const autoCandidates = pathCandidates(exeNames);
    const cli = autoCandidates.find((p) => existsSync(p) && platformMatches(p));
    if (!cli) {
        const wrong = autoCandidates.find((p) => existsSync(p) && !platformMatches(p));
        return {
            message: wrong
                ? `找到的 amt-cli 与本机平台不匹配（当前 ${process.platform}）：${wrong}`
                : (fromManaged.message ??
                  fromNpm.message ??
                  "未找到 amt-cli：可在管理页一键下载 AMT 组件、执行 npm install 或设置 AMT_CLI"),
        };
    }

    if (!isExecutable(cli)) {
        return { message: `amt-cli 缺少执行权限：chmod +x ${cli}` };
    }

    const model = findModel(config, cli);
    if (!model) {
        return {
            message: `未找到 AMT 模型（${AMT_MODEL_NAMES.join(" / ")}）：可在管理页一键下载 AMT 组件，或设置 AMT_MODEL`,
        };
    }

    return { runtime: { cli, model }, source: "path" };
}

export class AmtService {
    private runtime: AmtRuntime | undefined;
    private resolutionSource: AmtSource | undefined;
    private resolutionMessage: string | undefined;

    constructor(
        private readonly config: ServerConfig,
        private readonly options: { skipNpmLookup?: boolean } = {},
    ) {
        this.applyResolution(resolveRuntime(config, options));
    }

    private applyResolution(res: AmtResolution): void {
        this.runtime = res.runtime;
        this.resolutionSource = res.source;
        this.resolutionMessage = res.message;
    }

    /** 下载/安装完成后重新扫描解析路径，立即热生效而无需重启服务。 */
    reload(): AmtStatus {
        this.applyResolution(resolveRuntime(this.config, this.options));
        return this.status();
    }

    status(): AmtStatus {
        const platform = `${process.platform}-${process.arch}`;
        return {
            available: Boolean(this.runtime),
            ...(this.resolutionSource ? { source: this.resolutionSource } : {}),
            cli: this.runtime?.cli,
            model: this.runtime?.model,
            platform,
            canInstall: SUPPORTED_INSTALL_TARGETS.has(platform),
            decoder: this.config.amtDecoder,
            threads: this.config.amtThreads,
            eco: this.config.amtEco,
            message: this.runtime
                ? undefined
                : (this.resolutionMessage ??
                  "未找到 amt-cli 或 ONNX 模型：可在管理页一键下载 AMT 组件、执行 npm install 或设置 AMT_CLI / AMT_MODEL"),
        };
    }

    /**
     * 转录一个本地音频文件，返回 MIDI 字节。
     * 调用方负责提供音频路径（临时文件也由调用方清理）。
     *
     * 通过 `--events` 读取 amt-cli 实时输出的音符事件，把「已解码音频时间」
     * 作为进度回调；事件按音频时间推进，可用于长音频的百分比进度。
     */
    async transcribe(
        audioPath: string,
        options: { onProgress?: (progress: AmtProgress) => void; signal?: AbortSignal } = {}
    ): Promise<AmtResult> {
        const runtime = this.runtime;
        if (!runtime) throw new AmtUnavailableError(this.status().message ?? "AMT 不可用");
        if (options.signal?.aborted) throw new AmtAbortedError("任务已取消");

        const task = (async () => {
            if (options.signal?.aborted) throw new AmtAbortedError("任务已取消");
            const tmp = mkdtempSync(join(tmpdir(), `pianobe-amt-${process.pid}-`));
            const outPath = join(tmp, "out.mid");
            const args = [
                runtime.cli,
                audioPath,
                "-o",
                outPath,
                "--model",
                runtime.model,
                "--decoder",
                this.config.amtDecoder,
                "--threads",
                String(this.config.amtThreads),
                "--no-spin",
                "--events",
                "-q",
            ];
            if (this.config.amtEco) {
                // --eco 自带 1 线程 / 128 chunk / 低优先级，会覆盖 --threads
                args.push("--eco");
            }

            const started = performance.now();
            let timedOut = false;
            let aborted = false;
            const proc = Bun.spawn(args, {
                stdout: "pipe",
                stderr: "pipe",
                env: { ...process.env },
            });
            const onAbort = () => {
                aborted = true;
                try {
                    proc.kill();
                } catch {
                    // 进程可能已经结束
                }
            };
            options.signal?.addEventListener("abort", onAbort, { once: true });
            const timer = setTimeout(() => {
                timedOut = true;
                try {
                    proc.kill();
                } catch {
                    // 进程可能已经结束
                }
            }, this.config.amtTimeoutMs);

            let audioTime = 0;
            let noteCount = 0;
            let lastReport = 0;

            // 逐行读取 --events 的 JSON 事件；stderr 同时消费避免管道写满
            const readEvents = async () => {
                const reader = proc.stdout.getReader();
                const decoder = new TextDecoder();
                let buffered = "";
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffered += decoder.decode(value, { stream: true });
                        let newline = buffered.indexOf("\n");
                        while (newline >= 0) {
                            const line = buffered.slice(0, newline).trim();
                            buffered = buffered.slice(newline + 1);
                            newline = buffered.indexOf("\n");
                            if (!line.startsWith("{")) continue;
                            try {
                                const event = JSON.parse(line) as { type?: string; time?: number };
                                if (typeof event.time === "number" && event.time > audioTime) {
                                    audioTime = event.time;
                                }
                                if (event.type === "on") noteCount++;
                            } catch {
                                // 非事件行（摘要/警告）忽略
                            }
                        }
                        const now = performance.now();
                        if (options.onProgress && now - lastReport >= 150) {
                            lastReport = now;
                            options.onProgress({ audioTime, noteCount });
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
            };

            const stderrText = new Response(proc.stderr).text();
            const eventsTask = readEvents();

            try {
                const [code, stderr] = await Promise.all([proc.exited, stderrText]);
                await eventsTask;
                if (options.onProgress) options.onProgress({ audioTime, noteCount });
                const log = stderr.trim();
                if (aborted) throw new AmtAbortedError("任务已取消");
                if (timedOut) throw new AmtTimeoutError("转录超时，请缩短音频或调大 AMT_TIMEOUT_MS");
                if (code !== 0 || !existsSync(outPath)) {
                    throw new Error(`amt-cli 退出码 ${code}${log ? `：${tail(log)}` : ""}`);
                }
                return {
                    midi: Uint8Array.from(readFileSync(outPath)),
                    elapsedMs: Math.round(performance.now() - started),
                    log,
                    noteCount,
                };
            } finally {
                options.signal?.removeEventListener("abort", onAbort);
                clearTimeout(timer);
                rmSync(tmp, { recursive: true, force: true });
            }
        })();
        return task;
    }
}

function tail(text: string, lines = 4): string {
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join(" | ");
}
