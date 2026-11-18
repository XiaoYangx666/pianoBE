export interface ServerConfig {
    port: number;
    /** sqlite 文件路径（":memory:" 用于测试） */
    dbPath: string;
    /** 曲目内容目录（存 {id}.mid 源文件） */
    midisDir: string;
    /** 管理员引导令牌；未设置时首次启动自动生成并打印 */
    bootstrapToken?: string;
    /** 为 true 时公开读接口（曲目列表/曲目内容/公开播放列表）无需令牌 */
    allowPublicRead: boolean;
    /** web 构建产物静态目录（不存在则不托管） */
    webRoot?: string;
    /** amt-cli 可执行文件路径；默认在 ./amt/ 与 PATH 中查找 */
    amtCli?: string;
    /** AMT ONNX 模型路径；默认在 amt-cli 同目录与 ./amt/ 中查找 */
    amtModel?: string;
    /** amt-cli 解码器：native（纯 Rust，默认）或 ffmpeg（外部 ffmpeg） */
    amtDecoder: "native" | "ffmpeg";
    /** amt-cli 转录线程数（默认 4） */
    amtThreads: number;
    /** 使用 --eco 低负载模式（单线程 + 主动让出 CPU） */
    amtEco: boolean;
    /** 单次转录超时（默认 10 分钟） */
    amtTimeoutMs: number;
    /** B 站登录 Cookie（SESSDATA），仅高码率音轨需要 */
    biliSessdata?: string;
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
        midisDir: env.MIDIS_DIR ?? "./data/midis",
        bootstrapToken: env.BOOTSTRAP_TOKEN || undefined,
        allowPublicRead: env.ALLOW_PUBLIC_READ === "true",
        webRoot: env.WEB_ROOT || undefined,
        amtCli: env.AMT_CLI || undefined,
        amtModel: env.AMT_MODEL || undefined,
        amtDecoder: env.AMT_DECODER === "ffmpeg" ? "ffmpeg" : "native",
        amtThreads: Math.max(1, Number(env.AMT_THREADS ?? 4) || 4),
        amtEco: env.AMT_ECO === "true",
        amtTimeoutMs: Math.max(30_000, Number(env.AMT_TIMEOUT_MS ?? 600_000) || 600_000),
        biliSessdata: env.BILI_SESSDATA || undefined,
    };
}
