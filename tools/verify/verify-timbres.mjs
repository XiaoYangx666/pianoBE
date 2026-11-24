/**
 * 音色插件选配验证：bun tools/verify/verify-timbres.mjs
 * 先运行 npm run build:template && npm run pack:plugins
 */
import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { readAddon } from "@bepack/addon";
import { PIANO_TIMBRES, pianoSoundLayers } from "@piano/core";
import { readPbePluginArchive } from "@piano/vfx/package";
import { assembleAddonBlob, loadAddonTemplate } from "@piano/assembly";

const TEMPLATE = "packages/addon/dist/template.mcaddon";
const PLUGINS_DIR = "build/plugins";
/** preserve-modules 输出里的音色模块（与 assembly/src/template.ts 中的常量一致） */
const TIMBRES_MODULE = "bp/scripts/packages/addon/src/domain/piano/timbres.js";
const OPTIONAL_IDS = ["classic_grand", "bright_grand", "upright", "electric_piano"];

let failed = 0;
function assert(cond, msg) {
    if (cond) console.log(`✓ ${msg}`);
    else {
        failed++;
        console.error(`✗ ${msg}`);
    }
}

async function storedZip(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    return zipSync(unzipSync(bytes), { level: 0 });
}

function loadTimbrePlugin(id) {
    return readPbePluginArchive(new Uint8Array(readFileSync(`${PLUGINS_DIR}/pianobe.timbre.${id}.pbeplugin`)));
}

async function build(plugins) {
    const template = await loadAddonTemplate(await storedZip(readFileSync(TEMPLATE)));
    const blob = await assembleAddonBlob(template, [], {
        name: "音色验证包",
        desc: "verify",
        randomUuid: false,
        plugins,
    });
    return readAddon(await storedZip(blob));
}

function hasDir(addon, dir) {
    return addon.entries().some((file) => file.path.includes(`/sounds/${dir}`));
}
function expectedDefinitionCount(ids) {
    const byId = new Map(PIANO_TIMBRES.map((entry) => [entry.id, entry]));
    return ids.reduce((sum, id) => {
        const entry = byId.get(id);
        return sum + (entry ? pianoSoundLayers(entry.value).length : 0) * 30 * 2;
    }, 0);
}
function parseDefinitions(addon) {
    const definitionsPath = `${addon.packs.rp.root}sounds/sound_definitions.json`;
    return JSON.parse(addon.readTextSync(definitionsPath)).sound_definitions;
}

const optionalArchives = OPTIONAL_IDS.map((id) => loadTimbrePlugin(id));
assert(
    optionalArchives.map((a) => a.timbres[0]?.id).join(",") === OPTIONAL_IDS.join(","),
    `官方音色插件包包含 4 套可选音色（实际 ${optionalArchives.map((a) => a.timbres[0]?.id).join(", ")}）`,
);

const classicPlugin = optionalArchives[0];

const onlyDefault = await build([]);
assert(!hasDir(onlyDefault, "classic_grand"), "仅默认：不包含 Classic Grand 采样");
assert(!hasDir(onlyDefault, "bright_grand"), "仅默认：不包含 Bright Grand 采样");
assert(!hasDir(onlyDefault, "upright"), "仅默认：不包含 Upright 采样");
assert(!hasDir(onlyDefault, "electric_piano"), "仅默认：不包含 Electric Piano 采样");
const defaultDefs = parseDefinitions(onlyDefault);
assert(
    Object.keys(defaultDefs).length === expectedDefinitionCount(["piano"]),
    `仅默认：有效定义条数正确（实际 ${Object.keys(defaultDefs).length}）`,
);
assert(onlyDefault.readTextSync(TIMBRES_MODULE).includes('["piano"]'), "仅默认：timbres.js 只启用钢琴");

const withClassic = await build([classicPlugin]);
assert(hasDir(withClassic, "classic_grand"), "默认 + 经典三角插件：包含 Classic Grand 采样");
assert(!hasDir(withClassic, "upright"), "默认 + 经典三角插件：不包含 Upright 采样");
assert(!hasDir(withClassic, "electric_piano"), "默认 + 经典三角插件：不包含 Electric Piano 采样");
const classicDefs = parseDefinitions(withClassic);
assert(
    Object.keys(classicDefs).length === expectedDefinitionCount(["piano", "classic_grand"]),
    `默认 + 经典三角插件：有效定义条数正确（实际 ${Object.keys(classicDefs).length}）`,
);
assert(
    withClassic.readTextSync(TIMBRES_MODULE).includes('"classic_grand"'),
    "默认 + 经典三角插件：timbres.js 包含 Classic Grand",
);

const withAll = await build(optionalArchives);
assert(
    OPTIONAL_IDS.every((id) => hasDir(withAll, id)),
    "全选音色插件：包含全部可选音色目录",
);
const allDefs = parseDefinitions(withAll);
assert(
    Object.keys(allDefs).length === expectedDefinitionCount(["piano", ...OPTIONAL_IDS]),
    `全选音色插件：有效定义条数正确（实际 ${Object.keys(allDefs).length}）`,
);
const allTimbres = withAll.readTextSync(TIMBRES_MODULE);
assert(
    OPTIONAL_IDS.every((id) => allTimbres.includes(`"${id}"`)),
    "全选音色插件：timbres.js 包含全部音色",
);

console.log(failed === 0 ? "\n✅ 音色插件选配验证通过" : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
