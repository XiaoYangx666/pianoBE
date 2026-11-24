import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readSongHeader } from "@piano/core";
import {
    quietFeatures,
    missingPerformanceResources,
    resolveKeyParticle,
    validateVfxTheme,
    VFX_PARTICLES_PER_PIANO,
    VfxRegistry,
} from "@piano/vfx";
import {
    HOST_PARTICLE_IDS,
    readPbePluginArchive,
    validatePluginAssembly,
} from "@piano/vfx/package";
import { listBuiltinPluginDirs, packPluginDirectory } from "./pack-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vfxEntryUrl = pathToFileURL(join(root, "packages/vfx/src/index.ts")).href;
const coreEntryUrl = pathToFileURL(join(root, "packages/core/src/index.ts")).href;

function sorted(items) {
    return [...(items ?? [])].sort();
}

function assertSameSet(actual, expected, label, pluginId) {
    const a = sorted(actual);
    const e = sorted(expected);
    if (a.length !== e.length || a.some((value, idx) => value !== e[idx])) {
        throw new Error(`插件 ${pluginId} ${label} 不匹配：清单声明 [${e.join(", ")}]，实际注册 [${a.join(", ")}]`);
    }
}

function rewriteWorkspaceImportsForTemp(source) {
    return source
        .replace(/(from\s*|import\s*\(\s*)(["'])@piano\/vfx\2/g, `$1$2${vfxEntryUrl}$2`)
        .replace(/(from\s*|import\s*\(\s*)(["'])@piano\/core\2/g, `$1$2${coreEntryUrl}$2`);
}

function verifyFiniteEmitter(emitter, allowedParticles, pluginId, contextLabel) {
    if (!allowedParticles.has(emitter.particle)) {
        throw new Error(`插件 ${pluginId} (${contextLabel}) 引用了未声明粒子：${emitter.particle}`);
    }
    if (!Number.isFinite(emitter.particles) || emitter.particles < 0) {
        throw new Error(`插件 ${pluginId} (${contextLabel}) 粒子数量无效：${emitter.particles}`);
    }
    if (!Number.isFinite(emitter.lifetime) || emitter.lifetime <= 0) {
        throw new Error(`插件 ${pluginId} (${contextLabel}) lifetime 无效：${emitter.lifetime}`);
    }
    for (const axis of ["x", "y", "z"]) {
        if (!Number.isFinite(emitter.offset[axis])) {
            throw new Error(`插件 ${pluginId} (${contextLabel}) offset.${axis} 非有限值`);
        }
    }
    for (const [key, value] of Object.entries(emitter.variables)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`插件 ${pluginId} (${contextLabel}) 变量 ${key}=${value} 非有限值`);
        }
    }
}

async function importArchiveVfxModule(archive) {
    const tempDir = mkdtempSync(join(tmpdir(), "pbe-plugin-validate-"));
    try {
        for (const [relPath, bytes] of archive.files) {
            if (!relPath.startsWith("vfx/")) continue;
            const outFile = join(tempDir, relPath);
            mkdirSync(dirname(outFile), { recursive: true });
            const code = rewriteWorkspaceImportsForTemp(Buffer.from(bytes).toString("utf8"));
            writeFileSync(outFile, code);
        }
        writeFileSync(join(tempDir, "package.json"), '{"type":"module"}');
        const entryFile = join(tempDir, "vfx", "index.js");
        const mod = await import(`${pathToFileURL(entryFile).href}?t=${Date.now()}`);
        const pluginModule = mod.default;
        if (!pluginModule || typeof pluginModule !== "object" || typeof pluginModule.register !== "function") {
            throw new Error(`插件 ${archive.manifest.id} 的 vfx/index.js 必须默认导出 VfxPluginModule (export default ...)`);
        }
        return pluginModule;
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

async function readTarget(targetPath) {
    const absPath = resolve(targetPath);
    const bytes = absPath.endsWith(".pbeplugin")
        ? new Uint8Array(readFileSync(absPath))
        : (await packPluginDirectory(absPath)).bytes;

    return readPbePluginArchive(bytes);
}

async function validatePlugin(archive, registry, byId) {
    const { manifest } = archive;
    const sources = [archive, ...(manifest.dependencies ?? []).map(id => byId.get(id))];
    const allowedParticles = new Set([...HOST_PARTICLE_IDS, ...sources.flatMap(source => source.manifest.provides.particles ?? [])]);
    const allowedEffects = new Set(sources.flatMap(source => source.manifest.provides.effects ?? []));

    if (archive.vfxEntryJs) {
        const pluginModule = await importArchiveVfxModule(archive);
        const record = registry.registerPlugin(pluginModule);

        if (record.manifest.id !== manifest.id) {
            throw new Error(`插件清单 id 不一致：plugin.json=${manifest.id}, 代码=${record.manifest.id}`);
        }
        if (JSON.stringify(record.manifest.stageProps) !== JSON.stringify(manifest.stageProps)
            || JSON.stringify(record.manifest.dependencies) !== JSON.stringify(manifest.dependencies)) {
            throw new Error(`插件 ${manifest.id} 的代码清单与归档清单道具或依赖声明不一致`);
        }
        const props = new Map(sources.flatMap(source => source.stageProps.map(({ registration }) => [registration.id, registration])));
        assertSameSet(record.effects, manifest.provides.effects, "provides.effects", manifest.id);
        assertSameSet(record.themes, manifest.provides.themes, "provides.themes", manifest.id);
        assertSameSet(
            [...record.lightLayouts, ...record.veilLayouts],
            manifest.provides.layouts,
            "provides.layouts",
            manifest.id,
        );
        assertSameSet(record.keyStyles, manifest.provides.keyStyles, "provides.keyStyles", manifest.id);
        for (const themeId of record.themes) {
            const theme = validateVfxTheme(registry.getTheme(themeId), registry);
            for (const layer of theme.layers) {
                if (!allowedEffects.has(layer.effect)) {
                    throw new Error(`主题 ${themeId} 引用了未声明依赖的特效：${layer.effect}`);
                }
            }
        }

        const maxBurst = manifest.limits?.maxParticlesPerBurst ?? VFX_PARTICLES_PER_PIANO;
        const sampleMusic = {
            ...quietFeatures,
            velocity: 0.65,
            activity: 0.7,
            density: 0.6,
            sustain: 0.6,
            surge: 0.7,
            chord: 0.6,
            onset: 0.8,
        };
        const sampleNotes = [{ midi: 60, velocity: 0.85, duration: 0.8, tick: 1 }];

        for (const effectId of record.effects) {
            const def = registry.getEffect(effectId);
            if (!def) throw new Error(`特效 ${effectId} 注册后不可查询`);
            const params = {
                color: "#68E4FF",
                color2: "#FFE29A",
                intensity: 0.85,
                scale: 1,
                variant: def.variants?.[0],
                zone: "stage",
                motion: "normal",
            };
            if (def.resolveStageProp && (props.size || manifest.capabilities.includes("vfx.stageProps"))) {
                for (const instrument of ["grand", "upright"]) {
                    const prop = def.resolveStageProp(params, instrument);
                    if (!prop) continue;
                    const resource = props.get(prop.id);
                    if (!resource || (prop.animation !== undefined && !resource.animations.includes(prop.animation))
                        || ![prop.offset?.x, prop.offset?.y, prop.offset?.z, prop.size, prop.turn].every(Number.isFinite)) {
                        throw new Error(`插件 ${manifest.id} 的特效 ${effectId} 返回了无效或未声明的道具：${String(prop.id)}`);
                    }
                }
            }
            if (def.trigger === "control") {
                def.resolveKeyParticle?.(params);
                continue;
            }
            for (const solo of [false, true]) {
                const state = def.createState?.();
                const batch = def.emit?.({
                    params,
                    music: sampleMusic,
                    recentNotes: sampleNotes,
                    lastNoteTick: 0,
                    instrument: "grand",
                    phase: 15,
                    solo,
                    state,
                });
                if (!batch) continue;
                if (!Array.isArray(batch.emitters)) {
                    throw new Error(`插件 ${manifest.id} 特效 ${effectId} 返回的 batch.emitters 不是数组`);
                }
                const totalParticles = batch.emitters.reduce((sum, e) => sum + e.particles, 0);
                if (totalParticles > maxBurst) {
                    throw new Error(`插件 ${manifest.id} 特效 ${effectId} 单次发射粒子数 ${totalParticles} 超出上限 ${maxBurst}`);
                }
                for (const emitter of batch.emitters) {
                    verifyFiniteEmitter(emitter, allowedParticles, manifest.id, `${effectId}/solo=${solo}`);
                }
            }
        }

        for (const styleId of record.keyStyles) {
            const style = registry.getKeyStyle(styleId);
            if (!style) throw new Error(`琴键粒子样式 ${styleId} 注册后不可查询`);
            const resolved = resolveKeyParticle(
                60,
                { particleStyle: style.value ?? 0, particlePalette: 0 },
                { x: 1, z: 0 },
                { style: styleId, colors: ["#68E4FF", "#C58CFF"], intensity: 0.9, scale: 1 },
                registry,
            );
            for (const emitter of resolved.emitters) {
                if (!allowedParticles.has(emitter.particle)) {
                    throw new Error(`插件 ${manifest.id} 样式 ${styleId} 引用了未声明粒子：${emitter.particle}`);
                }
                for (const [k, v] of Object.entries(emitter.variables)) {
                    if (typeof v !== "number" || !Number.isFinite(v)) {
                        throw new Error(`插件 ${manifest.id} 样式 ${styleId} 变量 ${k}=${v} 非有限值`);
                    }
                }
            }
        }
    }

    return archive;
}

async function main() {
    const args = process.argv.slice(2);
    const validateAll = args.includes("--all");
    const explicit = args.filter(a => a !== "--all").map(a => resolve(root, a));

    let targets = explicit;
    if (validateAll) {
        const packedDir = join(root, "build/plugins");
        const packedFiles = existsSync(packedDir)
            ? readdirSync(packedDir).filter(name => name.endsWith(".pbeplugin")).map(name => join(packedDir, name))
            : [];
        targets = packedFiles.length ? packedFiles : listBuiltinPluginDirs();
    }

    if (!targets.length) {
        console.error("用法: bun tools/plugins/validate-plugin.mjs <pluginDir-or-pbeplugin | --all>");
        process.exit(1);
    }

    const sharedRegistry = new VfxRegistry();
    const archives = validatePluginAssembly(await Promise.all(targets.map(readTarget)));
    const byId = new Map(archives.map(archive => [archive.manifest.id, archive]));
    for (const archive of archives) {
        await validatePlugin(archive, sharedRegistry, byId);
        const counts = [
            `${archive.manifest.provides.effects?.length ?? 0} effects`,
            `${archive.manifest.provides.themes?.length ?? 0} themes`,
            `${archive.manifest.provides.layouts?.length ?? 0} layouts`,
            `${archive.manifest.provides.keyStyles?.length ?? 0} keyStyles`,
            `${archive.manifest.provides.particles?.length ?? 0} particles`,
            `${archive.stageProps.length} stage props`,
            `${archive.timbres.length} timbres`,
            `${archive.songs.size} songs`,
            `${archive.performances.length} performances`,
            `${archive.libraries.length} libraries`,
        ].join(", ");
        console.log(`[validate-plugin] OK  ${archive.manifest.id} v${archive.manifest.version} (${counts})`);
    }
    for (const archive of archives) {
        for (const perf of archive.performances) {
            const missing = missingPerformanceResources(perf.cues, sharedRegistry);
            if (missing.length) {
                throw new Error(`插件 ${archive.manifest.id} 演出 ${perf.id} 引用无效：${missing.join(", ")}`);
            }
        }
    }
    if (validateAll) {
        const library = join(root, "midis/library");
        let performances = 0;
        for (const file of readdirSync(library)) {
            if (!file.endsWith(".pbe3")) continue;
            const cues = readSongHeader(readFileSync(join(library, file))).performance;
            if (!cues?.length) continue;
            const missing = missingPerformanceResources(cues, sharedRegistry);
            if (missing.length) throw new Error(`曲库演出 ${file} 引用无效：${missing.join(", ")}`);
            performances++;
        }
        console.log(`[validate-plugin] OK  ${performances} library performances`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
