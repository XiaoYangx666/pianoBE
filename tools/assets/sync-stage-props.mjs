import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { validatePluginManifest } from "@piano/vfx";
import {
    assembleStageProp, readStagePropFiles, serializeStagePropCatalog,
    STAGE_PROP_BP_TREE, STAGE_PROP_RP_TREES, STAGE_PROP_REGISTRY_SCRIPT,
} from "@piano/vfx/package";

const root = fileURLToPath(new URL("../../", import.meta.url));
const addon = join(root, "packages/addon");
const plugins = join(root, "plugins");
const bp = new Map();
const rp = new Map();
const catalog = [];

if (!process.argv.includes("--host-only")) {
    for (const entry of readdirSync(plugins, { withFileTypes: true })) {
        const dir = join(plugins, entry.name);
        const manifestPath = join(dir, "plugin.json");
        if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
        const manifest = validatePluginManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
        const read = path => existsSync(join(dir, path)) ? readFileSync(join(dir, path)) : undefined;
        for (const prop of readStagePropFiles(manifest, read)) {
            const assets = assembleStageProp(prop, read);
            for (const [target, source] of [[bp, assets.bp], [rp, assets.rp]]) {
                for (const [path, content] of source) {
                    if (target.has(path)) throw new Error(`内置舞台道具资源冲突：${path}`);
                    target.set(path, content);
                }
            }
            catalog.push(prop.registration);
        }
    }
}

for (const [pack, directories, files] of [["bp", [STAGE_PROP_BP_TREE], bp], ["rp", STAGE_PROP_RP_TREES, rp]]) {
    for (const directory of directories) {
        const target = join(addon, pack, directory);
        mkdirSync(target, { recursive: true });
        for (const entry of readdirSync(target, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.startsWith("pbe_stage_prop_") || files.has(directory + entry.name)) continue;
            unlinkSync(join(target, entry.name));
        }
    }
    for (const [path, content] of files) writeFileSync(join(addon, pack, path), content);
}

const output = join(root, "build/stage-props", STAGE_PROP_REGISTRY_SCRIPT);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, serializeStagePropCatalog(catalog));
// Preserve the public Core named exports that the addon compiler may inline internally.
await build({
    entryPoints: [join(root, "packages/core/src/index.ts")],
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    outfile: join(dirname(output), "core.js"),
});
console.log(`Synced ${catalog.length} built-in VFX stage props`);
