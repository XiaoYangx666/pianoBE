import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import {
    attachSongPerformance,
    computeMusicFingerprint,
    decodePbe3,
    encodeSong,
    mergeSongCatalog,
    readSongHeader,
    TIME_SCALE,
} from "@piano/core";
import { unzipSync, zipSync } from "fflate";
import { build } from "esbuild";
import { assembleAddonBlob, loadAddonTemplate } from "@piano/assembly";
import {
    readPbePluginArchive, writePbePluginArchive, validatePluginAssembly,
    STAGE_PROP_BP_TREE, STAGE_PROP_RP_TREES, STAGE_PROP_REGISTRY_SCRIPT,
} from "@piano/vfx/package";

function pbe3ToEntry(data) {
    const header = readSongHeader(data);
    return {
        id: header.id,
        name: header.name,
        duration: header.duration,
        noteCount: header.noteCount,
        bytes: data.length,
        musicFingerprint: computeMusicFingerprint(data),
        data,
    };
}

const bare = new Uint8Array(await readFile("packages/addon/dist/template-bare.mcaddon"));
const readPlugin = async id => readPbePluginArchive(new Uint8Array(await readFile(`build/plugins/${id}.pbeplugin`)));
const [sinner, chinese, legacy] = await Promise.all(["pianobe.sinner", "pianobe.chinese", "pianobe.stage"].map(readPlugin));
const registration = (archive) => archive.stageProps[0].registration;
const exportOptions = { name: "PianoBE Stage Props", desc: "Stage prop verification", randomUuid: false };
const isPropFile = (path, bp, rp) =>
    path.startsWith(bp + STAGE_PROP_BP_TREE) || STAGE_PROP_RP_TREES.some(tree => path.startsWith(rp + tree));
const doc = (addon, path) => JSON.parse(addon.readTextSync(path));
const readSong = async id => pbe3ToEntry(new Uint8Array(await readFile(`midis/library/${id}.pbe3`)));

async function readTemplate(input) {
    // Bun on Windows can exhaust worker threads while inflating a full pack.
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    return loadAddonTemplate(zipSync(unzipSync(bytes), { level: 0 }));
}

