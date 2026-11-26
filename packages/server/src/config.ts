import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseLogFormat, parseLogLevel, type LogFormat, type LogLevel } from "./logger.js";

export interface ServerConfig {
    port: number;
    /** 服务端运行根目录（MC Server 式外置 plugins/ data/ logs/ 根，默认当前目录） */
    homeDir: string;
    /** 运行期数据目录（sqlite、自定义模板、曲谱、自动下载的 AMT 等） */
    dataDir: string;
    /** sqlite 文件路径（":memory:" 用于测试） */
    dbPath: string;
    /** 外置插件目录（存放 {id}.pbeplugin，自动扫描对账） */
    pluginsDir: string;
    /** 可选远程插件清单 URL（如 Cloudflare 静态站 /plugins/index.json） */
    pluginRegistryUrl?: string;
    /** 服务器基础模板 .mcaddon 路径 */
    serverTemplatePath?: string;
    /** 托管的 BDS 服务器根目录 */
    bdsDir?: string;
    /** BDS 目标世界目录名 */
    bdsWorld?: string;
    /** BDS 行为包目录名 */
    bdsBpName: string;
    /** BDS 资源包目录名 */
    bdsRpName: string;
    /** 部署到 development_* 目录（开发包，默认）还是 behavior_packs/resource_packs（正式目录） */
    bdsPackMode: "development" | "release";
    /** 自定义 manifest 包名；空则沿用模板 */
    packName?: string;
    /** 自定义 manifest 描述；空则沿用模板 */
    packDescription?: string;
    /** 管理员引导令牌；未设置时首次启动自动生成并打印 */
    bootstrapToken?: string;
    /** 为 true 时公开读接口（曲目列表/曲目内容）无需令牌 */
    allowPublicRead: boolean;
    /** web 构建产物静态目录（不存在则不托管） */
    webRoot?: string;
    /** amt-cli 可执行文件路径；留空时使用 npm 依赖 amt-cli 内置的当前平台二进制 */
    amtCli?: string;
    /** AMT ONNX 模型路径；留空时使用 amt-cli 包内的 run4_int8.onnx */
    amtModel?: string;
    /** amt-cli 解码器：native（纯 Rust，默认）或 ffmpeg（外部 ffmpeg） */
    amtDecoder: "native" | "ffmpeg";
    /** amt-cli 转录线程数（默认 4） */
    amtThreads: number;
    /** 使用 --eco 低负载模式（单线程 + 主动让出 CPU） */
    amtEco: boolean;
    /** 同时运行的转录任务数（默认 1，避免多个 amt-cli 打满 CPU） */
    amtConcurrency: number;
    /** 最多允许排队的转录任务数（默认 10，防止大量上传占满临时空间） */
    amtMaxQueue: number;
    /** 单个音频/视频最大时长（秒，默认 600）；超过直接拒绝，避免长时间下载和转录 */
    amtMaxAudioSeconds: number;
    /** B 站音频下载字节上限（默认 200 MB），防止异常大文件占满内存/临时盘 */
    amtMaxDownloadBytes: number;
    /** 单次转录超时（默认 10 分钟） */
    amtTimeoutMs: number;
    /** 后端下载 amt-cli 时使用的默认 npm registry（默认 https://registry.npmmirror.com） */
    npmRegistry?: string;
    /** B 站登录 Cookie（SESSDATA），仅高码率音轨需要 */
    biliSessdata?: string;
    /** 日志文件路径；设为 off 时只输出到控制台（默认 <homeDir>/logs/server.log） */
    logFile?: string;
    /** 最低日志级别（默认 info） */
    logLevel: LogLevel;
    /** 文件日志格式（默认 text；json 为一行一条） */
    logFormat: LogFormat;
    /** 单个日志文件上限（默认 10 MB） */
    logMaxBytes: number;
    /** 保留的历史日志文件数（默认 7） */
    logMaxFiles: number;
}

function parseDirArg(argv: readonly string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        if (arg === "--dir" && argv[i + 1]) return argv[i + 1];
        if (arg.startsWith("--dir=")) return arg.slice(6);
    }
    return undefined;
}

export function resolveHomeDir(
    env: Record<string, string | undefined> = process.env,
    argv: readonly string[] = []
): string {
    return resolve(parseDirArg(argv) || env.PIANOBE_HOME || ".");
}

function parseEnvValue(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length >= 2) {
        const quote = trimmed[0];
        if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
            const inner = trimmed.slice(1, -1);
            if (quote === '"') {
                return inner
                    .replace(/\\n/g, "\n")
                    .replace(/\\r/g, "\r")
                    .replace(/\\t/g, "\t")
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, "\\");
            }
            return inner;
        }
    }
    return trimmed;
}

