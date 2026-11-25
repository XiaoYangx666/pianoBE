import {
    accessSync,
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

export interface AmtStatus {
    available: boolean;
    cli?: string;
    model?: string;
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
export class AmtBusyError extends Error {}
export class AmtTimeoutError extends Error {}
export class AmtAbortedError extends Error {}

interface AmtRuntime {
    cli: string;
    model: string;
}

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");

/** 模型优先级：静态 int8（约 3.9 MB，默认）→ fp32 回退（约 15 MB） */
const AMT_MODEL_NAMES = ["run4_int8.onnx", "run4_best.onnx"] as const;

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
    message?: string;
}

/** 解析 CLI 与模型路径（支持环境变量、包内 amt/ 目录、vendor/ 和 PATH） */
function resolveRuntime(config: ServerConfig): AmtResolution {
    const exeNames = process.platform === "win32" ? ["amt-cli.exe", "amt-cli"] : ["amt-cli"];
    const autoCandidates = [
        ...exeNames.map((name) => join(PACKAGE_ROOT, "amt", name)),
        ...exeNames.map((name) => join(PACKAGE_ROOT, "..", "..", "vendor", "amt", name)),
        ...pathCandidates(exeNames),
    ];

    let cli: string | undefined;
    if (config.amtCli) {
        cli = resolve(config.amtCli);
        if (!existsSync(cli)) {
            return { message: `AMT_CLI 指向的文件不存在：${cli}` };
        }
        if (!platformMatches(cli)) {
            return { message: `AMT_CLI 与本机平台不匹配（当前 ${process.platform}）：${cli}` };
        }
    } else {
        cli = autoCandidates.find((p) => existsSync(p) && platformMatches(p));
        if (!cli) {
            const wrong = autoCandidates.find((p) => existsSync(p) && !platformMatches(p));
            return {
                message: wrong
                    ? `找到的 amt-cli 与本机平台不匹配（当前 ${process.platform}）：${wrong}；请重新运行 npm run sync:amt（Docker 用 AMT_PLATFORM=linux）`
                    : "未找到 amt-cli：请运行 npm run sync:amt，或设置 AMT_CLI",
            };
        }
    }

    if (!isExecutable(cli)) {
        return { message: `amt-cli 缺少执行权限：chmod +x ${cli}` };
    }

    const model = firstExisting([
        config.amtModel ? resolve(config.amtModel) : undefined,
        ...AMT_MODEL_NAMES.map((name) => join(PACKAGE_ROOT, "amt", name)),
        ...AMT_MODEL_NAMES.map((name) => join(dirname(cli), name)),
        ...AMT_MODEL_NAMES.map((name) => join(PACKAGE_ROOT, "amt", "models", name)),
        ...AMT_MODEL_NAMES.map((name) => join(dirname(cli), "models", name)),
        ...AMT_MODEL_NAMES.map((name) => join(dirname(cli), "..", "models", name)),
    ]);
    if (!model) {
        return {
            message: `未找到 AMT 模型（${AMT_MODEL_NAMES.join(" / ")}）：请运行 npm run sync:amt，或设置 AMT_MODEL`,
        };
    }

    return { runtime: { cli, model } };
}

/** 串行队列：AMT 推理很吃内存，默认同一时间只跑一个任务 */
class TaskQueue {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(
        private readonly maxActive = 1,
        private readonly maxWaiting = 8
    ) {}

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= this.maxActive) {
            if (this.waiting.length >= this.maxWaiting) {
                throw new AmtBusyError("转录队列已满，请稍后再试");
            }
            await new Promise<void>((resolveWait) => this.waiting.push(resolveWait));
        }
        this.active++;
        try {
            return await task();
        } finally {
            this.active--;
            const next = this.waiting.shift();
            if (next) next();
        }
    }
}

export class AmtService {
    private readonly runtime: AmtRuntime | undefined;
    private readonly resolutionMessage: string | undefined;
    private readonly queue = new TaskQueue();

    constructor(private readonly config: ServerConfig) {
        const { runtime, message } = resolveRuntime(config);
        this.runtime = runtime;
        this.resolutionMessage = message;
    }

    status(): AmtStatus {
        return {
            available: Boolean(this.runtime),
            cli: this.runtime?.cli,
            model: this.runtime?.model,
            decoder: this.config.amtDecoder,
            threads: this.config.amtThreads,
            eco: this.config.amtEco,
            message: this.runtime
                ? undefined
                : (this.resolutionMessage ?? "未找到 amt-cli 或 ONNX 模型：请运行 npm run sync:amt，或设置 AMT_CLI / AMT_MODEL"),
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

        return this.queue.run(async () => {
            if (options.signal?.aborted) throw new AmtAbortedError("任务已取消");
            const tmp = mkdtempSync(join(tmpdir(), "pianobe-amt-"));
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
        });
    }
}

function tail(text: string, lines = 4): string {
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join(" | ");
}
