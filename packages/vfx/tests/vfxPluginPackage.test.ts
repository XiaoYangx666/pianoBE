import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { encodeSong } from "@piano/core";
import {
    HOST_PARTICLE_IDS,
    HOST_TEXTURES,
    pluginSlug,
    readPbePluginArchive,
    rewritePluginJsForAddon,
    validatePluginAssembly,
    writePbePluginArchive,
} from "../src/plugin/pluginPackage";
import type { VfxPluginManifest } from "../src";

function validManifest(overrides: Partial<VfxPluginManifest> = {}): VfxPluginManifest {
    return {
        id: "acme.spark_pack",
        name: "Spark Pack",
        version: "1.0.0",
        apiVersion: "1.0.0",
        minPianoBeVersion: "1.3.0",
        capabilities: ["vfx"],
        author: "ACME",
        license: "MIT",
        provides: {
            effects: ["acme_spark"],
        },
        ...overrides,
    };
}

const VALID_VFX_JS = `import { drawPoints } from "@piano/vfx";
export default {
    manifest: {},
    register(api) {
        api.registerEffect({ id: "acme_spark", label: "Spark", category: "accent", trigger: "instant", interval: 0, priority: 5, emit: () => ({ priority: 5, emitters: [drawPoints({ count: 1, life: 1, brush: "star", color: "#FFFFFF", opacity: 1 })] }) });
    }
};
`;

function validParticleDoc(id = "acme_spark_pt", texture = "textures/particle/acme_atlas") {
    return JSON.stringify({
        format_version: "1.10.0",
        particle_effect: {
            description: {
                identifier: `pbe:vfx_${id}`,
                basic_render_parameters: {
                    material: "particles_add",
                    texture,
                },
            },
        },
    });
}

