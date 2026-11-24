/**
 * 将完整 template.mcaddon 裁剪为“零插件基础模板”（template-bare.mcaddon）：
 * - 保留完整 VFX Host API（scripts/vfx/host.js）及公共绘制资源（vfx_lab 与 17 个宿主粒子）
 * - 移除 scripts/plugins/ 中的全部内置插件代码
 * - 将 scripts/vfx/plugins.js 替换为空注册列表
 * - 移除由插件归属的粒子文档与纹理（如 plugins/keys 下的琴键专属粒子与 piano_fx* 贴图）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AddonTemplate } from "@bepack/addon";
import { writeAddonFile } from "@bepack/addon/node";
import { unzipSync } from "fflate";
import {
    serializeStagePropCatalog, STAGE_PROP_BP_TREE, STAGE_PROP_RP_TREES, STAGE_PROP_REGISTRY_SCRIPT,
} from "@piano/vfx/package";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inputPath = resolve(root, process.argv[2] ?? "packages/addon/dist/template.mcaddon");
const outputPath = resolve(root, process.argv[3] ?? "packages/addon/dist/template-bare.mcaddon");

function collectPluginOwnedAssets(pluginsRoot) {
    const owned = new Set();
    if (!existsSync(pluginsRoot)) return owned;

    const walk = (baseDir, relPrefix) => {
        const dir = join(baseDir, relPrefix);
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const rel = `${relPrefix}/${entry.name}`;
            if (entry.isDirectory()) walk(baseDir, rel);
            else owned.add(rel);
        }
    };

    for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "dist" || entry.name === "node_modules") continue;
        const pluginDir = join(pluginsRoot, entry.name);
        walk(pluginDir, "particles");
        walk(pluginDir, "textures");
    }
    return owned;
}

// The input is a build artifact. Inflate it synchronously to avoid one Bun worker per packed file.
const files = Object.entries(unzipSync(readFileSync(inputPath)))
    .filter(([path]) => !path.endsWith("/"))
    .map(([path, bytes]) => ({ path, bytes }));
const addon = new AddonTemplate(basename(inputPath), files);
const bp = addon.packs.bp;
const rp = addon.packs.rp;
if (!bp || !rp) throw new Error("模板不完整：未找到 bp/rp manifest");

const bpPath = bp.root;
const rpPath = rp.root;
const hostPath = `${bpPath}scripts/vfx/host.js`;
if (!addon.has(hostPath)) {
    throw new Error(`模板缺少 ${hostPath}，无法生成零插件基础模板`);
}

let removedScripts = 0;
for (const prefix of [`${bpPath}scripts/plugins/`, `${bpPath}scripts/vfx/plugins/`]) {
    removedScripts += addon.entries().filter(entry => entry.path.startsWith(prefix)).length;
    addon.removeTree(prefix);
}

const pluginsEntry = `${bpPath}scripts/vfx/plugins.js`;
addon.writeText(
    pluginsEntry,
    `export const INSTALLED_VFX_PLUGINS = [];\nexport function registerVfxPlugins() {}\n`,
);
const catalogPath = bpPath + STAGE_PROP_REGISTRY_SCRIPT;
if (addon.has(catalogPath)) addon.writeText(catalogPath, serializeStagePropCatalog([]));
addon.removeTree(bpPath + STAGE_PROP_BP_TREE);
for (const tree of STAGE_PROP_RP_TREES) addon.removeTree(rpPath + tree);

const ownedAssets = collectPluginOwnedAssets(join(root, "plugins"));
let removedAssets = 0;
for (const rel of ownedAssets) {
    const target = `${rpPath}${rel}`;
    if (addon.has(target)) {
        addon.remove(target);
        removedAssets++;
    }
}

const { bytes } = await writeAddonFile(outputPath, addon, {
    level: 6,
    storedExtensions: /$^/,
});

console.log(
    `[vfx] 零插件基础模板已生成：移除 ${removedScripts} 个插件脚本、${removedAssets} 个插件专属资源，` +
    `产物 ${outputPath} (${(bytes / 1048576).toFixed(2)} MiB)`,
);
