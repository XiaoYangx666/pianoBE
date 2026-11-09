import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

/**
 * 内嵌 MIDI 的构建布局约束。
 *
 * 生成入口在源码里是空 stub，真正的曲目由 bepack afterBuild 从仓库根目录
 * `midis/js/` 拷贝到 preserve-modules 输出。这里同时校验：
 * 1. 运行时相对导入与构建钩子目标目录一致；
 * 2. 如果本地已有构建产物，实际相对导入能解析到生成入口；client 产物还必须非空。
 */

const addonRoot = path.resolve(import.meta.dir, "..");
const srcRoot = path.join(addonRoot, "src");
const scriptsRoot = path.join(addonRoot, "bp", "scripts");
const midiEntrySource = path.join(srcRoot, "midis", "index.ts");
const midiManagerSource = path.join(srcRoot, "app", "midiManager.ts");
const bepackConfigPath = path.join(addonRoot, "bepack.config.ts");
const bepackServerConfigPath = path.join(addonRoot, "bepack.server.config.ts");

function capture(source: string, pattern: RegExp, label: string): string {
    const match = source.match(pattern);
    if (!match) throw new Error(`missing ${label}`);
    return match[1];
}

describe("embedded MIDI build layout", () => {
    test("source import points at the generated MIDI entry", () => {
        const source = fs.readFileSync(midiManagerSource, "utf8");
        const specifier = capture(source, /from\s+["'](\.\.\/midis\/index\.js)["']/, "MIDI import");
        expect(specifier).toBe("../midis/index.js");
        expect(path.resolve(path.dirname(midiManagerSource), specifier.replace(/\.js$/, ".ts")))
            .toBe(midiEntrySource);
        expect(fs.existsSync(midiEntrySource)).toBe(true);
        expect(fs.readFileSync(midiEntrySource, "utf8")).toContain("export const midis");
    });

    test("build hook copies generated modules to the matching output path", () => {
        const config = fs.readFileSync(bepackConfigPath, "utf8");
        const destination = capture(
            config,
            /join\(ctx\.paths\.scriptOutDir,\s*["']([^"']+)["']\)/,
            "MIDI copy destination"
        );
        expect(destination).toBe("packages/addon/src/midis");
        expect(config).toContain('"../../midis/js/"');
    });

    test("client and server configs share the app entry", () => {
        for (const file of [bepackConfigPath, bepackServerConfigPath]) {
            const config = fs.readFileSync(file, "utf8");
            expect(capture(config, /entry:\s*["']([^"']+)["']/, "entry")).toBe("src/app/main.ts");
        }
    });

    test("generator timbres path follows the preserve-modules layout", () => {
        const timbresModule = "scripts/packages/addon/src/domain/piano/timbres.js";
        const generatorTimbres = fs.readFileSync(
            path.join(addonRoot, "../generator/src/timbres.ts"), "utf8"
        );
        expect(generatorTimbres).toContain(`TIMBRES_SCRIPT_PATH = "${timbresModule}"`);

        const generatorExport = fs.readFileSync(
            path.join(addonRoot, "../generator/src/export.ts"), "utf8"
        );
        expect(generatorExport).toContain("TIMBRES_SCRIPT_PATH");
        expect(generatorExport).not.toContain("scripts/piano/timbres.js");

        expect(fs.readFileSync(path.join(addonRoot, "../../tools/strip-template-timbres.mjs"), "utf8"))
            .toContain(timbresModule);
        expect(fs.readFileSync(path.join(addonRoot, "../../tools/verify-timbres.mjs"), "utf8"))
            .toContain(`bp/${timbresModule}`);
    });

    test.skipIf(!fs.existsSync(scriptsRoot))("built output resolves the MIDI entry", () => {
        const builtManager = path.join(scriptsRoot, "midiManager.js");
        expect(fs.existsSync(builtManager)).toBe(true);

        const built = fs.readFileSync(builtManager, "utf8");
        const specifier = capture(built, /from\s+["']([^"']*midis\/index\.js)["']/, "built MIDI import");
        const entry = path.resolve(path.dirname(builtManager), specifier);
        expect(fs.existsSync(entry)).toBe(true);

        const config = fs.readFileSync(bepackConfigPath, "utf8");
        const destination = capture(config, /join\(ctx\.paths\.scriptOutDir,\s*["']([^"']+)["']\)/, "destination");
        expect(entry).toBe(path.join(scriptsRoot, destination, "index.js"));

        const serverBuild = fs.existsSync(path.join(scriptsRoot, "serverAdmin.js"));
        if (serverBuild) {
            expect(fs.existsSync(path.join(scriptsRoot, "packages/addon/src/platform/server"))).toBe(true);
            return;
        }

        // client 构建必须带真实曲库；template 构建有意保留空 stub（曲库由生成器注入）。
        const files = fs.readdirSync(path.dirname(entry));
        if (files.length > 1) {
            expect(fs.readFileSync(entry, "utf8")).toContain('id:"');
        }
        expect(fs.existsSync(path.join(scriptsRoot, "serverAdmin.js"))).toBe(false);
    });
});
