import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { validatePluginManifest } from "@piano/vfx";
import { readPbePluginArchive, writePbePluginArchive } from "@piano/vfx/package";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSET_TREES = ["particles", "textures", "preview", "stage_props"];

function collectDirFiles(baseDir, relPrefix, out) {
    const dir = join(baseDir, relPrefix);
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${relPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
            collectDirFiles(baseDir, rel, out);
        } else {
            out[rel] = readFileSync(join(baseDir, rel));
        }
    }
}

export async function packPluginDirectory(pluginDir) {
    const absDir = resolve(pluginDir);
    const manifestPath = join(absDir, "plugin.json");
    if (!existsSync(manifestPath)) {
        throw new Error(`插件目录缺少 plugin.json：${absDir}`);
    }
    const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifest = validatePluginManifest(rawManifest);

    const files = {
        "plugin.json": `${JSON.stringify(manifest, null, 4)}\n`,
    };

    const tsEntry = join(absDir, "vfx", "index.ts");
    const jsEntry = join(absDir, "vfx", "index.js");
    const entry = existsSync(tsEntry) ? tsEntry : existsSync(jsEntry) ? jsEntry : undefined;

    if (entry) {
        const result = await esbuild({
            entryPoints: [entry],
            bundle: true,
            format: "esm",
            target: "es2022",
            platform: "neutral",
            mainFields: ["module", "main"],
            external: ["@piano/vfx", "@piano/core"],
            write: false,
            logLevel: "silent",
        });
        if (!result.outputFiles.length) {
            throw new Error(`插件 ${manifest.id} 打包未生成 vfx/index.js`);
        }
        files["vfx/index.js"] = result.outputFiles[0].contents;
    } else if (manifest.capabilities.includes("vfx")) {
        throw new Error(`VFX 插件 ${manifest.id} 缺少 vfx/index.ts 或 vfx/index.js`);
    }

    for (const tree of ASSET_TREES) {
        collectDirFiles(absDir, tree, files);
    }

    const bytes = writePbePluginArchive(files);
    const verified = readPbePluginArchive(bytes);
    return { manifest: verified.manifest, bytes, fileCount: verified.files.size };
}

export function listBuiltinPluginDirs(pluginsRoot = join(root, "plugins")) {
    if (!existsSync(pluginsRoot)) return [];
    return readdirSync(pluginsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== "dist" && entry.name !== "node_modules")
        .map(entry => join(pluginsRoot, entry.name))
        .filter(dir => existsSync(join(dir, "plugin.json")));
}

async function main() {
    const args = process.argv.slice(2);
    let outDir = join(root, "build/plugins");
    let packAll = false;
    const targets = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--all") packAll = true;
        else if (arg === "--out") {
            const next = args[++i];
            if (!next) throw new Error("--out 需要提供输出目录");
            outDir = resolve(root, next);
        } else {
            targets.push(resolve(root, arg));
        }
    }

    const dirs = packAll ? listBuiltinPluginDirs() : targets;
    if (!dirs.length) {
        console.error("用法: bun tools/plugins/pack-plugin.mjs <pluginDir | --all> [--out <dir>]");
        process.exit(1);
    }

    mkdirSync(outDir, { recursive: true });
    for (const dir of dirs) {
        const { manifest, bytes, fileCount } = await packPluginDirectory(dir);
        const outPath = join(outDir, `${manifest.id}.pbeplugin`);
        writeFileSync(outPath, bytes);
        console.log(`[pack-plugin] ${manifest.id} v${manifest.version} -> ${outPath} (${(bytes.byteLength / 1024).toFixed(1)} KB, ${fileCount} files)`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
