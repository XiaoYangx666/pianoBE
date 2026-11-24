import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "./db.js";
import { loadConfig } from "./config.js";
import { ensureBootstrapToken } from "./auth.js";
import { createLogger } from "./logger.js";
import { SqliteSongPort } from "./drivers/sqlitePorts.js";
import { createApp } from "./app.js";
import { AmtService } from "./services/amt.js";
import { PluginService } from "./services/plugins.js";
import { DeploymentService } from "./services/deployment.js";

const config = loadConfig();
const log = createLogger({ file: config.logFile });

// 崩溃也要留痕：Windows 下双击启动时控制台会直接关闭，只有日志文件能事后排查
process.on("uncaughtException", (error) => {
    log.error("未捕获异常，进程退出", error);
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    log.error("未处理的 Promise 拒绝", reason);
});

if (!config.webRoot) {
    const studioDist = resolve(import.meta.dir, "../../studio/dist");
    const webDist = resolve(import.meta.dir, "../../web/dist");
    if (existsSync(studioDist)) config.webRoot = studioDist;
    else if (existsSync(webDist)) config.webRoot = webDist;
}

const db = openDb(config.dbPath);
const { token, generated } = ensureBootstrapToken(db, config.bootstrapToken);
if (generated) {
    // 令牌只打到控制台，不写日志文件
    console.log("===============================================");
    console.log(" 未设置 BOOTSTRAP_TOKEN，已自动生成管理员令牌：");
    console.log(` ${generated}`);
    console.log(" 请立即保存（下次可通过环境变量重置）");
    console.log("===============================================");
    log.warn("未设置 BOOTSTRAP_TOKEN，已自动生成管理员令牌（仅控制台显示，请立即保存）");
} else if (token) {
    log.info(`bootstrap 管理员令牌已就绪 (${token.slice(0, 8)}…)`);
}

const songPort = new SqliteSongPort(db, config.midisDir);
if (songPort.legacyImported > 0) {
    log.info(`已把 ${songPort.legacyImported} 个旧版曲目文件导入 SQLite（原文件已删除）`);
}
const pluginService = new PluginService(songPort, config);
const deploymentService = new DeploymentService(songPort, pluginService, config);
const amt = new AmtService(config);
const amtStatus = amt.status();
if (amtStatus.available) {
    log.info(`AMT 转录已启用: ${amtStatus.cli} (model=${amtStatus.model})`);
} else {
    log.warn(`AMT 转录未启用: ${amtStatus.message}`);
}

const app = createApp({ db, songPort, config, amt, pluginService, deploymentService, logger: log });

const server = Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
    // Hono 之外的兜底异常（例如静态文件读取失败）
    error: (error) => {
        log.error("请求处理异常", error);
        return new Response(JSON.stringify({ error: "服务器内部错误" }), {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
        });
    },
});

log.info(`PianoBE server: http://0.0.0.0:${config.port} (db=${config.dbPath})`);
if (log.file) {
    log.info(`日志文件: ${log.file}（单文件 5 MB，自动轮转保留 3 个）`);
} else {
    log.info("日志文件已关闭（LOG_FILE=off），仅输出到控制台");
}

let shuttingDown = false;
function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`收到 ${signal}，正在关闭…`);
    try {
        server.stop(true);
    } catch {
        // 关闭监听失败不影响进程退出
    }
    try {
        db.close();
    } catch {
        // 数据库已关闭或正被占用时忽略
    }
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
