/**
 * 生成器端到端验证（无浏览器）：bun tools/verify-generator.mjs
 * 真实流程：读取 addon 构建产物 template.mcaddon → 解析模板 →
 * 转换真实 .mid → 生成最终 mcaddon → 解包断言（含字节保真与回读闭环）。
 */
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { midiBufferToSong } from "@piano/core/convert";
import { metasToAddonIndex, songToAddonModule } from "@piano/core";
import { loadTemplate, parseExistingMidis } from "../packages/generator/src/template.ts";
import { generateAddonZip } from "../packages/generator/src/export.ts";

const TEMPLATE = "packages/addon/dist/template.mcaddon";
const MIDI_A = "midis/files/Beyond - 海阔天空.mid";
const MIDI_B = "midis/files/ChiliChill - 让风告诉你.mid";

let failed = 0;
function assert(cond, msg) {
    if (cond) console.log(`✅ ${msg}`);
    else {
        failed++;
        console.error(`❌ ${msg}`);
    }
}
async function zipBytes(zip) {
    return (await zip.generateAsync({ type: "blob" })).arrayBuffer();
}

// 1. 默认模板：模板模式跳过 midi 拷贝，无内嵌曲目
const templateInfo = await loadTemplate(readFileSync(TEMPLATE).buffer);
assert(templateInfo.songs.length === 0, "默认模板无内嵌曲目（模板模式跳过 midi 拷贝）");
assert(templateInfo.bpManifest.header?.name, "bp manifest 解析成功");

// 2. 构造"含内嵌曲目的模板"：注入曲目 A 的模块 + index（模拟用户上传旧生成包）
const songA = midiBufferToSong(new Uint8Array(readFileSync(MIDI_A)), "Beyond - 海阔天空");
assert(songA.id === "4beea226", `曲目 A 转换 id 正确：${songA.id}`);
const tplZip = templateInfo.zip;
tplZip.file(`bp/scripts/midis/${songA.id}.js`, songToAddonModule(songA));
tplZip.file(
    "bp/scripts/midis/index.js",
    metasToAddonIndex([{ id: songA.id, name: songA.name, duration: songA.duration }])
);
const embTemplate = await loadTemplate(await zipBytes(tplZip));
assert(embTemplate.songs.length === 1, "内嵌模板解析出 1 首");
assert(embTemplate.songs[0].id === songA.id && embTemplate.songs[0].isOriginal, "原曲目标记 isOriginal");

// 3. 添加新曲目 B，导出
const songB = midiBufferToSong(new Uint8Array(readFileSync(MIDI_B)), "ChiliChill - 让风告诉你");
const songs = [
    ...embTemplate.songs,
    { id: songB.id, name: songB.name, duration: songB.duration, noteCount: 1, isOriginal: false, song: songB },
];
const oldB = embTemplate.bpManifest.header.uuid;
const oldR = embTemplate.rpManifest.header.uuid;
const blob = await generateAddonZip(embTemplate, songs, {
    name: "测试钢琴包",
    desc: "e2e 描述",
    randomUuid: true,
});
assert(blob.size > 0, `导出 zip 生成 (${(blob.size / 1024).toFixed(0)} KB)`);

// 4. manifest 断言
const outZip = await JSZip.loadAsync(await blob.arrayBuffer());
const bpPath = Object.keys(outZip.files).find((f) => f.endsWith("bp/manifest.json"))?.replace("manifest.json", "");
const rpPath = Object.keys(outZip.files).find((f) => f.endsWith("rp/manifest.json"))?.replace("manifest.json", "");
const bpManifest = JSON.parse(await outZip.file(bpPath + "manifest.json").async("string"));
const rpManifest = JSON.parse(await outZip.file(rpPath + "manifest.json").async("string"));
assert(bpManifest.header.name === "测试钢琴包", "manifest 名称已应用");
assert(bpManifest.header.description === "e2e 描述", "manifest 描述已应用");
assert(bpManifest.header.uuid !== oldB && rpManifest.header.uuid !== oldR, "UUID 已随机化");
assert(
    bpManifest.dependencies.some((d) => d.uuid === rpManifest.header.uuid),
    "bp→rp 交叉依赖已更新"
);

// 5. 曲目内容断言
const midisDir = bpPath + "scripts/midis/";
const indexText = await outZip.file(midisDir + "index.js").async("string");
assert(indexText.startsWith("export const midis=["), "index.js 格式正确");
assert(indexText.includes(`id:"${songA.id}"`) && indexText.includes(`id:"${songB.id}"`), "index.js 含两首曲目");

const moduleA = await outZip.file(midisDir + songA.id + ".js").async("string");
assert(moduleA === songToAddonModule(songA), "原曲目 A 模块字节保真保留");
const moduleB = await outZip.file(midisDir + songB.id + ".js").async("string");
assert(moduleB === songToAddonModule(songB), "新曲目 B 模块与 core 输出一致");

// 6. 回读闭环：导出的包再次用生成器解析
const roundTrip = await parseExistingMidis(outZip, midisDir);
assert(roundTrip.length === 2, `导出后再解析：${roundTrip.length} 首（原 1 + 新 1）`);

console.log(failed === 0 ? "\n🎉 生成器 e2e 全部通过" : `\n💥 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);