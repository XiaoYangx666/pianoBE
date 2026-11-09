import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const packageRoot = path.resolve(import.meta.dir, "..");
const sourceRoot = path.join(packageRoot, "src");
const configPath = path.join(packageRoot, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const options = program.getCompilerOptions();

function normalize(file: string) {
    return path.resolve(file).replace(/\\/g, "/");
}

const sourceFiles = program.getSourceFiles()
    .filter(file => !file.isDeclarationFile)
    .map(file => normalize(file.fileName))
    .filter(file => file.startsWith(normalize(sourceRoot) + "/"));

function layerOf(file: string): string {
    const relative = path.relative(sourceRoot, file).replace(/\\/g, "/");
    const first = relative.split("/")[0];
    return relative.includes("/") ? first : "root";
}

function internal(file: string) {
    return file.startsWith(normalize(sourceRoot) + "/");
}

interface ModuleInfo {
    imports: Set<string>;
    external: Set<string>;
}

const modules = new Map<string, ModuleInfo>();

function resolve(specifier: string, from: string): string | undefined {
    const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
    if (!resolved) return undefined;
    const file = normalize(resolved.resolvedFileName);
    return internal(file) ? file : undefined;
}

function collect(file: string): ModuleInfo {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`missing source file: ${file}`);
    const info: ModuleInfo = { imports: new Set(), external: new Set() };

    const visit = (node: ts.Node) => {
        let specifier: string | undefined;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifier = node.moduleSpecifier.text;
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
            specifier = node.arguments[0].text;
        }

        if (specifier) {
            const target = resolve(specifier, file);
            if (target) info.imports.add(target);
            else info.external.add(specifier);
        }
        ts.forEachChild(node, visit);
    };

    visit(source);
    return info;
}

for (const file of sourceFiles) modules.set(file, collect(file));

const forbiddenExternal: Record<string, RegExp[]> = {
    domain: [/^@minecraft\//, /^sapi-pro(?:\/|$)/, /^@begame\/tabletop(?:\/|$)/],
    runtime: [/^@minecraft\//, /^sapi-pro(?:\/|$)/, /^@begame\/tabletop\/minecraft$/],
    data: [/^@minecraft\//, /^sapi-pro(?:\/|$)/, /^@begame\/tabletop(?:\/|$)/],
};

const forbiddenLayers: Record<string, Set<string>> = {
    domain: new Set(["app", "platform", "runtime"]),
    runtime: new Set(["app", "platform"]),
    data: new Set(["app", "platform", "runtime", "domain"]),
    platform: new Set(["app"]),
};

function reachable(start: string): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const next of modules.get(file)?.imports ?? []) queue.push(next);
    }
    return seen;
}

function violationsFor(file: string): string[] {
    const layer = layerOf(file);
    const forbidden = forbiddenLayers[layer];
    if (!forbidden) return [];

    const problems: string[] = [];
    for (const visited of reachable(file)) {
        const visitedLayer = layerOf(visited);
        if (forbidden.has(visitedLayer)) {
            problems.push(`${path.relative(packageRoot, file)} reaches ${path.relative(packageRoot, visited)} (${visitedLayer})`);
        }
        for (const external of modules.get(visited)?.external ?? []) {
            for (const pattern of forbiddenExternal[layer] ?? []) {
                if (pattern.test(external)) {
                    problems.push(`${path.relative(packageRoot, file)} reaches ${external} via ${path.relative(packageRoot, visited)}`);
                }
            }
        }
    }
    return [...new Set(problems)];
}

describe("addon architecture boundaries", () => {
    test("domain, runtime, data and platform obey their dependency direction", () => {
        const problems = sourceFiles.flatMap(violationsFor);
        expect(problems).toEqual([]);
    });

    test("PianoRuntime never depends on PianoWorld", () => {
        const runtime = normalize(path.join(sourceRoot, "app", "PianoRuntime.ts"));
        const world = normalize(path.join(sourceRoot, "app", "PianoWorld.ts"));
        expect(modules.get(runtime)?.imports.has(world)).toBe(false);
        expect(reachable(runtime).has(world)).toBe(false);
    });

    test("internal module graph has no cycles", () => {
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const stack: string[] = [];
        const cycles: string[][] = [];

        const walk = (file: string) => {
            if (visited.has(file)) return;
            if (visiting.has(file)) {
                const start = stack.indexOf(file);
                cycles.push([...stack.slice(start), file].map(f => path.relative(packageRoot, f)));
                return;
            }
            visiting.add(file);
            stack.push(file);
            for (const next of modules.get(file)?.imports ?? []) walk(next);
            stack.pop();
            visiting.delete(file);
            visited.add(file);
        };

        for (const file of sourceFiles) walk(file);
        expect(cycles).toEqual([]);
    });

    test("the boundary check actually inspects real modules", () => {
        expect(sourceFiles.length).toBeGreaterThan(20);
        expect(modules.get(normalize(path.join(sourceRoot, "domain", "playback", "player.ts")))?.imports.size)
            .toBeGreaterThan(0);
    });

    test("app is intentionally allowed to use Minecraft APIs", () => {
        // platform 不是唯一允许 MC 的层：app 的 UI / 事件入口可以直接使用宿主 API。
        const appMain = normalize(path.join(sourceRoot, "app", "main.ts"));
        expect(modules.get(appMain)?.external.has("@minecraft/server")).toBe(true);
    });

    test("the boundary check rejects a real forbidden edge", () => {
        const domain = normalize(path.join(sourceRoot, "domain", "playback", "player.ts"));
        const platform = normalize(path.join(sourceRoot, "platform", "host.ts"));
        const info = modules.get(domain)!;

        const hadPlatform = info.imports.has(platform);
        info.imports.add(platform);
        try {
            expect(violationsFor(domain).length).toBeGreaterThan(0);
        } finally {
            if (!hadPlatform) info.imports.delete(platform);
        }

        const hadMinecraft = info.external.has("@minecraft/server");
        info.external.add("@minecraft/server");
        try {
            expect(violationsFor(domain).length).toBeGreaterThan(0);
        } finally {
            if (!hadMinecraft) info.external.delete("@minecraft/server");
        }
    });
});