async function loadExportedHost(addon) {
    const root = addon.packs.bp.root + "scripts/vfx/";
    const compiled = await build({
        stdin: { contents: `
            export * from "./host.js";
            export * from "./stagePropCatalog.js";
            export { registerVfxPlugins } from "./plugins.js";
        ` },
        bundle: true, format: "esm", write: false,
        plugins: [{
            name: "addon",
            setup(build) {
                build.onResolve({ filter: /.*/ }, args => ({
                    path: posix.join(args.namespace === "addon" ? posix.dirname(args.importer) : root, args.path),
                    namespace: "addon",
                }));
                build.onLoad({ filter: /.*/, namespace: "addon" }, args => {
                    const contents = addon.readTextSync(args.path);
                    assert.ok(contents, `Missing script dependency ${args.path}`);
                    return { contents, loader: "js" };
                });
            },
        }],
    });
    return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`);
}

function verifyResources(addon, archive) {
    const { declaration, registration: prop } = archive.stageProps[0];
    const bp = addon.packs.bp.root;
    const rp = addon.packs.rp.root;
    const stem = prop.entityId.split(":")[1];
    const server = doc(addon, bp + STAGE_PROP_BP_TREE + stem + ".json")["minecraft:entity"];
    const client = doc(addon, rp + STAGE_PROP_RP_TREES[0] + stem + ".entity.json")["minecraft:client_entity"].description;
    const geometry = doc(addon, rp + STAGE_PROP_RP_TREES[1] + stem + ".geo.json")["minecraft:geometry"][0];
    const animations = doc(addon, rp + STAGE_PROP_RP_TREES[2] + stem + ".animation.json").animations;
    assert.equal(server.description.identifier, prop.entityId);
    assert.equal(client.identifier, prop.entityId);
    assert.equal(server.description.properties["pbe:vfx_animation"].client_sync, true);
    assert.ok(Object.hasOwn(server.components, "minecraft:transient"));
    assert.equal(client.geometry.default, geometry.description.identifier);
    for (const animated of client.scripts.animate) {
        const alias = typeof animated === "string" ? animated : Object.keys(animated)[0];
        const clip = animations[client.animations[alias]];
        assert.ok(clip, `Animation ${alias} must resolve`);
        assert.ok(Object.keys(clip.bones).every(name => geometry.bones.some(bone => bone.name === name)));
    }
    const texture = client.textures.default;
    assert.deepEqual(addon.readSync(rp + texture + ".png").bytes, archive.files.get(declaration.texture));
    if (declaration.merTexture) {
        const set = doc(addon, rp + texture + ".texture_set.json")["minecraft:texture_set"];
        assert.equal(set.color, posix.basename(texture));
        assert.deepEqual(addon.readSync(rp + posix.dirname(texture) + "/" + set.metalness_emissive_roughness + ".png").bytes,
            archive.files.get(declaration.merTexture));
    }
    assert.equal(addon.packs.bp.manifest.dependencies.some(dep => dep.uuid === addon.packs.rp.manifest.header.uuid), true);
}

const output = "build/stage-props";
await mkdir(output, { recursive: true });
for (const [archive, songId, time] of [[sinner, "28a2cb50", 6], [chinese, "f3b8fb2", 182]]) {
    const template = await readTemplate(bare);
    assert.ok(!template.addon.entries().some(({ path }) => isPropFile(path, template.bpPath, template.rpPath)));
    assert.equal(template.addon.readTextSync(template.bpPath + STAGE_PROP_REGISTRY_SCRIPT).trim(),
        "export const STAGE_PROP_REGISTRATIONS = [];");
    const song = await readSong(songId);
    const blob = await assembleAddonBlob(template, [song], { ...exportOptions, plugins: [archive] });
    const { addon, bpPath, songs } = await readTemplate(blob);
    assert.deepEqual(songs[0].data, song.data);
    const managerPath = bpPath + "scripts/midiManager.js";
    const midiEntry = addon.readTextSync(managerPath).match(/from ["'](.*?midis\/index\.js)["']/)[1];
    assert.ok(addon.readTextSync(posix.join(posix.dirname(managerPath), midiEntry)).includes(`id:"${songId}"`));
    verifyResources(addon, archive);
    assert.equal(addon.entries().filter(({ path }) => path.startsWith(bpPath + STAGE_PROP_BP_TREE)).length, 1);
    const host = await loadExportedHost(addon);
    host.registerVfxPlugins();
    assert.deepEqual(host.STAGE_PROP_REGISTRATIONS, [registration(archive)]);
    assert.ok(host.vfxRegistry.hasPlugin(archive.manifest.id));
    const decoded = decodePbe3(song.data);
    assert.equal(host.hasAvailablePerformanceEffects(decoded.performance), true);
    const engine = new host.VfxEngine(host.createPerformanceProgram(decoded.performance, decoded.duration / TIME_SCALE), "grand");
    engine.seek(time, true);
    assert.equal(engine.stageProp(time, host.quietFeatures)?.id, registration(archive).id);
    await writeFile(`${output}/${archive.manifest.id}.mcaddon`, new Uint8Array(await blob.arrayBuffer()));
    console.log(`[stage-props] ${archive.manifest.id} works from the bare template with its own PBE3 song`);
}

const fixtureDecl = {
    id: "animated_lantern", geometry: "stage_props/lantern.geo.json", texture: "stage_props/lantern.png",
    animations: "stage_props/lantern.animation.json",
};
const fixtureId = "fixture.stage-tools";
const fixtureManifest = {
    id: fixtureId, name: "Stage prop fixture", author: "PianoBE", license: "CC-BY-NC-4.0",
    version: "1.0.0", apiVersion: "1.0.0", minPianoBeVersion: "1.3.0",
    capabilities: ["vfx", "vfx.stageProps"], stageProps: [fixtureDecl], provides: { effects: ["fixture_prop"] },
};
const fixtureFiles = {
    "plugin.json": JSON.stringify(fixtureManifest),
    "vfx/index.js": `export default {
        register(api) { api.registerEffect({
            id: "fixture_prop", label: "Lantern", category: "stage", trigger: "continuous", interval: 1,
            emit: () => null,
            resolveStageProp: () => ({
                id: "${fixtureId}:animated_lantern", offset: { x: 1, y: 2, z: 3 }, size: 1, turn: 90, animation: "sway",
            }),
        }); },
    };`,
    [fixtureDecl.geometry]: JSON.stringify({
        format_version: "1.12.0",
        "minecraft:geometry": [{
            description: { identifier: "geometry.fixture", texture_width: 512, texture_height: 512 },
            bones: [{ name: "lantern", pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] }],
        }],
    }),
    [fixtureDecl.texture]: chinese.files.get(chinese.stageProps[0].declaration.texture),
    [fixtureDecl.animations]: JSON.stringify({
        format_version: "1.8.0", animations: {
            "animation.sway": { loop: true, animation_length: 1, bones: { lantern: { rotation: { "0": [0, 0, 0], "1": [0, 90, 0] } } } },
        },
    }),
};
const fixture = readPbePluginArchive(writePbePluginArchive(fixtureFiles));
const broken = { ...fixtureFiles };
delete broken[fixtureDecl.texture];
assert.throws(() => readPbePluginArchive(writePbePluginArchive(broken)), /缺少道具资源/);
assert.throws(() => readPbePluginArchive(writePbePluginArchive({
    ...fixtureFiles, "plugin.json": JSON.stringify({ ...fixtureManifest, stageProps: [fixtureDecl, fixtureDecl] }),
})), /重复标识符/);
assert.throws(() => readPbePluginArchive(writePbePluginArchive({
    ...fixtureFiles, [fixtureDecl.animations]: fixtureFiles[fixtureDecl.animations].replace('"lantern"', '"missing_bone"'),
})), /骨骼 missing_bone/);
assert.throws(() => readPbePluginArchive(writePbePluginArchive({
    ...fixtureFiles, [STAGE_PROP_RP_TREES[3] + "override.png"]: fixtureFiles[fixtureDecl.texture],
})), /由舞台道具装配器管理/);

const consumerManifest = {
    ...fixtureManifest, id: "fixture.consumer", capabilities: ["vfx"], stageProps: undefined,
    dependencies: [fixtureId], provides: { effects: ["fixture_consumer"] },
};
const consumerFiles = {
    "plugin.json": JSON.stringify(consumerManifest),
    "vfx/index.js": 'export { default } from "./helpers/consumer.js";',
    "vfx/helpers/consumer.js": 'import { TIME_SCALE } from "@piano/core";\n'
        + fixtureFiles["vfx/index.js"].replace('"fixture_prop"', '"fixture_consumer"').replace('interval: 1', 'interval: TIME_SCALE / 40'),
};
const consumer = readPbePluginArchive(writePbePluginArchive(consumerFiles));
assert.throws(() => readPbePluginArchive(writePbePluginArchive({
    "plugin.json": consumerFiles["plugin.json"], "vfx/index.js": consumerFiles["vfx/index.js"],
})), /缺失模块/);
assert.throws(() => validatePluginAssembly([consumer]), /缺少依赖/);
const cycle = readPbePluginArchive(writePbePluginArchive({
    ...fixtureFiles, "plugin.json": JSON.stringify({ ...fixtureManifest, dependencies: [consumerManifest.id] }),
}));
assert.throws(() => validatePluginAssembly([cycle, consumer]), /循环依赖/);
assert.deepEqual(validatePluginAssembly([consumer, fixture]).map(item => item.manifest.id), [fixtureId, consumerManifest.id]);
const collision = readPbePluginArchive(writePbePluginArchive({
    ...consumerFiles, "plugin.json": JSON.stringify({ ...consumerManifest, provides: fixtureManifest.provides }),
}));
assert.throws(() => validatePluginAssembly([fixture, collision]), /effects\/fixture_prop/);

const texturePath = "textures/particle/fixture_shared.png";
const provider = readPbePluginArchive(writePbePluginArchive({ ...fixtureFiles, [texturePath]: fixtureFiles[fixtureDecl.texture] }));
const particle = "fixture_consumer_particle";
const particleFiles = {
    ...consumerFiles,
    "plugin.json": JSON.stringify({ ...consumerManifest, provides: { ...consumerManifest.provides, particles: [particle] } }),
    [`particles/pbe_vfx_${particle}.particle.json`]: JSON.stringify({
        particle_effect: { description: { identifier: `pbe:vfx_${particle}`, basic_render_parameters: { texture: texturePath.slice(0, -4) } } },
    }),
};
const crossTexture = readPbePluginArchive(writePbePluginArchive(particleFiles));
assert.throws(() => validatePluginAssembly([fixture, crossTexture]), /未由声明依赖提供/);
assert.equal(validatePluginAssembly([crossTexture, provider]).length, 2);
const textureCollision = readPbePluginArchive(writePbePluginArchive({ ...consumerFiles, [texturePath.toUpperCase().replace("TEXTURES/", "textures/")]: fixtureFiles[fixtureDecl.texture] }));
assert.throws(() => validatePluginAssembly([provider, textureCollision]), /插件资源冲突/);

const instrument = { family: "", number: 0, name: "" };
const plain = encodeSong({ id: "aa", name: "同名", duration: 400, tracks: [{ instrument, notes: [60, 0, 20, 80] }] });
const different = encodeSong({ id: "aa", name: "同名", duration: 400, tracks: [{ instrument, notes: [62, 0, 20, 80] }] });
const originalDifferentId = encodeSong({ id: "bb", name: "改名", duration: 400, tracks: [{ instrument, notes: [60, 0, 20, 80] }] });
const firstCue = { op: "set", tick: 0, effect: "fixture_prop", color: "#FFFFFF", level: 90, scale: 100, fade: 0 };
const secondCue = { ...firstCue, effect: "fixture_consumer" };
const firstShow = attachSongPerformance(originalDifferentId, [firstCue]);
const secondShow = attachSongPerformance(plain, [secondCue]);
const { songs: grouped } = mergeSongCatalog([], [plain, firstShow, secondShow, firstShow, different].map(data => pbe3ToEntry(data)), { reidentifyOnIdConflict: true });
assert.equal(grouped.length, 2);
assert.equal(grouped[0].id, "aa");
assert.deepEqual(grouped[0].data, plain);
assert.equal(grouped[0].performanceEntries.length, 2);
assert.notEqual(grouped[1].id, grouped[0].id);
assert.equal(readSongHeader(grouped[1].data).id, grouped[1].id);
assert.deepEqual(grouped.map(song => song.name), ["同名", "同名"]);

const template = await readTemplate(bare);
const combined = await assembleAddonBlob(template, grouped, { ...exportOptions, plugins: [sinner, chinese, legacy, consumer, fixture] });
const { addon: combinedAddon, songs: roundTripSongs } = await readTemplate(combined);
assert.equal(roundTripSongs.length, 2);
assert.deepEqual(roundTripSongs[0].data, plain);
assert.deepEqual(roundTripSongs[0].performanceEntries.map(p => p.cues[0].effect), ["fixture_prop", "fixture_consumer"]);
verifyResources(combinedAddon, fixture);
const host = await loadExportedHost(combinedAddon);
host.registerVfxPlugins();
assert.ok(host.vfxRegistry.hasPlugin(legacy.manifest.id));
assert.deepEqual(host.STAGE_PROP_REGISTRATIONS.map(prop => prop.id), [sinner, chinese, fixture].map(archive => registration(archive).id));
const program = host.createSingleEffectProgram({ effect: "fixture_prop", seconds: 2, color: "#ffffff" });
const engine = new host.VfxEngine(program);
assert.equal(engine.stageProp(0, host.quietFeatures)?.animation, "sway");
const crossProp = new host.VfxEngine(host.createSingleEffectProgram({ effect: "fixture_consumer", seconds: 2, color: "#ffffff" }));
assert.equal(crossProp.stageProp(0, host.quietFeatures)?.id, registration(fixture).id);
assert.deepEqual(host.missingPerformanceResources([firstCue, secondCue]), []);
assert.equal(host.hasAvailablePerformanceEffects([firstCue, secondCue]), true);
host.unregisterVfxPlugin(fixtureId);
assert.equal(crossProp.stageProp(0, host.quietFeatures), undefined);
assert.deepEqual(host.missingPerformanceResources([firstCue, secondCue]), ["fixture_prop", "fixture_consumer"]);
assert.equal(host.hasAvailablePerformanceEffects([firstCue, secondCue]), false);

// Re-import the actual export to exercise cleanup without in-memory bookkeeping.
const previous = await readTemplate(combined);
const empty = await assembleAddonBlob(previous, [], { ...exportOptions, plugins: [] });
const result = await readTemplate(empty);
assert.ok(!result.addon.entries().some(({ path }) => isPropFile(path, result.bpPath, result.rpPath)));
assert.deepEqual((await loadExportedHost(result.addon)).STAGE_PROP_REGISTRATIONS, []);
console.log("[stage-props] validated a third prop with an animation, legacy plugin loading and clean re-export");
console.log("[plugin-release] validated song grouping, animation sidecar round-trip and cross-plugin references");