describe(".pbeplugin archive codec and validation", () => {
    test("roundtrips manifest, vfx/index.js, custom particles, textures and previews", () => {
        const manifest = validManifest({ provides: { effects: ["acme_spark"], particles: ["acme_spark_pt"] } });
        const bytes = writePbePluginArchive({
            "plugin.json": JSON.stringify(manifest),
            "vfx/index.js": VALID_VFX_JS,
            "particles/pbe_vfx_acme_spark_pt.particle.json": validParticleDoc("acme_spark_pt"),
            "textures/particle/acme_atlas.png": new Uint8Array([137, 80, 78, 71]),
            "preview/thumb.png": new Uint8Array([1, 2, 3, 4]),
        });

        const parsed = readPbePluginArchive(bytes);
        expect(parsed.manifest.id).toBe("acme.spark_pack");
        expect(parsed.size).toBe(bytes.byteLength);
        expect(parsed.vfxEntryJs).toBe(VALID_VFX_JS);
        expect([...parsed.particles.keys()]).toEqual(["particles/pbe_vfx_acme_spark_pt.particle.json"]);
        expect([...parsed.textures.keys()]).toEqual(["textures/particle/acme_atlas.png"]);
        expect([...parsed.previews.keys()]).toEqual(["preview/thumb.png"]);
        expect(HOST_PARTICLE_IDS).toHaveLength(17);
        expect(HOST_TEXTURES).toContain("textures/particle/vfx_lab");
    });

    test("pluginSlug and rewritePluginJsForAddon transform @piano/vfx imports cleanly", () => {
        expect(pluginSlug("acme.aurora-pack")).toBe("acme_aurora_pack");
        const rewritten = rewritePluginJsForAddon(
            `import { drawPoints } from "@piano/vfx";\nimport { mix } from '@piano/vfx';\nconst x = import("@piano/vfx");`,
            "../../host.js",
        );
        expect(rewritten).toContain(`from "../../host.js"`);
        expect(rewritten).toContain(`from '../../host.js'`);
        expect(rewritten).toContain(`import("../../host.js")`);
        expect(rewritten).not.toContain("@piano/vfx");
    });

    test("rejects path traversal and invalid archive entries", () => {
        const traversal = zipSync({
            "../evil.txt": strToU8("bad"),
            "plugin.json": strToU8(JSON.stringify(validManifest())),
            "vfx/index.js": strToU8(VALID_VFX_JS),
        });
        expect(() => readPbePluginArchive(traversal)).toThrow();
        expect(() => writePbePluginArchive({ "/abs/path.txt": "bad" })).toThrow();
    });

    test("rejects eval, new Function, @minecraft/* imports and disallowed external imports", () => {
        for (const badCode of [
            `import { world } from "@minecraft/server";\nexport default {};`,
            `import { something } from "lodash";\nexport default {};`,
            `const x = eval("1+1"); export default {};`,
            `const fn = new Function("return 1"); export default {};`,
            `const mod = await import("node:fs"); export default {};`,
        ]) {
            const bytes = writePbePluginArchive({
                "plugin.json": JSON.stringify(validManifest()),
                "vfx/index.js": badCode,
            });
            expect(() => readPbePluginArchive(bytes)).toThrow();
        }
    });

    test("validates particle identifier, texture reference and provides.particles consistency", () => {
        // Missing texture in both host and archive
        const missingTex = writePbePluginArchive({
            "plugin.json": JSON.stringify(validManifest({ provides: { particles: ["acme_spark_pt"] } })),
            "vfx/index.js": VALID_VFX_JS,
            "particles/pbe_vfx_acme_spark_pt.particle.json": validParticleDoc("acme_spark_pt", "textures/particle/missing"),
        });
        expect(() => readPbePluginArchive(missingTex)).toThrow();

        // Host texture reference is allowed without bundling the host texture
        const hostTex = writePbePluginArchive({
            "plugin.json": JSON.stringify(validManifest({ provides: { particles: ["acme_spark_pt"] } })),
            "vfx/index.js": VALID_VFX_JS,
            "particles/pbe_vfx_acme_spark_pt.particle.json": validParticleDoc("acme_spark_pt", HOST_TEXTURES[0]),
        });
        expect(readPbePluginArchive(hostTex).manifest.id).toBe("acme.spark_pack");

        // Mismatched provides.particles vs particles/ folder
        const mismatch = writePbePluginArchive({
            "plugin.json": JSON.stringify(validManifest({ provides: { particles: ["other_pt"] } })),
            "vfx/index.js": VALID_VFX_JS,
            "particles/pbe_vfx_acme_spark_pt.particle.json": validParticleDoc("acme_spark_pt", HOST_TEXTURES[0]),
        });
        expect(() => readPbePluginArchive(mismatch)).toThrow();

        // Mismatched filename vs particle_effect.description.identifier
        const wrongFilename = writePbePluginArchive({
            "plugin.json": JSON.stringify(validManifest({ provides: { particles: ["acme_spark_pt"] } })),
            "vfx/index.js": VALID_VFX_JS,
            "particles/pbe_vfx_wrong_name.particle.json": validParticleDoc("acme_spark_pt", HOST_TEXTURES[0]),
        });
        expect(() => readPbePluginArchive(wrongFilename)).toThrow();
    });

    test("supports pure-song, library, and performance .pbeplugin packages without vfx/index.js", () => {
        const songBytes = encodeSong({
            id: "abcd1234",
            name: "测试曲目",
            duration: 160,
            tracks: [{ instrument: { family: "piano", number: 0, name: "Piano" }, notes: [60, 0, 40, 100] }],
        });
        const pureDataArchive = writePbePluginArchive({
            "plugin.json": JSON.stringify({
                id: "community.pop_pack",
                name: "流行精选曲库",
                version: "1.0.0",
                apiVersion: "1.0.0",
                minPianoBeVersion: "1.3.0",
                capabilities: ["songs", "libraries", "performances"],
                author: "Community",
                license: "CC-BY-NC-4.0",
                provides: {
                    songs: ["abcd1234"],
                    libraries: ["pop_hits"],
                    performances: ["starry_live"],
                },
            }),
            "songs/abcd1234.pbe3": songBytes,
            "libraries/pop_hits.json": JSON.stringify({
                id: "pop_hits",
                name: "流行精选",
                songs: ["abcd1234"],
            }),
            "performances/starry_live.json": JSON.stringify({
                id: "starry_live",
                name: "星空现场",
                song: "abcd1234",
                cues: [{ at: 0, op: "set", effect: "starfield", color: "moon", level: 80, fade: 0.5 }],
            }),
        });

        const parsed = readPbePluginArchive(pureDataArchive);
        expect(parsed.hasExecutableCode).toBe(false);
        expect(parsed.songs.size).toBe(1);
        expect(parsed.songs.get("abcd1234")?.name).toBe("测试曲目");
        expect(parsed.libraries).toHaveLength(1);
        expect(parsed.libraries[0].songs).toEqual(["abcd1234"]);
        expect(parsed.performances).toHaveLength(1);
        expect(parsed.performances[0].name).toBe("星空现场");
        expect(parsed.performances[0].requiredEffects).toEqual(["starfield"]);

        // Two plugins sharing identical song music merge cleanly in validatePluginAssembly
        const secondPerfPlugin = readPbePluginArchive(writePbePluginArchive({
            "plugin.json": JSON.stringify({
                id: "community.alt_perf",
                name: "另一套演出",
                version: "1.0.0",
                apiVersion: "1.0.0",
                minPianoBeVersion: "1.3.0",
                capabilities: ["songs", "performances"],
                author: "Alt",
                license: "MIT",
                provides: { songs: ["abcd1234"], performances: ["alt_show"] },
            }),
            "songs/abcd1234.pbe3": songBytes,
            "performances/alt_show.json": JSON.stringify({
                id: "alt_show",
                name: "极光夜",
                song: "abcd1234",
                cues: [{ at: 0, op: "flash", effect: "aurora_veil", color: "ice", level: 90 }],
            }),
        }));
        expect(validatePluginAssembly([parsed, secondPerfPlugin])).toHaveLength(2);
    });
});
