import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { DeploymentService, resolveServerTemplate } from "./services/deployment.js";

// 版本号：单文件产物由构建脚本注入；源码运行读 packages/server/package.json
declare const __PIANOBE_VERSION__: string | undefined;

function readVersion(): string {
    if (typeof __PIANOBE_VERSION__ !== "undefined") return __PIANOBE_VERSION__;
    try {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
            version?: unknown;
        };
        return typeof pkg.version === "string" ? pkg.version : "0.0.0";
    } catch {
        return "0.0.0";
    }
}

const argv = process.argv.slice(2);
if (argv.includes("--version")) {
    console.log(`pianobe-server ${readVersion()} (${process.platform}-${process.arch})`);
    process.exit(0);
}
loadHomeEnv(resolveHomeDir(process.env, argv), process.env);
const config = loadConfig(process.env, argv);
// 前端目录不做运行时候选探测，三种运行形态各有确定来源：
//   1. WEB_ROOT（环境变量 / .env）：显式指定，Docker 与本地源码部署都用这个
//   2. 单文件产物：构建脚本 __PIANOBE_WEB__ 注入内嵌目录（$bunfs/root/web）
//   3. 仓库内直接运行：固定为 packages/studio/dist
// 这段放在建日志器之前，好让 --check-assets 只输出结果供构建脚本自检。
declare const __PIANOBE_WEB__: string | undefined;
const checkAssets = argv.includes("--check-assets") || argv.includes("--check-web");
const explicitWebRoot = config.webRoot;
if (explicitWebRoot) {
    config.webRoot = resolve(explicitWebRoot);
} else {
    config.webRoot =
        typeof __PIANOBE_WEB__ !== "undefined"
            ? resolve(import.meta.dir, __PIANOBE_WEB__)
            : resolve(import.meta.dir, "../../studio/dist");
}
const resolvedWebRoot = config.webRoot;
let webNote = `前端目录: ${resolvedWebRoot}${explicitWebRoot ? "（WEB_ROOT）" : ""}`;
let webError: string | undefined;
if (!existsSync(resolve(resolvedWebRoot, "index.html"))) {
    webError = explicitWebRoot
        ? `WEB_ROOT 无效：${resolvedWebRoot} 下没有 index.html`
        : `前端未构建：${resolvedWebRoot} 下没有 index.html（先 npm run build:studio，或用 WEB_ROOT 指定）`;
    if (explicitWebRoot && !checkAssets) {
        console.error(webError);
        process.exit(1);
    }
    if (!checkAssets) {
        webNote = webError;
        config.webRoot = undefined;
    }
}
if (checkAssets) {
    const template = resolveServerTemplate(config);
    console.log(`web=${config.webRoot ?? "missing"}${webError ? " (invalid)" : ""}`);
    console.log(`template=${template.path ?? "missing"}${template.source ? ` (${template.source})` : ""}`);
    if (webError) console.error(webError);
    process.exit(webError || !template.path ? 1 : 0);
}

const log = createLogger({
    file: config.logFile,
    level: config.logLevel,
    format: config.logFormat,
    maxBytes: config.logMaxBytes,
    maxFiles: config.logMaxFiles,
});
if (webNote) {
    if (config.webRoot) log.info(webNote);
    else log.warn(webNote);
}
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

const db = openDb(config.dbPath);
const { token, generated } = ensureBootstrapToken(db, config.bootstrapToken);
const migratedRoles = migrateLegacyRoles(db);
if (migratedRoles > 0) {
    log.warn(`已把 ${migratedRoles} 个旧 read/write 令牌迁移为 user（曲库写权限请使用 admin 令牌）`);
}
if (generated) {
    // 令牌明文只落盘一份（600）；日志只记路径，避免进入日志文件或 supervisor 输出。
    // 没有 TTY 时（nohup/服务托管）控制台也拿不到，只能靠这个文件。
    const tokenFile = join(config.dataDir, "bootstrap-token.txt");
    writeFileSync(tokenFile, `${generated}\n`, { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    console.log("===============================================");
    console.log(" 未设置 BOOTSTRAP_TOKEN，已自动生成管理员令牌");
    if (process.stdout.isTTY) console.log(` ${generated}`);
    console.log(` 已写入：${tokenFile}（权限 600，登录后请删除）`);
    console.log("===============================================");
    log.warn(`已自动生成管理员令牌并写入 ${tokenFile}（权限 600，登录后请删除）`);
} else if (token) {
    log.info(`bootstrap 管理员令牌已就绪 (${token.slice(0, 8)}…)`);
}

const songPort = new SqliteSongPort(db, log.scope("db"));
const pluginService = new PluginService(songPort, config, log.scope("plugins"));
pluginService.syncDirectory();
const deploymentService = new DeploymentService(songPort, pluginService, config);
const template = resolveServerTemplate(config);
if (template.path) {
    log.info(`服务器底包: ${template.path}（${template.source}）`);
} else {
    log.warn("未找到服务器底包 server.mcaddon：请先构建模板或从管理页上传，否则无法装配部署包");
}
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
