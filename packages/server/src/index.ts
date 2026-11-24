import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "./db.js";
import { loadConfig } from "./config.js";
import { ensureBootstrapToken } from "./auth.js";
import { SqliteSongPort } from "./drivers/sqlitePorts.js";
import { createApp } from "./app.js";
import { AmtService } from "./services/amt.js";
import { PluginService } from "./services/plugins.js";
import { DeploymentService } from "./services/deployment.js";

const config = loadConfig();
if (!config.webRoot) {
    const studioDist = resolve(import.meta.dir, "../../studio/dist");
    const webDist = resolve(import.meta.dir, "../../web/dist");
    if (existsSync(studioDist)) config.webRoot = studioDist;
    else if (existsSync(webDist)) config.webRoot = webDist;
}

const db = openDb(config.dbPath);
const { token, generated } = ensureBootstrapToken(db, config.bootstrapToken);
if (generated) {
    console.log("===============================================");
    console.log(" 未设置 BOOTSTRAP_TOKEN，已自动生成管理员令牌：");
    console.log(` ${generated}`);
    console.log(" 请立即保存（下次可通过环境变量重置）");
    console.log("===============================================");
} else if (token) {
    console.log(`bootstrap 管理员令牌已就绪 (${token.slice(0, 8)}…)`);
}

const songPort = new SqliteSongPort(db, config.midisDir);
const pluginService = new PluginService(songPort, config);
const deploymentService = new DeploymentService(songPort, pluginService, config);
const amt = new AmtService(config);
const amtStatus = amt.status();
if (amtStatus.available) {
    console.log(`AMT 转录已启用: ${amtStatus.cli} (model=${amtStatus.model})`);
} else {
    console.warn(`AMT 转录未启用: ${amtStatus.message}`);
}

const app = createApp({ db, songPort, config, amt, pluginService, deploymentService });

console.log(`PianoBE server: http://0.0.0.0:${config.port} (db=${config.dbPath})`);
Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
});
