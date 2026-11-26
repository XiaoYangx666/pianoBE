import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setDiagnosticSink } from "@piano/core";
import { openDb } from "./db.js";
import { loadConfig, loadHomeEnv, resolveHomeDir } from "./config.js";
import { ensureBootstrapToken, migrateLegacyRoles } from "./auth.js";
import { createLogger } from "./logger.js";
import { SqliteSongPort } from "./drivers/sqlitePorts.js";
import { createApp } from "./app.js";
import { AmtService } from "./services/amt.js";
import { TranscribeJobStore } from "./services/transcribeJobs.js";
import { PluginService } from "./services/plugins.js";
import { DeploymentService } from "./services/deployment.js";

const argv = process.argv.slice(2);
loadHomeEnv(resolveHomeDir(process.env, argv), process.env);
const config = loadConfig(process.env, argv);
const log = createLogger({
    file: config.logFile,
    level: config.logLevel,
    format: config.logFormat,
    maxBytes: config.logMaxBytes,
    maxFiles: config.logMaxFiles,
});
// core 内部的诊断也进入同一套文件/级别/脱敏规则
setDiagnosticSink((level, scope, message, error, fields) => {
    const target = log.scope(scope);
    if (level === "error") target.error(message, error, fields);
    else if (level === "warn") target.warn(message, error, fields);
    else if (level === "info") target.info(message, fields);
    else target.debug(message, fields);
});

// 崩溃也要留痕：Windows 下双击启动时控制台会直接关闭，只有日志文件能事后排查
process.on("uncaughtException", (error) => {
    log.error("未捕获异常，进程退出", error);
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    log.error("未处理的 Promise 拒绝", reason);
});

if (!config.webRoot) {
    // 单文件发行版（不同 Bun 版本 $bunfs 深度可能为 root / root/server/src）与源码运行路径
    // 单文件发行版内嵌 web/ 的路径深度随 Bun 版本变化，仍排在最前；
    // 源码运行时 packages/web 是玩家网页版入口（引用 /src/main.tsx），必须让位于构建产物。
    const candidates = [
        resolve(import.meta.dir, "web"),
        resolve(import.meta.dir, "../web"),
        resolve(import.meta.dir, "../../../web"),
        resolve(import.meta.dir, "../../studio/dist-server"),
        resolve(import.meta.dir, "../../../packages/studio/dist-server"),
        resolve(import.meta.dir, "../../studio/dist"),
        resolve(import.meta.dir, "../../web"),
    ];
    config.webRoot = candidates.find((dir) => existsSync(resolve(dir, "index.html")));
}

const db = openDb(config.dbPath);
const { token, generated } = ensureBootstrapToken(db, config.bootstrapToken);
const migratedRoles = migrateLegacyRoles(db);
if (migratedRoles > 0) {
    log.warn(`已把 ${migratedRoles} 个旧 read/write 令牌迁移为 user（曲库写权限请使用 admin 令牌）`);
}
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

const songPort = new SqliteSongPort(db, log.scope("db"));
const pluginService = new PluginService(songPort, config, log.scope("plugins"));
pluginService.syncDirectory();
const deploymentService = new DeploymentService(songPort, pluginService, config);
const amt = new AmtService(config);
const amtStatus = amt.status();
if (amtStatus.available) {
    log.info(`AMT 转录已启用: ${amtStatus.cli} (model=${amtStatus.model})`);
} else {
    log.warn(`AMT 转录未启用: ${amtStatus.message}`);
}

const transcribeJobs = new TranscribeJobStore({
    songPort,
    config,
    amt,
    logger: log.scope("transcribe"),
});

const app = createApp({ db, songPort, config, amt, pluginService, deploymentService, logger: log, transcribeJobs });

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

log.info(`PianoBE server: http://0.0.0.0:${config.port}`, {
    home: config.homeDir,
    data: config.dataDir,
    plugins: config.pluginsDir,
    db: config.dbPath,
    logLevel: config.logLevel,
    format: config.logFormat,
    ...(config.pluginRegistryUrl ? { pluginRegistry: config.pluginRegistryUrl } : {}),
});
if (log.file) {
    log.info(`日志文件: ${log.file}`, {
        maxBytes: config.logMaxBytes,
        maxFiles: config.logMaxFiles,
    });
} else {
    log.info("日志文件已关闭（LOG_FILE=off），仅输出到控制台");
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`收到 ${signal}，正在关闭…`);
    try {
        server.stop(true);
    } catch {
        // 关闭监听失败不影响进程退出
    }
    // 兜底：即使子进程/网络请求卡住，也要在限定时间内退出
    const forceExit = setTimeout(() => {
        log.warn("转录任务未在 10 秒内结束，强制退出");
        process.exit(1);
    }, 10_000);
    try {
        // 终止 AMT 子进程，等待任务真正停止后再清理本实例的任务目录。
        await transcribeJobs.dispose();
    } catch (error) {
        log.warn("转录任务清理失败", error);
    } finally {
        clearTimeout(forceExit);
    }
    try {
        db.close();
    } catch {
        // 数据库已关闭或正被占用时忽略
    }
    process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
