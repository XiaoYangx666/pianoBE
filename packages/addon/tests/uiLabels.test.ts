import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const uiRoot = path.resolve(import.meta.dir, "../src/app/ui");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
    });
}

// DDUI renders button labels as plain text: emoji (astral code points) and
// variation selectors show up as boxes, so labels stay inside the BMP.
const buttonLabel = /\.button\(\s*"([^"]*)"/g;

test("data-driven button labels stay plain text", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(uiRoot)) {
        const source = fs.readFileSync(file, "utf8");
        for (const [, text] of source.matchAll(buttonLabel)) {
            const bad = [...text].some(char => char.codePointAt(0)! > 0xffff || char === "\uFE0F" || char === "\u200D");
            if (bad) offenders.push(`${path.relative(uiRoot, file).replace(/\\/g, "/")}: ${JSON.stringify(text)}`);
        }
    }
    expect(offenders).toEqual([]);
});
