import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    quietFeatures,
    resolveKeyParticle,
    VFX_PARTICLES_PER_PIANO,
    VfxRegistry,
} from "@piano/vfx";
import {
    HOST_PARTICLE_IDS,
    readPbePluginArchive,
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
            const outFile = join(tempDir, relPath.replace(/\.js$/, ".mjs"));
            mkdirSync(dirname(outFile), { recursive: true });
            const code = rewriteWorkspaceImportsForTemp(Buffer.from(bytes).toString("utf8"));
            writeFileSync(outFile, code);
        }
        const entryFile = join(tempDir, "vfx", "index.mjs");
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

export async function validatePluginTarget(targetPath, options = {}) {
    const absPath = resolve(targetPath);
    const bytes = absPath.endsWith(".pbeplugin")
        ? new Uint8Array(readFileSync(absPath))
        : (await packPluginDirectory(absPath)).bytes;

    const archive = readPbePluginArchive(bytes);
    const { manifest } = archive;
    const allowedParticles = new Set([...HOST_PARTICLE_IDS, ...(manifest.provides.particles ?? [])]);

    if (options.assetOwners) {
        for (const relPath of [...archive.particles.keys(), ...archive.textures.keys()]) {
            const owner = options.assetOwners.get(relPath);
            if (owner && owner !== manifest.id) {
                throw new Error(`资源路径冲突：${relPath} 同时属于插件 ${owner} 与 ${manifest.id}`);
            }
            options.assetOwners.set(relPath, manifest.id);
        }
    }

    if (archive.vfxEntryJs) {
        const pluginModule = await importArchiveVfxModule(archive);
        const registry = new VfxRegistry();
        const record = registry.registerPlugin(pluginModule);
        options.sharedRegistry?.registerPlugin(pluginModule);

        if (record.manifest.id !== manifest.id) {
            throw new Error(`插件清单 id 不一致：plugin.json=${manifest.id}, 代码=${record.manifest.id}`);
        }
        assertSameSet(record.effects, manifest.provides.effects, "provides.effects", manifest.id);
        assertSameSet(record.themes, manifest.provides.themes, "provides.themes", manifest.id);
        assertSameSet(
            [...record.lightLayouts, ...record.veilLayouts],
            manifest.provides.layouts,
            "provides.layouts",
            manifest.id,
        );
        assertSameSet(record.keyStyles, manifest.provides.keyStyles, "provides.keyStyles", manifest.id);

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
            if (def.trigger === "control") {
                def.resolveKeyParticle?.({
                    color: "#68E4FF",
                    color2: "#FFE29A",
                    intensity: 0.85,
                    scale: 1,
                    variant: def.variants?.[0],
                    zone: "stage",
                    motion: "normal",
                });
                continue;
            }
            for (const solo of [false, true]) {
                const state = def.createState?.();
                const batch = def.emit?.({
                    params: {
                        color: "#68E4FF",
                        color2: "#FFE29A",
                        intensity: 0.85,
                        scale: 1,
                        variant: def.variants?.[0],
                        zone: "stage",
                        motion: "normal",
                    },
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
    const assetOwners = new Map();
    for (const target of targets) {
        const archive = await validatePluginTarget(target, { sharedRegistry, assetOwners });
        const counts = [
            `${archive.manifest.provides.effects?.length ?? 0} effects`,
            `${archive.manifest.provides.themes?.length ?? 0} themes`,
            `${archive.manifest.provides.layouts?.length ?? 0} layouts`,
            `${archive.manifest.provides.keyStyles?.length ?? 0} keyStyles`,
            `${archive.manifest.provides.particles?.length ?? 0} particles`,
        ].join(", ");
        console.log(`[validate-plugin] OK  ${archive.manifest.id} v${archive.manifest.version} (${counts})`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
