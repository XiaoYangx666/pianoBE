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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
check(config.includes('"../../tools/midi/sync-addon-library.mjs"'), "build hook generates scripts from the tracked PBE3 library");

// --- 装配器音色开关必须指向 preserve-modules 输出中的 domain/piano/timbres.js ---
const timbresModule = "bp/scripts/packages/addon/src/domain/piano/timbres.js";
const timbresSource = "scripts/packages/addon/src/domain/piano/timbres.js";
const assemblyTemplate = read(path.join(root, "packages/assembly/src/template.ts"));
check(assemblyTemplate.includes(`TIMBRES_SCRIPT_PATH = "${timbresSource}"`),
    "assembly timbres path matches preserve-modules output");
const assemblyAssembler = read(path.join(root, "packages/assembly/src/assembler.ts"));
check(assemblyAssembler.includes("TIMBRES_SCRIPT_PATH"), "assembly assembler uses TIMBRES_SCRIPT_PATH");
const rpSounds = path.join(addon, "rp/sounds");
const rpSoundDirs = fs.existsSync(rpSounds)
    ? fs.readdirSync(rpSounds, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
check(rpSoundDirs.every((name) => /^piano_v\d$/.test(name)),
    "rp/sounds only contains the bundled standard piano");
check(fs.existsSync(path.join(addon, "timbre-samples")) && fs.readdirSync(path.join(addon, "timbre-samples")).length > 0,
    "optional timbre samples live outside the resource pack");
check(read(path.join(root, "tools/verify/verify-timbres.mjs")).includes(timbresModule),
    "timbres verifier uses the domain timbres path");

const templatePath = path.join(addon, "dist/template.mcaddon");
const propRoot = "bp/entities/pbe_stage_props";
const propCatalog = "bp/scripts/vfx/stagePropCatalog.js";

const propFiles = fs.existsSync(path.join(addon, propRoot)) ? walk(path.join(addon, propRoot)) : [];
check(propFiles.length === 0,
    "zero-plugin base addon contains no built-in stage props");
if (fs.existsSync(templatePath)) {
    const template = await readAddonFile(templatePath);
    check(template.has(timbresModule), `template includes ${timbresModule}`);
    check(!template.entries().some(entry => entry.path.startsWith("bp/scripts/plugins/")),
        "template contains no built-in plugin scripts");
}

// --- 实际产物 ---
check(fs.existsSync(scripts), "bp/scripts exists (run a build first)");
const catalogSource = read(path.join(addon, propCatalog));
check(catalogSource.includes("STAGE_PROP_REGISTRATIONS"),
    "stagePropCatalog.js exports STAGE_PROP_REGISTRATIONS");
const runtimePath = path.join(scripts, "vfx/runtime.js");
check(read(runtimePath).includes('from "./stagePropCatalog.js"'),
    "VFX runtime imports the assembled stage prop catalog");
const vfxPluginsPath = path.join(scripts, "vfx/plugins.js");
check(fs.existsSync(vfxPluginsPath) && !read(vfxPluginsPath).includes("plugins/dist"),
    "built vfx/plugins.js is zero-plugin (does not import @piano/plugins)");
check(!fs.existsSync(path.join(scripts, "plugins")),
    "built bp/scripts/plugins does not exist in zero-plugin base");
const vfxIndexPath = path.join(scripts, "vfx/index.js");
check(fs.existsSync(vfxIndexPath) && read(vfxIndexPath).includes("registerVfxPlugins"),
    "built vfx/index.js retains registerVfxPlugins call");

const seat = JSON.parse(read(path.join(addon, "bp/entities/piano_bench_seat.json")))["minecraft:entity"];
const rideHeight = seat.components["minecraft:rideable"]?.seats?.[0]?.position?.[1];
check(seat.description.identifier === "pbe:piano_bench_seat"
    && seat.components["minecraft:rideable"]?.seat_count === 1
    && !("minecraft:pushable" in seat.components),
    "bench seat uses the current entity schema and provides one rider seat");

for (const [name, recovery] of [["piano_bench", false], ["p88_bench_left", true], ["p88_bench_right", true]]) {
    const block = JSON.parse(read(path.join(addon, `bp/blocks/${name}.json`)))["minecraft:block"];
    check(block.description.identifier === `pbe:${name}`
        && "pbe:piano_bench_seating" in block.components
        && ("pbe:p88_bench_recovery" in block.components) === recovery
        && ("minecraft:tick" in block.components) === recovery,
        `${name} declares seating and the correct tick registration`);
    const cushion = block.components["minecraft:selection_box"];
    check(rideHeight >= 0 && rideHeight * 16 < cushion.origin[1] + cushion.size[1],
        `${name} allows for the visual rider height above the native seat`);
}

const scorePack = path.join(scripts, "packages/addon/src/data/scorePack.js");
const resourcePackUuid = JSON.parse(read(path.join(addon, "rp/manifest.json"))).header.uuid;
check(fs.existsSync(scorePack) && read(scorePack).includes(resourcePackUuid),
    "DDUI score pack ID matches the resource manifest");
check(fs.existsSync(scorePack) && read(scorePack).includes("PIANO_SCORES"),
    "score pack exports the published PIANO_SCORES list");

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
        check(generated.includes("export const libraries="), "client embedded library exports libraries");
        check(fs.readdirSync(path.dirname(entry)).length > 1, "client generated MIDI modules exist");

        check(!fs.existsSync(path.join(scripts, "serverAdmin.js")), "client output has no serverAdmin.js");
        check(!fs.existsSync(path.join(scripts, "packages/addon/src/platform/server")),
            "client output has no platform/server");
        const leaked = walk(scripts)
            .filter((file) => file.endsWith(".js"))
            .filter((file) => /@minecraft\/server-(?:net|admin)/.test(read(file)));
        check(leaked.length === 0, "client output has no @minecraft/server-net/admin imports");

        check(!fs.existsSync(path.join(scripts, "server")),
            "client output has no server feature modules");
        const transcribeLeaks = walk(scripts)
            .filter((file) => file.endsWith(".js"))
            .filter((file) => /TranscriptionManager|online-transcribe|在线转录/.test(read(file)));
        check(transcribeLeaks.length === 0, "client output has no online transcription code");
    } else {
        check(fs.existsSync(path.join(scripts, "serverAdmin.js")), "server output includes serverAdmin.js");
        check(fs.existsSync(path.join(scripts, "packages/addon/src/platform/server")),
            "server output includes platform/server");
        const serverAdmin = path.join(scripts, "serverAdmin.js");
        if (fs.existsSync(serverAdmin)) {
            check(/@minecraft\/server-admin/.test(read(serverAdmin)), "serverAdmin imports server-admin");
        }

        const features = path.join(scripts, "server/features.js");
        check(fs.existsSync(path.join(scripts, "server/transcription/manager.js")),
            "server output includes the transcription manager");
        check(fs.existsSync(features), "server output includes the feature bootstrap");
        if (fs.existsSync(features)) {
            check(read(features).includes("online-transcribe"),
                "server registers the online transcription menu entry");
        }
    }
}

const vfxHost = path.join(scripts, "vfx/host.js");
const vfxHostSource = fs.existsSync(vfxHost) ? read(vfxHost) : "";
check(fs.existsSync(vfxHost), "built vfx/host.js exists");
check(
    vfxHostSource.includes("registerVfxPlugin") && vfxHostSource.includes("drawPoints"),
    "built vfx/host.js exports VFX Host API (registerVfxPlugin, drawPoints)",
);

if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log("\naddon build verification passed");
