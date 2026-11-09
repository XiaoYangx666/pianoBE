/**
 * 生成器音色选配验证：bun tools/verify-timbres.mjs
 * 依赖：npm run build:template && node packages/generator/scripts/sync-timbres.mjs
 */
import { readFileSync } from "node:fs";
import { readAddon } from "@bepack/addon";
import { readAddonArchiveFile } from "@bepack/addon/node";
import { loadTemplate } from "../packages/generator/src/template.ts";
import { generateAddonZip } from "../packages/generator/src/export.ts";

const TEMPLATE = "packages/addon/dist/template.mcaddon";
const TIMBRES = "packages/generator/public/timbres";
/** preserve-modules 输出中的音色开关模块（与 generator/src/timbres.ts 保持一致）。 */
const TIMBRES_MODULE = "bp/scripts/packages/addon/src/domain/piano/timbres.js";
const index = JSON.parse(readFileSync(`${TIMBRES}/index.json`, "utf8"));
const optional = index.filter((t) => !t.bundled);

let failed = 0;
function assert(cond, msg) {
    if (cond) console.log(`✅ ${msg}`);
    else {
        failed++;
        console.error(`❌ ${msg}`);
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
    return addon.entries().some((file) => file.path.includes(`/sounds/${dir}/`));
}
function parseDefinitions(addon) {
    const definitionsPath = `${addon.packs.rp.root}sounds/sound_definitions.json`;
    return JSON.parse(addon.readTextSync(definitionsPath)).sound_definitions;
}

const meta = optional.find((t) => t.id === "meta_piano");
const metaPack = await loadPack(meta);

const onlyDefault = await build([], ["piano"]);
assert(!hasDir(onlyDefault, "meta_piano"), "仅默认：不包含 Meta 采样");
assert(!hasDir(onlyDefault, "upright_kw"), "仅默认：不包含 KW 采样");
assert(!hasDir(onlyDefault, "ydp_grand"), "仅默认：不包含 YDP 采样");
const defaultDefs = parseDefinitions(onlyDefault);
assert(Object.keys(defaultDefs).length === 90, `仅默认：音效定义 90 条（实际 ${Object.keys(defaultDefs).length}）`);
assert(
    onlyDefault.readTextSync(TIMBRES_MODULE).includes('["piano"]'),
    "仅默认：timbres.js 只启用钢琴"
);

const withMeta = await build([metaPack], ["piano", "meta_piano"]);
assert(hasDir(withMeta, "meta_piano"), "默认 + Meta：包含 Meta 采样");
assert(!hasDir(withMeta, "upright_kw"), "默认 + Meta：不包含 KW 采样");
assert(!hasDir(withMeta, "ydp_grand"), "默认 + Meta：不包含 YDP 采样");
const metaDefs = parseDefinitions(withMeta);
assert(Object.keys(metaDefs).length === 180, `默认 + Meta：音效定义 180 条（实际 ${Object.keys(metaDefs).length}）`);
assert(
    withMeta.readTextSync(TIMBRES_MODULE).includes('"meta_piano"'),
    "默认 + Meta：timbres.js 启用 Meta"
);

const allPacks = await Promise.all(optional.map(loadPack));
const withAll = await build(allPacks, ["piano", ...optional.map((t) => t.id)]);
assert(optional.every((t) => hasDir(withAll, t.id)), "全选：包含全部可选音色采样");
const allDefs = parseDefinitions(withAll);
assert(Object.keys(allDefs).length === 360, `全选：音效定义 360 条（实际 ${Object.keys(allDefs).length}）`);
const allTimbres = withAll.readTextSync(TIMBRES_MODULE);
assert(optional.every((t) => allTimbres.includes(`"${t.id}"`)), "全选：timbres.js 启用全部音色");

console.log(failed === 0 ? "\n🎉 音色选配验证通过" : `\n💥 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
