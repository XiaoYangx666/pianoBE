#!/usr/bin/env node
/**
 * MIDI / 曲库工具统一入口。
 *
 *   npm run midi -- <命令> [参数...]
 *
 * 命令：
 *   convert              全量重建 midis/js 与 midis/library
 *   add-song <路径...>   增量添加/更新曲目
 *   show-song <关键词>   查询曲目信息
 *   export-performance   导出演出描述（PBE3 → performance）
 *   import-midis         批量上传到 BDS 后端曲库
 *   bench                PBE3 体积 / SongCache 基准
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [command, ...rest] = process.argv.slice(2);

const commands = {
    convert: ["node", "tools/midi/convert.js"],
    "add-song": ["node", "tools/midi/add-song.mjs"],
    "show-song": ["node", "tools/midi/show-song.mjs"],
    "export-performance": ["node", "tools/midi/export-performance.mjs"],
    "import-midis": ["node", "tools/midi/import-midis.mjs"],
    bench: ["node", "tools/midi/bench-pbe3.mjs"],
};

const usage = [
    "用法：npm run midi -- <命令> [参数...]",
    "",
    ...Object.entries(commands).map(([name, [, file]]) => `  ${name.padEnd(18)} ${file}`),
].join("\n");

if (!command || command === "help" || command === "--help") {
    console.log(usage);
    process.exit(command ? 0 : 1);
}

const entry = commands[command];
if (!entry) {
    console.error(`未知命令：${command}\n\n${usage}`);
    process.exit(1);
}

const [bin, ...args] = entry;
const result = spawnSync(bin === "node" ? process.execPath : bin, [...args, ...rest], {
    cwd: root,
    stdio: "inherit",
});
process.exit(result.status ?? 1);
