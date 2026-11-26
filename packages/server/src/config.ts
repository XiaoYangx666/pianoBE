import { parseLogFormat, parseLogLevel, type LogFormat, type LogLevel } from "./logger.js";

export interface ServerConfig {
    port: number;
    /** sqlite 文件路径（":memory:" 用于测试） */
    dbPath: string;
    /** 插件存储目录（存 {id}.pbeplugin 归档） */
    pluginsDir: string;
    /** 内置插件目录（可选，默认尝试 ../../build/plugins） */
    builtinPluginsDir?: string;
    /** 可选钢琴音色包目录（默认尝试 webRoot/timbres 或 studio/public/timbres） */
    timbresDir?: string;
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
    /** B 站登录 Cookie（SESSDATA），仅高码率音轨需要 */
    biliSessdata?: string;
    /** 日志文件路径；设为 off 时只输出到控制台（默认 ./data/logs/server.log） */
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

/**
 * 读取配置。环境变量来自 .env（bun 自动加载）或进程环境。
 * 见 .env.example。
 */
export function loadConfig(
    env: Record<string, string | undefined> = process.env
): ServerConfig {
    return {
        port: Number(env.PORT ?? 3000),
        dbPath: env.DB_PATH ?? "./data/piano.db",
        pluginsDir: env.PLUGINS_DIR ?? "./data/plugins",
        builtinPluginsDir: env.BUILTIN_PLUGINS_DIR || undefined,
        timbresDir: env.TIMBRES_DIR || undefined,
        serverTemplatePath: env.SERVER_TEMPLATE_PATH || undefined,
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
        biliSessdata: env.BILI_SESSDATA || undefined,
        logFile:
            env.LOG_FILE === "off"
                ? undefined
                : env.LOG_FILE || "./data/logs/server.log",
        logLevel: parseLogLevel(env.LOG_LEVEL),
        logFormat: parseLogFormat(env.LOG_FORMAT),
        logMaxBytes: Math.max(64 * 1024, Number(env.LOG_MAX_BYTES ?? 10 * 1024 * 1024) || 10 * 1024 * 1024),
        logMaxFiles: Math.min(50, Math.max(1, Number(env.LOG_MAX_FILES ?? 7) || 7)),
    };
}
