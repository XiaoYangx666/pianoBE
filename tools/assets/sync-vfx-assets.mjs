import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const hostSource = fileURLToPath(new URL("packages/vfx/assets/", root));
const pluginsRoot = fileURLToPath(new URL("plugins/", root));
const target = fileURLToPath(new URL("packages/addon/rp/", root));
const hostOnly = process.argv.includes("--host-only");

if (!existsSync(hostSource)) throw new Error("Missing packages/vfx/assets; run npm run assets:vfx first");

const atlas = JSON.parse(readFileSync(new URL("packages/vfx/src/data/vfxAtlas.json", root), "utf8"));
const textureBase = String(atlas.texture).split("/").at(-1);
const trees = [
    {
        tree: "particles",
        managed: (name) => name.startsWith("pbe_vfx_") && name.endsWith(".particle.json"),
    },
    {
        tree: "textures/particle",
        managed: (name) => name.startsWith(`${textureBase}.`)
            || name.startsWith(`${textureBase}_`)
            || name.startsWith("piano_fx.")
            || name.startsWith("piano_fx_"),
    },
];

const sourceRoots = [hostSource];
if (!hostOnly && existsSync(pluginsRoot)) {
    for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "dist" || entry.name === "node_modules") continue;
        sourceRoots.push(join(pluginsRoot, entry.name));
    }
}

let removed = 0;
for (const { tree, managed } of trees) {
    const to = join(target, tree);
    mkdirSync(to, { recursive: true });
    const active = new Set();
    const dirsToCopy = [];
    for (const base of sourceRoots) {
        const from = join(base, tree);
        if (!existsSync(from)) continue;
        dirsToCopy.push(from);
        for (const entry of readdirSync(from)) active.add(entry);
    }
    for (const entry of readdirSync(to)) {
        if (!managed(entry) || active.has(entry)) continue;
        rmSync(join(to, entry), { recursive: true, force: true });
        removed++;
    }
    for (const from of dirsToCopy) {
        cpSync(from, to, { recursive: true, force: true });
    }
}

console.log(
    `Synced ${hostOnly ? "host " : ""}VFX particles and textures into packages/addon/rp` +
    (removed ? ` (removed ${removed} stale VFX assets)` : ""),
);
