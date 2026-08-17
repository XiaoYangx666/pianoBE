import { openDb } from "./db.js";
import { loadConfig } from "./config.js";
import { ensureBootstrapToken } from "./auth.js";
import { SqlitePlaylistPort, SqliteSongPort } from "./drivers/sqlitePorts.js";
import { createApp } from "./app.js";
import { PlaylistStore } from "@piano/core";

const config = loadConfig();
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
const playlistStore = new PlaylistStore(new SqlitePlaylistPort(db));

const app = createApp({ db, songPort, playlistStore, config });

console.log(`PianoBE server: http://0.0.0.0:${config.port} (db=${config.dbPath})`);
Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
});