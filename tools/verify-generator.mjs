/**
 * 生成器端到端验证（无浏览器）：bun tools/verify-generator.mjs
 * 真实流程：读取 addon 构建产物 template.mcaddon → 解析模板 →
 * 转换真实 .mid → 生成最终 mcaddon → 解包断言（含 PBE2 回读闭环）。
 */
import { readFileSync } from "node:fs";
import { readAddon } from "@bepack/addon";
import { midiBufferToSong } from "@piano/core/convert";
import {
    decodePbe2,
    encodePbe2,
    metasToAddonIndex,
    pbe2ToAddonModule,
    planImportChunks,
    ImportAssembler,
} from "@piano/core";
import { loadTemplate, parseExistingMidis } from "../packages/generator/src/template.ts";
import { generateAddonZip } from "../packages/generator/src/export.ts";
import { songEntryToEvents } from "../packages/generator/src/player.ts";

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

// 1. 默认模板：模板模式跳过 midi 拷贝，无内嵌曲目
const templateInfo = await loadTemplate(new Uint8Array(readFileSync(TEMPLATE)));
assert(templateInfo.songs.length === 0, "默认模板无内嵌曲目（模板模式跳过 midi 拷贝）");
assert(templateInfo.bpManifest.header?.name, "bp manifest 解析成功");

// 2. 构造"含内嵌曲目的模板"：注入曲目 A 的 PBE2 模块 + index
const songA = midiBufferToSong(new Uint8Array(readFileSync(MIDI_A)), "Beyond - 海阔天空");
assert(songA.id === "4beea226", `曲目 A 转换 id 正确：${songA.id}`);
const pbe2A = encodePbe2(songA);
const moduleA = pbe2ToAddonModule(pbe2A);
const tplAddon = templateInfo.addon;
tplAddon.writeText(`bp/scripts/midis/${songA.id}.js`, moduleA);
tplAddon.writeText(
    "bp/scripts/midis/index.js",
    metasToAddonIndex([{ id: songA.id, name: songA.name, duration: songA.duration }])
);
const embTemplate = await loadTemplate(await tplAddon.toBlob());
assert(embTemplate.songs.length === 1, "内嵌模板解析出 1 首");
assert(embTemplate.songs[0].id === songA.id && embTemplate.songs[0].isOriginal, "原曲目标记 isOriginal");
const embEvents = songEntryToEvents(embTemplate.songs[0]);
assert(embEvents.length > 0, `内嵌曲目可从 PBE2 转为试听事件：${embEvents.length} 个`);

// 3. 添加新曲目 B，导出
const songB = midiBufferToSong(new Uint8Array(readFileSync(MIDI_B)), "ChiliChill - 让风告诉你");
const pbe2B = encodePbe2(songB);
const songs = [
    ...embTemplate.songs,
    {
        id: songB.id,
        name: songB.name,
        duration: songB.duration,
        noteCount: 1,
        isOriginal: false,
        data: pbe2B,
    },
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
const outAddon = await readAddon(blob);
const bpPath = outAddon.packs.bp.root;
const rpPath = outAddon.packs.rp.root;
const bpManifest = outAddon.packs.bp.manifest;
const rpManifest = outAddon.packs.rp.manifest;
assert(bpManifest.header.name === "测试钢琴包", "manifest 名称已应用");
assert(bpManifest.header.description === "e2e 描述", "manifest 描述已应用");
assert(bpManifest.header.uuid !== oldB && rpManifest.header.uuid !== oldR, "UUID 已随机化");
assert(
    bpManifest.dependencies.some((d) => d.uuid === rpManifest.header.uuid),
    "bp→rp 交叉依赖已更新"
);

// 5. 曲目内容断言
const midisDir = bpPath + "scripts/midis/";
const indexText = outAddon.readTextSync(midisDir + "index.js");
assert(indexText.startsWith("export const midis=["), "index.js 格式正确");
assert(indexText.includes(`id:"${songA.id}"`) && indexText.includes(`id:"${songB.id}"`), "index.js 含两首曲目");

const moduleAText = outAddon.readTextSync(midisDir + songA.id + ".js");
assert(moduleAText === pbe2ToAddonModule(pbe2A), "原曲目 A 模块由 PBE2 确定性重建");
const moduleBText = outAddon.readTextSync(midisDir + songB.id + ".js");
assert(moduleBText === pbe2ToAddonModule(pbe2B), "新曲目 B 模块与 core 输出一致");

// 6. 回读闭环：导出的包再次用生成器解析
const roundTrip = parseExistingMidis(outAddon, midisDir);
assert(roundTrip.length === 2, `导出后再解析：${roundTrip.length} 首（原 1 + 新 1）`);

// 7. PBE2 编解码往返
const decodedA = decodePbe2(pbe2A);
assert(
    decodedA.id === songA.id &&
        decodedA.name === songA.name &&
        decodedA.duration === songA.duration &&
        decodedA.tracks[0].notes.length / 4 ===
            songA.tracks.reduce((s, t) => s + t.notes.length / 4, 0),
    "PBE2 编解码往返一致"
);

// 8. 真实曲库读取：index.json 与 PBE2 一致
const libIndex = JSON.parse(readFileSync("midis/library/index.json", "utf8"));
assert(libIndex.length >= 225, `曲库目录 ${libIndex.length} 首`);
const libMeta = libIndex[0];
assert(!!libMeta.id && !!libMeta.name, "曲库 index 条目结构正确");
const libBytes = new Uint8Array(readFileSync(`midis/library/${libMeta.id}.bin`));
const libSong = decodePbe2(libBytes);
assert(
    libSong.id === libMeta.id &&
        libSong.name === libMeta.name &&
        libSong.duration === libMeta.duration &&
        libSong.tracks[0].notes.length > 0,
    "曲库 index 与 PBE2 解码一致"
);

// 9. 从曲库选曲导出闭环（模拟用户点"添加"）
const libTpl = await loadTemplate(new Uint8Array(readFileSync(TEMPLATE)));
const libEntry = {
    id: libSong.id,
    name: libSong.name,
    duration: libSong.duration,
    noteCount: libSong.tracks[0].notes.length / 4,
    isOriginal: false,
    fromLibrary: true,
    data: libBytes,
};
const libBlob = await generateAddonZip(libTpl, [libEntry], {
    name: "曲库测试",
    desc: "曲库导出验证",
    randomUuid: false,
});
const libAddon = await readAddon(libBlob);
const libIndexText = libAddon.readTextSync("bp/scripts/midis/index.js");
assert(libIndexText.includes(`id:"${libMeta.id}"`), "曲库曲目已写入导出 index.js");
const libModule = libAddon.readTextSync(`bp/scripts/midis/${libMeta.id}.js`);
assert(libModule === pbe2ToAddonModule(libBytes), "曲库曲目导出模块与 PBE2 输出一致");

// 10. 游戏内导入码：分段 → 装配 → 完整 PBE2
{
    const chunks = planImportChunks(pbe2B, 4800);
    assert(chunks.every((chunk) => chunk.length <= 4800), "导入码单段不超过 4800 字符");
    const assembler = new ImportAssembler();
    let result;
    for (const chunk of [...chunks].reverse()) result = assembler.add(chunk);
    assert(result?.status === "complete", "乱序分段可装配完成");
    assert(
        JSON.stringify(Array.from(result.payload)) === JSON.stringify(Array.from(pbe2B)),
        "装配结果与原始 PBE2 字节一致"
    );
}

console.log(failed === 0 ? "\n🎉 生成器 e2e 全部通过" : `\n💥 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
