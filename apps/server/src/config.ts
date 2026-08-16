export interface ServerConfig {
    port: number;
    /** sqlite 文件路径（":memory:" 用于测试） */
    dbPath: string;
    /** 管理员引导令牌；未设置时首次启动自动生成并打印 */
    bootstrapToken?: string;
    /** 为 true 时公开读接口（曲目列表/曲目内容/公开播放列表）无需令牌 */
    allowPublicRead: boolean;
    /** web 构建产物静态目录（不存在则不托管） */
    webRoot?: string;
}

export function loadConfig(
    env: Record<string, string | undefined> = process.env
): ServerConfig {
    return {
        port: Number(env.PORT ?? 3000),
        dbPath: env.DB_PATH ?? "./data/piano.db",
        bootstrapToken: env.BOOTSTRAP_TOKEN || undefined,
        allowPublicRead: env.ALLOW_PUBLIC_READ === "true",
        webRoot: env.WEB_ROOT || undefined,
    };
}