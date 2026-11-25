import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

/**
 * 内嵌 MIDI 的构建布局约束。
 *
 * 生成入口在源码里是空 stub，真正的曲目由 bepack afterBuild 从仓库根目录
 * `midis/library/` 生成到 preserve-modules 输出。这里校验源码契约。
 * 产物由 verify-addon-build 在每次构建后检查。
 */

const addonRoot = path.resolve(import.meta.dir, "..");
const srcRoot = path.join(addonRoot, "src");
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
        expect(config).toContain('"../../tools/midi/sync-addon-library.mjs"');
    });

    test("client and server configs share the app entry", () => {
        for (const file of [bepackConfigPath, bepackServerConfigPath]) {
            const config = fs.readFileSync(file, "utf8");
            expect(capture(config, /entry:\s*["']([^"']+)["']/, "entry")).toBe("src/app/main.ts");
        }
    });

    test("assembly timbres path follows the preserve-modules layout", () => {
        const timbresModule = "scripts/packages/addon/src/domain/piano/timbres.js";
        const assemblyTemplate = fs.readFileSync(
            path.join(addonRoot, "../assembly/src/template.ts"), "utf8"
        );
        expect(assemblyTemplate).toContain(`TIMBRES_SCRIPT_PATH = "${timbresModule}"`);

        const assemblyAssembler = fs.readFileSync(
            path.join(addonRoot, "../assembly/src/assembler.ts"), "utf8"
        );
        expect(assemblyAssembler).toContain("TIMBRES_SCRIPT_PATH");
        expect(assemblyAssembler).not.toContain("scripts/piano/timbres.js");

        expect(fs.readFileSync(path.join(addonRoot, "../../tools/build/strip-template-timbres.mjs"), "utf8"))
            .toContain(timbresModule);
        expect(fs.readFileSync(path.join(addonRoot, "../../tools/verify/verify-timbres.mjs"), "utf8"))
            .toContain(`bp/${timbresModule}`);
    });

    /**
     * 占位入口是编译期的导出契约：Rolldown 会把 `import * as midiIndex` 降级成
     * 具名导入（preserve-modules 分块），随后构建钩子用生成器产物覆写输出目录里的
     * 同一个 index.js。两边导出名必须完全一致，否则游戏内模块链接直接报"未导出"。
     */
    test("generated MIDI entry exports exactly what the source placeholder declares", async () => {
        const { metasToAddonIndex } = await import("@piano/core");
        const placeholder = fs.readFileSync(midiEntrySource, "utf8");
        const placeholderExports = [...placeholder.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)]
            .map((match) => match[1])
            .sort();
        const generated = metasToAddonIndex([], []);
        const generatedExports = [...generated.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)]
            .map((match) => match[1])
            .sort();

        expect(placeholderExports).toEqual(["libraries", "midis"]);
        expect(generatedExports).toEqual(placeholderExports);
    });

});
