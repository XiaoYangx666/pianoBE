import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(import.meta.dir, "..", "src");
const pluginsRoot = join(import.meta.dir, "..", "..", "..", "plugins");
const forbidden = [
    { pattern: /@domain\/|@app\/|@platform\//, reason: "addon aliases" },
    { pattern: /packages\/addon|packages\/web|addon\/src|web\/src/, reason: "platform package paths" },
    { pattern: /(?:from|import)\s*(?:\(\s*)?["']@minecraft\//, reason: "Minecraft APIs" },
    { pattern: /from ["']three["']|from ["']wintersky["']/, reason: "renderer dependencies" },
    { pattern: /@piano\/plugins|\bplugins\//, reason: "built-in plugin dependencies in Host" },
];

const pluginForbidden = [
    { pattern: /@domain\/|@app\/|@platform\//, reason: "addon aliases" },
    { pattern: /packages\/|@minecraft\//, reason: "internal package or Minecraft API imports" },
    { pattern: /from ["']three["']|from ["']wintersky["']/, reason: "renderer dependencies" },
    { pattern: /from ["']\.\.\/\.\.\//, reason: "cross-plugin relative imports" },
];

function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (entry.name === "dist" || entry.name === "node_modules") return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

describe("vfx package boundaries", () => {
    test("the shared host never imports addon, web, renderer internals, or any plugin", () => {
        const problems: string[] = [];
        for (const file of sources(sourceRoot)) {
            const source = readFileSync(file, "utf8");
            for (const { pattern, reason } of forbidden) {
                if (pattern.test(source)) problems.push(`${file}: ${reason}`);
            }
        }
        expect(problems).toEqual([]);
    });

    test("every built-in plugin only uses the public @piano/vfx API and never imports other plugins or host internals", () => {
        const problems: string[] = [];
        const pluginDirs = readdirSync(pluginsRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name !== "dist" && entry.name !== "node_modules");
        expect(pluginDirs.length).toBeGreaterThanOrEqual(6);

        for (const dir of pluginDirs) {
            const vfxDir = join(pluginsRoot, dir.name, "vfx");
            for (const file of sources(vfxDir)) {
                const source = readFileSync(file, "utf8");
                for (const { pattern, reason } of pluginForbidden) {
                    if (pattern.test(source)) problems.push(`${file}: ${reason}`);
                }
                for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
                    const spec = match[1];
                    const allowed = spec === "@piano/vfx" || spec === "@piano/core" || spec === "../plugin.json" || spec.startsWith("./");
                    if (!allowed) problems.push(`${file}: disallowed import ${spec}`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    test("the public entry exports every domain module without pulling fflate or archive tooling", () => {
        const entry = readFileSync(join(sourceRoot, "index.ts"), "utf8");
        for (const module of [
            "./plugin/plugin",
            "./plugin/registry",
            "./runtime/engine",
            "./spatial/instrument",
            "./domain/effects",
            "./domain/themes",
            "./runtime/programs",
            "./domain/keyParticles",
        ]) {
            expect(entry).toContain(module);
        }
        expect(entry).not.toContain("pluginPackage");
        expect(entry).not.toContain("fflate");
    });
});
