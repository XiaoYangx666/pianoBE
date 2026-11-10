/**
 * 校验 addon 构建产物（client / server）。
 *
 * 用法：
 *   node tools/verify-addon-build.mjs client
 *   node tools/verify-addon-build.mjs server
 *   node tools/verify-addon-build.mjs            # 根据产物内容推断
 *
 * 必须在对应的 bepack 构建之后运行。重点保护内嵌 MIDI 的 preserve-modules
 * 输出路径，以及 client 产物不泄漏 server-only 模块。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAddonFile } from "@bepack/addon/node";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addon = path.join(root, "packages/addon");
const scripts = path.join(addon, "bp/scripts");
const src = path.join(addon, "src");

let failed = 0;
function check(condition, message) {
    if (condition) console.log(`OK  ${message}`);
    else {
        failed++;
        console.error(`FAIL ${message}`);
    }
}

function read(file) {
    return fs.readFileSync(file, "utf8");
}

function capture(source, pattern, label) {
    const match = source.match(pattern);
    if (!match) throw new Error(`missing ${label}`);
    return match[1];
}

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
    });
}

const mode = process.argv[2] ?? (fs.existsSync(path.join(scripts, "serverAdmin.js")) ? "server" : "client");
check(mode === "client" || mode === "server", `mode is client or server (${mode})`);

// --- 源码与构建钩子必须指向同一个 MIDI 目录 ---
const managerSource = read(path.join(src, "app/midiManager.ts"));
const sourceImport = capture(managerSource, /from\s+["'](\.\.\/midis\/index\.js)["']/, "MIDI import");
check(sourceImport === "../midis/index.js", "source imports ../midis/index.js");
check(fs.existsSync(path.join(src, "midis/index.ts")), "source MIDI entry exists");

const config = read(path.join(addon, "bepack.config.ts"));
const destination = capture(config, /join\(ctx\.paths\.scriptOutDir,\s*["']([^"']+)["']\)/, "MIDI copy destination");
check(destination === "packages/addon/src/midis", "build hook copies to packages/addon/src/midis");
check(config.includes('"../../midis/js/"'), "build hook reads repository midis/js");

// --- 生成器音色开关必须指向 preserve-modules 输出中的 domain/piano/timbres.js ---
const timbresModule = "bp/scripts/packages/addon/src/domain/piano/timbres.js";
const timbresSource = "scripts/packages/addon/src/domain/piano/timbres.js";
const generatorTimbres = read(path.join(root, "packages/generator/src/timbres.ts"));
check(generatorTimbres.includes(`TIMBRES_SCRIPT_PATH = "${timbresSource}"`),
    "generator timbres path matches preserve-modules output");
const generatorExport = read(path.join(root, "packages/generator/src/export.ts"));
check(generatorExport.includes("TIMBRES_SCRIPT_PATH"), "generator export uses TIMBRES_SCRIPT_PATH");
check(read(path.join(root, "tools/strip-template-timbres.mjs")).includes(timbresSource),
    "template strip uses the domain timbres path");
check(read(path.join(root, "tools/verify-timbres.mjs")).includes(timbresModule),
    "timbres verifier uses the domain timbres path");

const templatePath = path.join(addon, "dist/template.mcaddon");
if (fs.existsSync(templatePath)) {
    const template = await readAddonFile(templatePath);
    check(template.has(timbresModule), `template includes ${timbresModule}`);
}

// --- 实际产物 ---
check(fs.existsSync(scripts), "bp/scripts exists (run a build first)");

const scorePack = path.join(scripts, "packages/addon/src/data/scorePack.js");
const resourcePackUuid = JSON.parse(read(path.join(addon, "rp/manifest.json"))).header.uuid;
check(fs.existsSync(scorePack) && read(scorePack).includes(resourcePackUuid),
    "DDUI score pack ID matches the resource manifest");

const builtManager = path.join(scripts, "midiManager.js");
check(fs.existsSync(builtManager), "built midiManager.js exists");

if (fs.existsSync(builtManager)) {
    const builtImport = capture(read(builtManager), /from\s+["']([^"']*midis\/index\.js)["']/, "built MIDI import");
    const entry = path.resolve(path.dirname(builtManager), builtImport);
    check(fs.existsSync(entry), `built MIDI entry resolves (${path.relative(root, entry)})`);
    check(entry === path.join(scripts, destination, "index.js"), "built import matches hook destination");

    if (mode === "client") {
        const generated = read(entry);
        check(generated.includes('id:"'), "client embedded library is not empty");
        check(fs.readdirSync(path.dirname(entry)).length > 1, "client generated MIDI modules exist");

        check(!fs.existsSync(path.join(scripts, "serverAdmin.js")), "client output has no serverAdmin.js");
        check(!fs.existsSync(path.join(scripts, "packages/addon/src/platform/server")),
            "client output has no platform/server");
        const leaked = walk(scripts)
            .filter((file) => file.endsWith(".js"))
            .filter((file) => /@minecraft\/server-(?:net|admin)/.test(read(file)));
        check(leaked.length === 0, "client output has no @minecraft/server-net/admin imports");
    } else {
        check(fs.existsSync(path.join(scripts, "serverAdmin.js")), "server output includes serverAdmin.js");
        check(fs.existsSync(path.join(scripts, "packages/addon/src/platform/server")),
            "server output includes platform/server");
        const serverAdmin = path.join(scripts, "serverAdmin.js");
        if (fs.existsSync(serverAdmin)) {
            check(/@minecraft\/server-admin/.test(read(serverAdmin)), "serverAdmin imports server-admin");
        }
    }
}

if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log("\naddon build verification passed");
