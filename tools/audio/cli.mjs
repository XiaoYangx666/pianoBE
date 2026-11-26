#!/usr/bin/env node
/**
 * 音频实验/分析工具统一入口。
 *
 *   npm run audio-lab -- <命令>
 *
 * 命令：
 *   assets   生成 Audio Lab 试听素材
 *   render   渲染音色对比音频
 *   report   客观分析并生成报告（需要 python3）
 *   voices   离线声部负载模拟
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [command] = process.argv.slice(2);

const commands = {
    assets: ["node", "tools/audio/build-audio-lab-assets.mjs"],
    render: ["node", "tools/audio/audio-lab-render.mjs"],
    report: [process.env.PYTHON || "python3", "tools/audio/audio-lab-analyze.py"],
    voices: ["node", "tools/audio/analyze-voice-load.mjs"],
};

const usage = [
    "用法：npm run audio-lab -- <命令>",
    "",
    ...Object.entries(commands).map(([name, [bin, file]]) => `  ${name.padEnd(8)} ${file}${bin.startsWith("python") ? "（python）" : ""}`),
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
const result = spawnSync(bin === "node" ? process.execPath : bin, args, {
    cwd: root,
    stdio: "inherit",
});
process.exit(result.status ?? 1);
