import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(import.meta.dir, "..", "src");
const forbidden = [
    { pattern: /@domain\/|@app\/|@platform\//, reason: "addon aliases" },
    { pattern: /packages\/addon|packages\/web|addon\/src|web\/src/, reason: "platform package paths" },
    { pattern: /@minecraft\//, reason: "Minecraft APIs" },
    { pattern: /from ["']three["']|from ["']wintersky["']/, reason: "renderer dependencies" },
];

function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

describe("vfx package boundaries", () => {
    test("the shared domain never imports addon, web or renderer internals", () => {
        const problems: string[] = [];
        for (const file of sources(sourceRoot)) {
            const source = readFileSync(file, "utf8");
            for (const { pattern, reason } of forbidden) {
                if (pattern.test(source)) problems.push(`${file}: ${reason}`);
            }
        }
        expect(problems).toEqual([]);
    });

    test("the public entry exports every domain module", () => {
        const entry = readFileSync(join(sourceRoot, "index.ts"), "utf8");
        for (const module of ["engine", "instrument", "effects", "themes", "programs", "keyParticles"]) {
            expect(entry).toContain(`./${module}`);
        }
    });
});
