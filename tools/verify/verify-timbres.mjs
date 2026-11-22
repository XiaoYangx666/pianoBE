/**
 * 音色选配验证：bun tools/verify-timbres.mjs
 * 先运行 npm run build:template && node packages/generator/scripts/sync-timbres.mjs
 */
import { readFileSync } from "node:fs";
import { readAddon } from "@bepack/addon";
import { readAddonArchiveFile } from "@bepack/addon/node";
import { loadTemplate } from "../../packages/generator/src/addon/template.ts";
import { generateAddonZip } from "../../packages/generator/src/addon/export.ts";

const TEMPLATE = "packages/addon/dist/template.mcaddon";
const TIMBRES = "packages/generator/public/timbres";
/** preserve-modules 输出里的音色模块（与 generator/src/addon/timbres.ts 中的常量一致） */
const TIMBRES_MODULE = "bp/scripts/packages/addon/src/domain/piano/timbres.js";
const index = JSON.parse(readFileSync(`${TIMBRES}/index.json`, "utf8"));
const optional = index.filter((t) => !t.bundled);
const OPTIONAL_IDS = ["classic_grand", "bright_grand", "upright", "electric_piano"];

let failed = 0;
function assert(cond, msg) {
    if (cond) console.log(`✓ ${msg}`);
    else {
        failed++;
        console.error(`✗ ${msg}`);
    }
}

async function loadPack(meta) {
    const entries = await readAddonArchiveFile(`${TIMBRES}/${meta.file}`);
    const files = new Map(entries.map((file) => [file.path, file.bytes]));
    const definitionsEntry = entries.find((file) => file.path === "sound_definitions.json");
    const definitions = definitionsEntry
        ? JSON.parse(new TextDecoder().decode(definitionsEntry.bytes)).sound_definitions
        : {};
    return { meta, files, soundDefinitions: definitions };
}

async function build(selected, enabledIds) {
    const template = await loadTemplate(new Uint8Array(readFileSync(TEMPLATE)));
    const blob = await generateAddonZip(template, [], {
        name: "音色验证包",
        desc: "verify",
        randomUuid: false,
        timbres: { all: index, selected, enabledIds },
    });
    return readAddon(blob);
}

function hasDir(addon, dir) {
    return addon.entries().some((file) => file.path.includes(`/sounds/${dir}`));
}
function expectedDefinitionCount(ids) {
    const byId = new Map(index.map((entry) => [entry.id, entry]));
    return ids.reduce((sum, id) => sum + (byId.get(id)?.layers.length ?? 0) * 30 * 2, 0);
}
function parseDefinitions(addon) {
    const definitionsPath = `${addon.packs.rp.root}sounds/sound_definitions.json`;
    return JSON.parse(addon.readTextSync(definitionsPath)).sound_definitions;
}

assert(
    optional.map((t) => t.id).sort().join(",") === [...OPTIONAL_IDS].sort().join(","),
    `音色清单包含 4 套可选音色（实际 ${optional.map((t) => t.id).join(", ")}）`
);

const classic = optional.find((t) => t.id === "classic_grand");
const classicPack = await loadPack(classic);

const onlyDefault = await build([], ["piano"]);
assert(!hasDir(onlyDefault, "classic_grand"), "仅默认：不包含 Classic Grand 采样");
assert(!hasDir(onlyDefault, "bright_grand"), "仅默认：不包含 Bright Grand 采样");
assert(!hasDir(onlyDefault, "upright"), "仅默认：不包含 Upright 采样");
assert(!hasDir(onlyDefault, "electric_piano"), "仅默认：不包含 Electric Piano 采样");
const defaultDefs = parseDefinitions(onlyDefault);
assert(Object.keys(defaultDefs).length === expectedDefinitionCount(["piano"]), `仅默认：有效定义条数正确（实际 ${Object.keys(defaultDefs).length}）`);
assert(
    onlyDefault.readTextSync(TIMBRES_MODULE).includes('["piano"]'),
    "仅默认：timbres.js 只启用钢琴"
);

const withClassic = await build([classicPack], ["piano", "classic_grand"]);
assert(hasDir(withClassic, "classic_grand"), "默认 + 经典三角：包含 Classic Grand 采样");
assert(!hasDir(withClassic, "upright"), "默认 + 经典三角：不包含 Upright 采样");
assert(!hasDir(withClassic, "electric_piano"), "默认 + 经典三角：不包含 Electric Piano 采样");
const classicDefs = parseDefinitions(withClassic);
assert(Object.keys(classicDefs).length === expectedDefinitionCount(["piano", "classic_grand"]), `默认 + 经典三角：有效定义条数正确（实际 ${Object.keys(classicDefs).length}）`);
assert(
    withClassic.readTextSync(TIMBRES_MODULE).includes('"classic_grand"'),
    "默认 + 经典三角：timbres.js 包含 Classic Grand"
);

const allPacks = await Promise.all(optional.map(loadPack));
const withAll = await build(allPacks, ["piano", ...optional.map((t) => t.id)]);
assert(optional.every((t) => hasDir(withAll, t.id)), "全选：包含全部可选音色目录");
const allDefs = parseDefinitions(withAll);
assert(Object.keys(allDefs).length === expectedDefinitionCount(["piano", ...optional.map((t) => t.id)]), `全选：有效定义条数正确（实际 ${Object.keys(allDefs).length}）`);
const allTimbres = withAll.readTextSync(TIMBRES_MODULE);
assert(optional.every((t) => allTimbres.includes(`"${t.id}"`)), "全选：timbres.js 包含全部音色");

console.log(failed === 0 ? "\n✅ 音色选配验证通过" : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
