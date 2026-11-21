import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const source = fileURLToPath(new URL("packages/vfx/assets/", root));
const target = fileURLToPath(new URL("packages/addon/rp/", root));

if (!existsSync(source)) throw new Error("Missing packages/vfx/assets; run npm run assets:vfx first");

const atlas = JSON.parse(readFileSync(new URL("packages/vfx/src/data/vfxAtlas.json", root), "utf8"));
const textureBase = String(atlas.texture).split("/").at(-1);
const trees = [
    {
        tree: "particles",
        managed: (name) => name.startsWith("pbe_vfx_") && name.endsWith(".particle.json"),
    },
    {
        tree: "textures/particle",
        managed: (name) => name.startsWith(`${textureBase}.`) || name.startsWith(`${textureBase}_`),
    },
];

let removed = 0;
for (const { tree, managed } of trees) {
    const from = source + tree;
    const to = target + tree;
    mkdirSync(to, { recursive: true });
    const current = new Set(readdirSync(from));
    // Bedrock resolves identifiers by file name, so only stale VFX-generated files
    // need removal. Non-VFX particles/textures in the addon resource pack stay put.
    for (const entry of readdirSync(to)) {
        if (!managed(entry) || current.has(entry)) continue;
        rmSync(`${to}/${entry}`, { recursive: true, force: true });
        removed++;
    }
    cpSync(from, to, { recursive: true, force: true });
}

console.log(`Synced VFX particles and textures into packages/addon/rp${removed ? ` (removed ${removed} stale VFX assets)` : ""}`);
