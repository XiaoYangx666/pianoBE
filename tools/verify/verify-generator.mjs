/**
 * 生成器端到端验证（无浏览器）：bun tools/verify-generator.mjs
 * 真实流程：读取 addon 构建产物 template.mcaddon → 解析模板 →
 * 转换真实 .mid → 生成最终 mcaddon → 解包断言（含 PBE3 回读闭环）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { readAddon } from "@bepack/addon";
import { midiBufferToSong } from "@piano/core/convert";
import {
    attachPbe3Performance,
    decodePbe3,
    encodePbe3,
    metasToAddonIndex,
    pbe3ToAddonModule,
    planImportChunks,
    songToNoteEvents,
    ImportAssembler,
} from "@piano/core";
import {
    HOST_PARTICLE_IDS,
    readPbePluginArchive,
    writePbePluginArchive,
} from "@piano/vfx/package";
import {
    SCORE_PACK_SCRIPT_PATH,
    TIMBRES_SCRIPT_PATH,
    assembleAddonBlob,
    loadAddonTemplate,
    matchSongsToPlugins,
    parseExistingMidis,
    scoreStandPath,
    templateMidiTree,
} from "@piano/assembly";

const TEMPLATE = "packages/addon/dist/template.mcaddon";
const BARE_TEMPLATE = "packages/addon/dist/template-bare.mcaddon";
const MIDI_A = "midis/files/Beyond - 海阔天空.mid";
const MIDI_B = "midis/files/ChiliChill - 让风告诉你.mid";

let failed = 0;
async function storedZip(input) {
    // Avoid the Windows Bun worker burst when reading hundreds of compressed files.
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    return zipSync(unzipSync(bytes), { level: 0 });
}

function assert(cond, msg) {
    if (cond) console.log(`✅ ${msg}`);
    else {
        failed++;
        console.error(`❌ ${msg}`);
    }
}

// 1. 默认模板：模板模式跳过 midi 拷贝，无内嵌曲目
const templateInfo = await loadAddonTemplate(await storedZip(readFileSync(TEMPLATE)));
assert(templateInfo.songs.length === 0, "默认模板无内嵌曲目（模板模式跳过 midi 拷贝）");
assert(templateInfo.bpManifest.header?.name, "bp manifest 解析成功");

// 2. 构造"含内嵌曲目的模板"：注入曲目 A 的 PBE3 模块 + index
const songA = midiBufferToSong(new Uint8Array(readFileSync(MIDI_A)), "Beyond - 海阔天空");
assert(songA.id === "4beea226", `曲目 A 转换 id 正确：${songA.id}`);
const pbe3A = encodePbe3(songA);
const moduleA = pbe3ToAddonModule(pbe3A);
const tplAddon = templateInfo.addon;
tplAddon.writeText(`bp/scripts/midis/${songA.id}.js`, moduleA);
tplAddon.writeText(
    "bp/scripts/midis/index.js",
    metasToAddonIndex([{ id: songA.id, name: songA.name, duration: songA.duration }])
);
const embTemplate = await loadAddonTemplate(await storedZip(await tplAddon.toBlob()));
assert(embTemplate.songs.length === 1, "内嵌模板解析出 1 首");
assert(embTemplate.songs[0].id === songA.id && embTemplate.songs[0].isOriginal, "原曲目标记 isOriginal");
const embEvents = songToNoteEvents(embTemplate.songs[0].data);
assert(embEvents.length > 0, `内嵌曲目可从 PBE3 转为试听事件：${embEvents.length} 个`);

// 3. 添加新曲目 B，导出
const songB = midiBufferToSong(new Uint8Array(readFileSync(MIDI_B)), "ChiliChill - 让风告诉你");
const pbe3B = encodePbe3(songB);
const songs = [
    ...embTemplate.songs,
    {
        id: songB.id,
        name: songB.name,
        duration: songB.duration,
        noteCount: 1,
        isOriginal: false,
        data: pbe3B,
    },
];
const oldB = embTemplate.bpManifest.header.uuid;
const oldR = embTemplate.rpManifest.header.uuid;
const blob = await assembleAddonBlob(embTemplate, songs, {
    name: "测试钢琴包",
    desc: "e2e 描述",
    randomUuid: true,
});
assert(blob.size > 0, `导出 zip 生成 (${(blob.size / 1024).toFixed(0)} KB)`);

// 4. manifest 断言
const outAddon = await readAddon(await storedZip(blob));
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
const midisDir = templateMidiTree(outAddon, bpPath);
const indexText = outAddon.readTextSync(midisDir + "index.js");
assert(indexText.startsWith("export const midis=["), "index.js 格式正确");
assert(indexText.includes(`id:"${songA.id}"`) && indexText.includes(`id:"${songB.id}"`), "index.js 含两首曲目");

const moduleAText = outAddon.readTextSync(midisDir + songA.id + ".js");
assert(moduleAText === pbe3ToAddonModule(pbe3A), "原曲目 A 模块由 PBE3 确定性重建");
const moduleBText = outAddon.readTextSync(midisDir + songB.id + ".js");
assert(moduleBText === pbe3ToAddonModule(pbe3B), "新曲目 B 模块与 core 输出一致");

// 6. 回读闭环：导出的包再次用生成器解析
const roundTrip = parseExistingMidis(outAddon, midisDir);
assert(roundTrip.length === 2, `导出后再解析：${roundTrip.length} 首（原 1 + 新 1）`);

// 7. PBE3 编解码往返
const decodedA = decodePbe3(pbe3A);
assert(
    decodedA.id === songA.id &&
        decodedA.name === songA.name &&
        decodedA.duration === songA.duration &&
        decodedA.tracks[0].notes.length / 4 ===
            songA.tracks.reduce((s, t) => s + t.notes.length / 4, 0),
    "PBE3 编解码往返一致"
);

// 8. 真实曲库读取：index.json 与 PBE3 一致
const libIndex = JSON.parse(readFileSync("midis/library/index.json", "utf8"));
assert(libIndex.length >= 225, `曲库目录 ${libIndex.length} 首`);
const libMeta = libIndex[0];
assert(!!libMeta.id && !!libMeta.name, "曲库 index 条目结构正确");
const libBytes = new Uint8Array(readFileSync(`midis/library/${libMeta.id}.pbe3`));
const libSong = decodePbe3(libBytes);
assert(
    libSong.id === libMeta.id &&
        libSong.name === libMeta.name &&
        libSong.duration === libMeta.duration &&
        libSong.tracks[0].notes.length > 0,
    "曲库 index 与 PBE3 解码一致"
);

// 9. 从曲库选曲导出闭环（模拟用户点"添加"）
const libTpl = await loadAddonTemplate(await storedZip(readFileSync(TEMPLATE)));
const libEntry = {
    id: libSong.id,
    name: libSong.name,
    duration: libSong.duration,
    noteCount: libSong.tracks[0].notes.length / 4,
    isOriginal: false,
    fromLibrary: true,
    data: libBytes,
};
const libBlob = await assembleAddonBlob(libTpl, [libEntry], {
    name: "曲库测试",
    desc: "曲库导出验证",
    randomUuid: false,
});
const libAddon = await readAddon(await storedZip(libBlob));
const libMidiDir = templateMidiTree(libAddon, libAddon.packs.bp.root);
const libIndexText = libAddon.readTextSync(libMidiDir + "index.js");
assert(libIndexText.includes(`id:"${libMeta.id}"`), "曲库曲目已写入导出 index.js");
const libModule = libAddon.readTextSync(`${libMidiDir}${libMeta.id}.js`);
assert(libModule === pbe3ToAddonModule(libBytes), "曲库曲目导出模块与 PBE3 输出一致");

// 10. 游戏内导入码：分段 → 装配 → 完整 PBE3
{
    const chunks = planImportChunks(pbe3B, 4800);
    assert(chunks.every((chunk) => chunk.length <= 4800), "导入码单段不超过 4800 字符");
    const assembler = new ImportAssembler();
    let result;
    for (const chunk of [...chunks].reverse()) result = assembler.add(chunk);
    assert(result?.status === "complete", "乱序分段可装配完成");
    assert(
        JSON.stringify(Array.from(result.payload)) === JSON.stringify(Array.from(pbe3B)),
        "装配结果与原始 PBE3 字节一致"
    );
}

// 11. 零插件模式导出：从含插件模板剥离并输出纯净底包
async function inspectZip(blob) {
    const raw = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const dec = new TextDecoder();
    return {
        paths: Object.keys(raw),
        has: (p) => Object.hasOwn(raw, p),
        readTextSync: (p) => (raw[p] ? dec.decode(raw[p]) : undefined),
    };
}

{
    const zeroBlob = await assembleAddonBlob(libTpl, [libEntry], {
        name: "零插件测试",
        desc: "bare",
        randomUuid: false,
        plugins: [],
    });
    const zeroZip = await inspectZip(zeroBlob);
    const zBp = "bp/";
    const zRp = "rp/";
    const entries = zeroZip.paths;
    const pluginScripts = entries.filter((p) => p.startsWith(`${zBp}scripts/plugins/`));
    const rpParticles = entries.filter((p) =>
        new RegExp(`^${zRp}particles/pbe_vfx_.+\\.particle\\.json$`).test(p)
    );
    const keysTextures = entries.filter((p) => p.startsWith(`${zRp}textures/particle/piano_fx`));
    const pluginsJs = zeroZip.readTextSync(`${zBp}scripts/vfx/plugins.js`) ?? "";

    assert(zeroZip.has(`${zBp}scripts/vfx/host.js`), "零插件包保留 Host VFX API 入口 (host.js)");
    assert(pluginsJs.includes("INSTALLED_VFX_PLUGINS = []"), "零插件包 plugins.js 注册列表为空");
    assert(pluginScripts.length === 0, "零插件包无 scripts/plugins/ 残留脚本");
    assert(
        rpParticles.length === HOST_PARTICLE_IDS.length,
        `零插件包保留 ${HOST_PARTICLE_IDS.length} 个 Host 粒子文档（实际 ${rpParticles.length}）`
    );
    assert(keysTextures.length === 0, "零插件包无 keys 插件专属贴图残留");
}

// 12. PBE3 特效需求提取与插件自动匹配
{
    const pbe3Perf = attachPbe3Performance(pbe3B, [
        { tick: 0, op: "set", effect: "starfield", fade: 8, color: "#8EB8FF", level: 80, scale: 100 },
        { tick: 40, op: "flash", effect: "key_notes", color: "#FFE29A", level: 90, scale: 100 },
        { tick: 80, op: "flash", effect: "unknown_custom_fx", color: "#FFFFFF", level: 70, scale: 100 },
    ]);
    const perfSong = { ...libEntry, id: "perf-b", name: "测试演出曲目", data: pbe3Perf };
    const extracted = matchSongsToPlugins([perfSong], [], []).songEffects.get(perfSong.id) ?? [];
    assert(
        JSON.stringify(extracted) === JSON.stringify(["key_notes", "starfield", "unknown_custom_fx"]),
        `PBE3 特效 ID 提取正确：${extracted.join(", ")}`
    );

    const pluginFiles = readdirSync("build/plugins").filter((f) => f.endsWith(".pbeplugin")).sort();
    const archives = pluginFiles.map((file) =>
        readPbePluginArchive(new Uint8Array(readFileSync(`build/plugins/${file}`)))
    );
    const entries = archives.map((archive) => ({
        id: archive.manifest.id,
        manifest: archive.manifest,
        trusted: true,
        compatible: true,
        archive,
    }));

    const fullMatch = matchSongsToPlugins([perfSong], entries, entries.map((e) => e.id));
    assert(
        fullMatch.requiredPluginIds.includes("pianobe.atmosphere") &&
            fullMatch.requiredPluginIds.includes("pianobe.keys"),
        "PBE3 特效匹配选中 pianobe.atmosphere 与 pianobe.keys"
    );
    assert(
        fullMatch.missingEffects.some((m) => m.effect === "unknown_custom_fx"),
        "未知特效 unknown_custom_fx 报告为缺失特效"
    );

    const deselectedMatch = matchSongsToPlugins(
        [perfSong],
        entries,
        entries.map((e) => e.id).filter((id) => id !== "pianobe.keys")
    );
    assert(
        deselectedMatch.disabledRequiredEffects.some(
            (d) => d.effect === "key_notes" && d.pluginId === "pianobe.keys"
        ),
        "手动取消 pianobe.keys 后报告 key_notes 将无法呈现"
    );
}

// 13. 多插件统一装配到基础模板（template-bare.mcaddon）
const bareTpl = await loadAddonTemplate(await storedZip(readFileSync(BARE_TEMPLATE)));
{
    const selectedArchives = [
        "pianobe.atmosphere.pbeplugin",
        "pianobe.keys.pbeplugin",
        "pianobe.themes.pbeplugin",
        "pianobe.accents.pbeplugin",
        "pianobe.curves.pbeplugin",
        "pianobe.stage.pbeplugin",
    ].map((name) => readPbePluginArchive(new Uint8Array(readFileSync(`build/plugins/${name}`))));

    const assembledBlob = await assembleAddonBlob(bareTpl, [libEntry], {
        name: "插件装配测试",
        desc: "multi-plugin assembly",
        randomUuid: false,
        plugins: selectedArchives,
    });
    const out = await inspectZip(assembledBlob);
    const oBp = bareTpl.bpPath;
    const oRp = bareTpl.rpPath;

    const atmoJs = out.readTextSync(`${oBp}scripts/plugins/pianobe_atmosphere/vfx/index.js`) ?? "";
    const keysJs = out.readTextSync(`${oBp}scripts/plugins/pianobe_keys/vfx/index.js`) ?? "";
    const themesJs = out.readTextSync(`${oBp}scripts/plugins/pianobe_themes/vfx/index.js`) ?? "";
    assert(atmoJs.length > 0 && keysJs.length > 0 && themesJs.length > 0, "三个插件 vfx/index.js 均已装配写入");
    assert(
        atmoJs.includes('"../../../vfx/host.js"') && keysJs.includes('"../../../vfx/host.js"'),
        "插件 @piano/vfx 导入已重写为 ../../../vfx/host.js"
    );
    assert(
        !/["']@piano\/vfx["']/.test(atmoJs) && !/["']@piano\/vfx["']/.test(keysJs) && !/["']@piano\/vfx["']/.test(themesJs),
        "已装配插件脚本不含裸 @piano/vfx 导入"
    );

    const loaderText = out.readTextSync(`${oBp}scripts/vfx/plugins.js`) ?? "";
    assert(
        loaderText.includes('from "./host.js"') &&
            loaderText.includes("registerVfxPlugin") &&
            loaderText.includes('from "../plugins/pianobe_atmosphere/vfx/index.js"') &&
            loaderText.includes('from "../plugins/pianobe_keys/vfx/index.js"') &&
            loaderText.includes('from "../plugins/pianobe_themes/vfx/index.js"'),
        "scripts/vfx/plugins.js 静态导入所有已选插件与宿主注册 API"
    );
    assert(
        loaderText.includes('"pianobe.atmosphere"') &&
            loaderText.includes('"pianobe.keys"') &&
            loaderText.includes('"pianobe.themes"'),
        "INSTALLED_VFX_PLUGINS 列表包含全部已装配插件 ID"
    );
    assert(
        out.has(`${oRp}particles/pbe_vfx_key_stream.particle.json`) &&
            out.has(`${oRp}textures/particle/piano_fx.png`),
        "keys 插件专属粒子与贴图已正确合并至 rp/"
    );
}

// 14. 第三方插件 + 音色 + 曲谱组合装配与二次导出零残留清理
{
    const thirdPartyBytes = writePbePluginArchive({
        "plugin.json": JSON.stringify({
            id: "acme.custom_fx",
            name: "Acme Custom FX",
            version: "1.0.0",
            apiVersion: "1.0.0",
            minPianoBeVersion: "1.3.0",
            capabilities: ["vfx"],
            author: "Acme",
            license: "MIT",
            provides: {
                effects: ["acme_spark"],
                particles: ["acme_spark"],
            },
        }),
        "vfx/index.js": [
            'import { drawPoints } from "@piano/vfx";',
            "const plugin = {",
            '  manifest: { id: "acme.custom_fx", name: "Acme Custom FX", version: "1.0.0", apiVersion: "1.0.0", minPianoBeVersion: "1.3.0", capabilities: ["vfx"], author: "Acme", license: "MIT", provides: { effects: ["acme_spark"], particles: ["acme_spark"] } },',
            "  register(api) {",
            '    api.registerEffect({ id: "acme_spark", label: "Acme Spark", category: "accent", trigger: "instant", emit: () => ({ emitters: drawPoints({ count: 1, particle: "acme_spark", color: "#FFFFFF" }), interval: 1 }) });',
            "  },",
            "};",
            "export default plugin;",
        ].join("\n"),
        "particles/pbe_vfx_acme_spark.particle.json": JSON.stringify({
            format_version: "1.10.0",
            particle_effect: {
                description: {
                    identifier: "pbe:vfx_acme_spark",
                    basic_render_parameters: {
                        material: "particles_alpha",
                        texture: "textures/custom/acme_spark",
                    },
                },
                components: {},
            },
        }),
        "textures/custom/acme_spark.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const thirdPartyArchive = readPbePluginArchive(thirdPartyBytes);
    const pagePath = "textures/ui/piano_score/custom_score/page_1.png";
    const standPath = scoreStandPath("custom_score");
    const dummyPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const comboBlob = await assembleAddonBlob(bareTpl, [libEntry], {
        name: "组合装配测试",
        desc: "third-party + timbre + score",
        randomUuid: false,
        plugins: [thirdPartyArchive],
        timbres: {
            all: [
                {
                    id: "piano",
                    value: 0,
                    label: "标准钢琴",
                    description: "",
                    required: true,
                    bundled: true,
                    dirs: { v1: "grand" },
                    notes: [],
                    layers: ["v1"],
                    size: 0,
                    file: null,
                },
            ],
            selected: [],
            enabledIds: ["piano"],
        },
        scores: [
            {
                id: "custom_score",
                title: "测试曲谱",
                pages: [pagePath],
                source: "custom",
                assets: new Map([
                    [pagePath, dummyPng],
                    [standPath, dummyPng],
                ]),
            },
        ],
    });

    const comboOut = await inspectZip(comboBlob);
    const cBp = bareTpl.bpPath;
    const cRp = bareTpl.rpPath;
    const tpJs = comboOut.readTextSync(`${cBp}scripts/plugins/acme_custom_fx/vfx/index.js`) ?? "";
    assert(tpJs.includes('"../../../vfx/host.js"'), "第三方插件脚本导入已重写为 ../../../vfx/host.js");
    assert(
        comboOut.has(`${cRp}particles/pbe_vfx_acme_spark.particle.json`) &&
            comboOut.has(`${cRp}textures/custom/acme_spark.png`),
        "第三方插件自定义粒子与非 particle/ 路径纹理已写入 rp/"
    );
    assert(
        (comboOut.readTextSync(`${cBp}${TIMBRES_SCRIPT_PATH}`) ?? "").includes("ENABLED_PIANO_TIMBRES") &&
            (comboOut.readTextSync(`${cBp}${SCORE_PACK_SCRIPT_PATH}`) ?? "").includes("custom_score") &&
            comboOut.has(`${cRp}${pagePath}`),
        "第三方 VFX 插件与音色、曲谱组合装配共存完整"
    );

    const imported = await loadAddonTemplate(await storedZip(comboBlob));
    const cleanupBlob = await assembleAddonBlob(imported, [libEntry], {
        name: "二次清理测试",
        desc: "repeat export zero-plugin cleanup",
        randomUuid: false,
        plugins: [],
    });
    const cleanOut = await inspectZip(cleanupBlob);
    assert(
        !cleanOut.has(`${cBp}scripts/plugins/acme_custom_fx/vfx/index.js`) &&
            !cleanOut.has(`${cRp}particles/pbe_vfx_acme_spark.particle.json`) &&
            !cleanOut.has(`${cRp}textures/custom/acme_spark.png`) &&
            !cleanOut.has(`${cRp}textures/particle/piano_fx.png`),
        "二次切换零插件重复导出后，上一次插件脚本/粒子/自定义纹理零残留"
    );
}

console.log(failed === 0 ? "\n🎉 生成器 e2e 全部通过" : `\n💥 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
