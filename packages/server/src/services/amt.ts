import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
}

export class AmtUnavailableError extends Error {}
export class AmtBusyError extends Error {}
export class AmtTimeoutError extends Error {}

interface AmtRuntime {
    cli: string;
    model: string;
}

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");

function firstExisting(paths: Array<string | undefined>): string | undefined {
    for (const p of paths) {
        if (p && existsSync(p)) return p;
    }
    return undefined;
}

/** 解析 CLI 与模型路径（支持环境变量、包内 amt/ 目录和 PATH） */
function resolveRuntime(config: ServerConfig): AmtRuntime | undefined {
    const exeNames = process.platform === "win32" ? ["amt-cli.exe", "amt-cli"] : ["amt-cli"];
    const cli = firstExisting([
        config.amtCli ? resolve(config.amtCli) : undefined,
        ...exeNames.map((name) => join(PACKAGE_ROOT, "amt", name)),
        ...exeNames.map((name) => join(PACKAGE_ROOT, "..", "..", "vendor", "amt", name)),
    ]);
    if (!cli) return undefined;

    const model = firstExisting([
        config.amtModel ? resolve(config.amtModel) : undefined,
        join(PACKAGE_ROOT, "amt", "run4_best.onnx"),
        join(dirname(cli), "run4_best.onnx"),
        join(dirname(cli), "..", "models", "run4_best.onnx"),
    ]);
    if (!model) return undefined;

    return { cli, model };
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
    private readonly queue = new TaskQueue();

    constructor(private readonly config: ServerConfig) {
        this.runtime = resolveRuntime(config);
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
                : "未找到 amt-cli 或 ONNX 模型：请运行 npm run sync:amt，或设置 AMT_CLI / AMT_MODEL",
        };
    }

    /**
     * 转录一个本地音频文件，返回 MIDI 字节。
     * 调用方负责提供音频路径（临时文件也由调用方清理）。
     */
    async transcribe(audioPath: string): Promise<AmtResult> {
        const runtime = this.runtime;
        if (!runtime) throw new AmtUnavailableError(this.status().message ?? "AMT 不可用");

        return this.queue.run(async () => {
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
                "-q",
            ];
            if (this.config.amtEco) {
                // --eco 自带 1 线程 / 128 chunk / 低优先级，会覆盖 --threads
                args.push("--eco");
            }

            const started = performance.now();
            let timedOut = false;
            const proc = Bun.spawn(args, {
                stdout: "pipe",
                stderr: "pipe",
                env: { ...process.env },
            });
            const timer = setTimeout(() => {
                timedOut = true;
                try {
                    proc.kill();
                } catch {
                    // 进程可能已经结束
                }
            }, this.config.amtTimeoutMs);

            try {
                const [code, stdout, stderr] = await Promise.all([
                    proc.exited,
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                ]);
                const log = `${stdout}${stderr}`.trim();
                if (timedOut) throw new AmtTimeoutError("转录超时，请缩短音频或调大 AMT_TIMEOUT_MS");
                if (code !== 0 || !existsSync(outPath)) {
                    throw new Error(`amt-cli 退出码 ${code}${log ? `：${tail(log)}` : ""}`);
                }
                return {
                    midi: Uint8Array.from(readFileSync(outPath)),
                    elapsedMs: Math.round(performance.now() - started),
                    log,
                };
            } finally {
                clearTimeout(timer);
                rmSync(tmp, { recursive: true, force: true });
            }
        });
    }
}

function tail(text: string, lines = 4): string {
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join(" | ");
}
