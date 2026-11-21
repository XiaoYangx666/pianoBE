import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const source = fileURLToPath(new URL("packages/vfx/assets/", root));
const target = fileURLToPath(new URL("packages/addon/rp/", root));
const trees = ["particles", "textures/particle"];

if (!existsSync(source)) throw new Error("Missing packages/vfx/assets; run npm run assets:vfx first");

for (const tree of trees) {
    const from = source + tree;
    const to = target + tree;
    mkdirSync(to, { recursive: true });
    // Bedrock resolves particle and texture identifiers by file name. Remove stale
    // VFX documents so a renamed effect cannot keep shipping an orphan asset.
    for (const entry of readdirSync(to)) rmSync(to + "/" + entry, { force: true });
    cpSync(from, to, { recursive: true, force: true });
}

console.log("Synced VFX particles and textures into packages/addon/rp");
