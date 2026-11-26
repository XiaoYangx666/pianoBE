/**
 * 本地直接部署到 BDS：不经过 HTTP，不传文件。
 * 把构建产物复制为本机模板，然后装配插件/音色/曲谱写入 BDS 目录。
 *
 * 用法（在 packages/server 下运行，方便自动加载 .env）：
 *   bun src/cli/deploy.ts [--file ../../packages/addon/dist/server.mcaddon]
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, loadHomeEnv, resolveHomeDir } from "../config.js";
import { openDb } from "../db.js";
import { SqliteSongPort } from "../drivers/sqlitePorts.js";
import { PluginService } from "../services/plugins.js";
import { DeploymentService } from "../services/deployment.js";

function argValue(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index >= 0) return process.argv[index + 1];
    const inline = process.argv.find((item) => item.startsWith(`${name}=`));
    return inline?.slice(name.length + 1);
}

const argv = process.argv.slice(2);
loadHomeEnv(resolveHomeDir(process.env, argv), process.env);
const config = loadConfig(process.env, argv);
const file = resolve(argValue("--file") ?? "../../packages/addon/dist/server.mcaddon");
if (!existsSync(file)) {
    console.error(`找不到模板：${file}（先 npm run build:server，或去掉 --skip-build）`);
    process.exit(1);
}

const db = openDb(config.dbPath);
const songPort = new SqliteSongPort(db);
const pluginService = new PluginService(songPort, config);
pluginService.syncDirectory();
const deployment = new DeploymentService(songPort, pluginService, config);

const bytes = new Uint8Array(readFileSync(file));
deployment.saveServerTemplate(bytes);
console.log(
    `模板已就位：${file}（${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB，` +
        `${statSync(file).mtime.toLocaleString("zh-CN")}）`,
);

const status = await deployment.deployToBds();
console.log(
    `部署完成：status=${status.status} configHash=${status.deployedConfigHash ?? "-"} ` +
        `plugins=${status.deployedPlugins?.length ?? 0} warnings=${status.warnings.length}`,
);
const { bdsDir, bdsWorld, bdsPackMode, bdsBpName, bdsRpName } = status.bdsConfig ?? {};
if (bdsDir) console.log(`目标：${bdsDir} · 世界 ${bdsWorld ?? "-"} · ${bdsPackMode} · ${bdsBpName}/${bdsRpName}`);
for (const issue of status.issues) console.log(`问题：${issue}`);
for (const warning of status.warnings) console.log(`提示：${warning}`);
console.log("部署只写文件；重启 BDS 实例或重进世界后新包才会加载。");