/**
 * 读取 <homeDir>/.env 并补充到目标环境变量（不覆盖进程里已显式设置的变量）。
 * Bun 只会自动读取 cwd 下的 .env；通过 --dir / PIANOBE_HOME 指定外部目录时依赖此加载。
 */
export function loadHomeEnv(
    homeDir: string,
    targetEnv: Record<string, string | undefined> = process.env
): void {
    const envPath = join(homeDir, ".env");
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("export ")) line = line.slice(7).trim();
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        if (!key) continue;
        if (targetEnv[key] !== undefined) continue;
        targetEnv[key] = parseEnvValue(line.slice(eq + 1));
    }
}

/**
 * 读取配置。环境变量来自 .env（bun 自动加载或 loadHomeEnv）或进程环境。
 * 见 .env.example。
 */
export function loadConfig(
    env: Record<string, string | undefined> = process.env,
    argv: readonly string[] = []
): ServerConfig {
    const homeDir = resolveHomeDir(env, argv);
    const rawDbPath = env.DB_PATH?.trim();
    const resolvedDbPath =
        rawDbPath && rawDbPath !== ":memory:" ? resolve(homeDir, rawDbPath) : undefined;
    const dataDir = env.DATA_DIR?.trim()
        ? resolve(homeDir, env.DATA_DIR.trim())
        : resolvedDbPath
          ? dirname(resolvedDbPath)
          : join(homeDir, "data");
    const dbPath =
        rawDbPath === ":memory:" ? ":memory:" : (resolvedDbPath ?? join(dataDir, "piano.db"));
    const pluginsDir = env.PLUGINS_DIR?.trim()
        ? resolve(homeDir, env.PLUGINS_DIR.trim())
        : join(homeDir, "plugins");
    const logFile =
        env.LOG_FILE === "off"
            ? undefined
            : env.LOG_FILE?.trim()
              ? resolve(homeDir, env.LOG_FILE.trim())
              : join(homeDir, "logs", "server.log");

    return {
        port: Number(env.PORT ?? 3000),
        homeDir,
        dataDir,
        dbPath,
        pluginsDir,
        pluginRegistryUrl: env.PLUGIN_REGISTRY_URL?.trim() || undefined,
        serverTemplatePath: env.SERVER_TEMPLATE_PATH?.trim()
            ? resolve(homeDir, env.SERVER_TEMPLATE_PATH.trim())
            : undefined,
        bdsDir: env.BDS_DIR || undefined,
        bdsWorld: env.BDS_WORLD || undefined,
        bdsBpName: env.BDS_BP_NAME || "pianoServerBP",
        bdsRpName: env.BDS_RP_NAME || "pianoServerRP",
        bdsPackMode: env.BDS_PACK_MODE === "release" ? "release" : "development",
        packName: env.BDS_PACK_NAME || undefined,
        packDescription: env.BDS_PACK_DESCRIPTION || undefined,
        bootstrapToken: env.BOOTSTRAP_TOKEN || undefined,
        allowPublicRead: env.ALLOW_PUBLIC_READ === "true",
        webRoot: env.WEB_ROOT || undefined,
        amtCli: env.AMT_CLI || undefined,
        amtModel: env.AMT_MODEL || undefined,
        amtDecoder: env.AMT_DECODER === "ffmpeg" ? "ffmpeg" : "native",
        amtThreads: Math.max(1, Number(env.AMT_THREADS ?? 4) || 4),
        amtEco: env.AMT_ECO === "true",
        amtConcurrency: Math.max(1, Number(env.AMT_CONCURRENCY ?? 1) || 1),
        amtMaxQueue: Math.max(1, Number(env.AMT_MAX_QUEUE ?? 10) || 10),
        amtMaxAudioSeconds: Math.max(30, Number(env.AMT_MAX_AUDIO_SECONDS ?? 600) || 600),
        amtMaxDownloadBytes: Math.max(
            1024 * 1024,
            Number(env.AMT_MAX_DOWNLOAD_BYTES ?? 200 * 1024 * 1024) || 200 * 1024 * 1024
        ),
        amtTimeoutMs: Math.max(30_000, Number(env.AMT_TIMEOUT_MS ?? 600_000) || 600_000),
        npmRegistry: env.NPM_REGISTRY?.trim() || undefined,
        biliSessdata: env.BILI_SESSDATA || undefined,
        logFile,
        logLevel: parseLogLevel(env.LOG_LEVEL),
        logFormat: parseLogFormat(env.LOG_FORMAT),
        logMaxBytes: Math.max(64 * 1024, Number(env.LOG_MAX_BYTES ?? 10 * 1024 * 1024) || 10 * 1024 * 1024),
        logMaxFiles: Math.min(50, Math.max(1, Number(env.LOG_MAX_FILES ?? 7) || 7)),
    };
}
