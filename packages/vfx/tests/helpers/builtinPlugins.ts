import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerBuiltinVfxPlugins } from "../../../../plugins/index";
import { vfxRegistry } from "../../src";

const hostParticlesDir = join(import.meta.dir, "..", "..", "assets", "particles");
const pluginsRoot = join(import.meta.dir, "..", "..", "..", "..", "plugins");

export function ensureBuiltinPluginsRegistered(): void {
    registerBuiltinVfxPlugins(vfxRegistry);
}

/** Resolves a particle document from Host assets or any built-in plugin's `particles/` directory. */
export function resolveParticleDocPath(particleName: string): string {
    const file = `pbe_vfx_${particleName}.particle.json`;
    const hostPath = join(hostParticlesDir, file);
    if (existsSync(hostPath)) return hostPath;
    for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "dist" || entry.name === "node_modules") continue;
        const candidate = join(pluginsRoot, entry.name, "particles", file);
        if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Missing particle document: ${file}`);
}

export function readParticleDoc(particleName: string): string {
    return readFileSync(resolveParticleDocPath(particleName), "utf8");
}
