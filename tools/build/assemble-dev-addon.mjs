#!/usr/bin/env bun
/**
 * 本地开发包装配器：基于零插件基础模板（template.mcaddon），
 * 自动注入 build/plugins/*.pbeplugin 全部官方插件与曲库，生成开发包（dev.mcaddon）
 * 或复制到本地 Minecraft 开发目录。
 *
 * 用法：
 *   bun tools/build/assemble-dev-addon.mjs [--pack] [--copy] [--base] [--repack-plugins] [--target <gameRoot>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";
import { assembleAddonTemplate, extractPackFiles, loadAddonTemplate } from "@piano/assembly";
import { readPbePluginArchive } from "@piano/vfx/package";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const wantCopy = args.includes("--copy");
const wantPack = args.includes("--pack") || !wantCopy;
const baseOnly = args.includes("--base");
const repackPlugins = args.includes("--repack-plugins");
const targetIdx = args.indexOf("--target");
const targetArg = targetIdx >= 0 ? args[targetIdx + 1] : undefined;

const templatePath = join(root, "packages/addon/dist/template.mcaddon");
if (!existsSync(templatePath)) {
    throw new Error(`未找到零插件底包：${templatePath}（请先运行 npm run build:template）`);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pluginsDir = join(root, "build/plugins");

function loadAllPluginArchives() {
    if (baseOnly) return [];
    const hasPacked =
        existsSync(pluginsDir) &&
        readdirSync(pluginsDir).some((name) => name.endsWith(".pbeplugin"));
    if (!hasPacked || repackPlugins) {
        console.log("▶ 打包本地插件与官方曲库...");
        execFileSync(npm, ["run", "build:plugins"], { cwd: root, stdio: "inherit" });
        execFileSync(npm, ["run", "pack:plugins"], { cwd: root, stdio: "inherit" });
    }
    const files = existsSync(pluginsDir)
        ? readdirSync(pluginsDir)
              .filter((name) => name.endsWith(".pbeplugin"))
              .sort()
        : [];
    return files.map((file) =>
        readPbePluginArchive(new Uint8Array(readFileSync(join(pluginsDir, file)))),
    );
}

function detectGameRoot() {
    if (targetArg) return resolve(targetArg);
    if (process.env.MC_DEV_DIR?.trim()) return resolve(process.env.MC_DEV_DIR.trim());
    if (process.platform === "win32") {
        const candidates = [
            process.env.APPDATA
                ? join(process.env.APPDATA, "Minecraft Bedrock/Users/Shared/games/com.mojang")
                : undefined,
            process.env.LOCALAPPDATA
                ? join(
                      process.env.LOCALAPPDATA,
                      "Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang",
                  )
                : undefined,
        ].filter(Boolean);
        return candidates.find((dir) => existsSync(dir));
    }
    return existsSync("/server/server1") ? "/server/server1" : undefined;
}

function writePackDir(parentDir, folderName, files) {
    const dest = join(parentDir, folderName);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const [relPath, bytes] of files) {
        const out = join(dest, relPath);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, bytes);
    }
}

const rawTemplate = new Uint8Array(readFileSync(templatePath));
const storedTemplate = zipSync(unzipSync(rawTemplate), { level: 0 });
const info = await loadAddonTemplate(storedTemplate);
const plugins = loadAllPluginArchives();

const assembled = assembleAddonTemplate(info, [], {
    plugins,
    embedSongs: !baseOnly,
    randomUuid: false,
});

console.log(
    `[dev-addon] 已装配 ${assembled.installedPlugins.length} 个插件` +
        (baseOnly ? "（纯净模式）" : "（含全部本地插件与曲库）"),
);

if (wantPack) {
    const outFile = join(root, "packages/addon/dist", baseOnly ? "dev-base.mcaddon" : "dev.mcaddon");
    const bytes = await assembled.addon.toBytes();
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, bytes);
    console.log(`✓ ${outFile} (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB)`);
}

if (wantCopy) {
    const gameRoot = detectGameRoot();
    if (!gameRoot) {
        console.warn("⚠ 未找到本地 Minecraft 开发目录（可通过 --target 或 MC_DEV_DIR 指定），已跳过复制");
    } else {
        const { bpFiles, rpFiles } = extractPackFiles(
            assembled.addon,
            assembled.bpPath,
            assembled.rpPath,
        );
        const bpParent = join(gameRoot, "development_behavior_packs");
        const rpParent = join(gameRoot, "development_resource_packs");
        const bpName = process.platform === "linux" ? "pianoBP" : "pianobe-p88-bp";
        const rpName = process.platform === "linux" ? "pianoRP" : "pianobe-p88-rp";
        writePackDir(bpParent, bpName, bpFiles);
        writePackDir(rpParent, rpName, rpFiles);
        console.log(`✓ 已部署开发包到 ${gameRoot} (${bpName} / ${rpName})`);
    }
}
