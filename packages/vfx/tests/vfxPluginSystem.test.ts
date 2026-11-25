import { afterEach, describe, expect, test } from "bun:test";
import {
    createPerformanceProgram,
    createSingleEffectProgram,
    createThemeProgram,
    DEFAULT_KEY_PARTICLE_SETTINGS,
    drawCurtain,
    drawPoints,
    drawShaft,
    getStageLightLayout,
    getStageVeilLayout,
    getVfxEffect,
    getVfxTheme,
    isApiVersionCompatible,
    listPianoParticleStyles,
    listVfxEffects,
    listVfxPlugins,
    listVfxThemes,
    quietFeatures,
    registerVfxPlugin,
    resolveKeyParticle,
    unregisterVfxPlugin,
    validatePluginManifest,
    VFX_API_VERSION,
    VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS,
    VfxEngine,
    VfxRegistry,
    type VfxPluginManifest,
    type VfxPluginModule,
} from "../src";
import { ensureBuiltinPluginsRegistered } from "./helpers/builtinPlugins";

function makeManifest(overrides: Partial<VfxPluginManifest> = {}): VfxPluginManifest {
    return {
        id: "thirdparty.sample",
        name: "Sample Third-Party Plugin",
        version: "1.0.0",
        apiVersion: VFX_API_VERSION,
        minPianoBeVersion: "1.3.0",
        capabilities: ["vfx"],
        author: "Community",
        license: "MIT",
        provides: {
            effects: ["custom_spark"],
        },
        ...overrides,
    };
}

afterEach(() => {
    // Ensure the shared singleton is back in its clean default state for other test files.
    const existing = listVfxPlugins().map(r => r.manifest.id);
    for (const id of existing) unregisterVfxPlugin(id);
    ensureBuiltinPluginsRegistered();
});

describe("VfxRegistry & plugin system", () => {
    test("zero-plugin mode leaves registry empty and runs PBE3 & key particles safely without crashing", () => {
        for (const record of listVfxPlugins()) {
            unregisterVfxPlugin(record.manifest.id);
        }

        expect(listVfxPlugins()).toEqual([]);
        expect(listVfxEffects()).toEqual([]);
        expect(listVfxThemes()).toEqual([]);
        expect(listPianoParticleStyles()).toEqual([]);
        expect(getStageLightLayout("neon-sides")).toEqual([]);
        expect(getStageVeilLayout("aurora")).toEqual([]);
        expect(drawShaft({ layout: "neon-sides", color: "#68E4FF", opacity: 1, length: 1 })).toEqual([]);
        expect(drawCurtain({ layout: "aurora", color: "#68E4FF", opacity: 1, length: 1 })).toEqual([]);

        const program = createPerformanceProgram([
            { tick: 0, effect: "starfield", color: "#8EB8FF", level: 80, scale: 100, op: "set", fade: 0 },
            { tick: 20, effect: "shockwave", color: "#FFE29A", level: 100, scale: 100, op: "flash" },
        ], 4);
        const engine = new VfxEngine(program);
        expect(engine.update(0.5, quietFeatures)).toEqual([]);
        expect(engine.activeSummary(0.5)).toEqual([]);
        expect(engine.keyParticleOverride(0.5)).toBeUndefined();

        const keyResolved = resolveKeyParticle(60, DEFAULT_KEY_PARTICLE_SETTINGS, { x: 1, z: 0 });
        expect(keyResolved.style).toBe("none");
        expect(keyResolved.glimmer).toBe(false);
        expect(keyResolved.emitters).toHaveLength(0);

        // Even when other plugins (without keyStyles) are loaded, resolveKeyParticle stays safe
        registerVfxPlugin({
            manifest: makeManifest({ id: "thirdparty.no_keys", provides: { effects: ["no_keys_fx"] } }),
            register(api) {
                api.registerEffect({
                    id: "no_keys_fx",
                    label: "No Keys FX",
                    category: "atmosphere",
                    trigger: "continuous",
                    interval: 20,
                    priority: 1,
                    emit: () => null,
                });
            },
        });
        const partialResolved = resolveKeyParticle(60, DEFAULT_KEY_PARTICLE_SETTINGS, { x: 1, z: 0 });
        expect(partialResolved.style).toBe("none");
        expect(partialResolved.glimmer).toBe(false);
        expect(partialResolved.emitters).toHaveLength(0);
    });

    test("unified registration exposes custom plugin effects, themes, layouts and keyStyles, and unregister removes everything cleanly", () => {
        const thirdParty: VfxPluginModule = {
            manifest: makeManifest({
                id: "acme.aurora_pack",
                provides: {
                    effects: ["acme_pulse"],
                    themes: ["acme_night"],
                    layouts: ["acme_pillars", "acme_veil"],
                    keyStyles: ["acme_sparkle"],
                },
            }),
            register(api) {
                api.registerLightLayout("acme_pillars", [
                    { origin: { x: 1.5, y: 0.2, z: 1.0 }, direction: { x: 0, y: 1, z: 0 }, length: 1.2, width: 0.4, gain: 1 },
                ]);
                api.registerVeilLayout("acme_veil", [
                    { origin: { x: 0, y: 2.0, z: 1.5 }, span: 10, rise: 1.2, gain: 1, phase: 0, roll: 0 },
                ]);
                api.registerKeyStyle("acme_sparkle", {
                    label: "极光碎星",
                    value: 99,
                    render: "point",
                    brush: "star",
                    alpha: 0.9,
                    color: { mode: "free" },
                    draw: { count: 3, life: 0.5, size: 0.06, velocity: [0, 1.2, 0] },
                });
                api.registerEffect({
                    id: "acme_pulse",
                    label: "ACME 极光脉冲",
                    category: "accent",
                    trigger: "continuous",
                    interval: 10,
                    priority: 6,
                    emit({ params }) {
                        return {
                            priority: 6,
                            emitters: [
                                drawPoints({
                                    count: 4,
                                    life: 0.8,
                                    brush: "star",
                                    color: params.color,
                                    opacity: params.intensity,
                                }),
                            ],
                        };
                    },
                });
                api.registerTheme("acme_night", {
                    label: "ACME 极光夜",
                    keyParticle: { style: "acme_sparkle", colors: ["#68E4FF", "#C58CFF"] },
                    layers: [
                        { effect: "acme_pulse", color: "#68E4FF", level: 90 },
                    ],
                });
            },
        };

        const record = registerVfxPlugin(thirdParty);
        expect(record.effects).toEqual(["acme_pulse"]);
        expect(record.themes).toEqual(["acme_night"]);
        expect(record.lightLayouts).toEqual(["acme_pillars"]);
        expect(record.veilLayouts).toEqual(["acme_veil"]);
        expect(record.keyStyles).toEqual(["acme_sparkle"]);

        expect(getVfxEffect("acme_pulse")?.label).toBe("ACME 极光脉冲");
        expect(getVfxTheme("acme_night")?.label).toBe("ACME 极光夜");
        expect(getStageLightLayout("acme_pillars")).toHaveLength(1);
        expect(getStageVeilLayout("acme_veil")).toHaveLength(1);
        expect(listPianoParticleStyles().some(s => s.style === "acme_sparkle" && s.value === 99)).toBe(true);

        const engine = new VfxEngine(createThemeProgram(getVfxTheme("acme_night")!, { seconds: 10 }));
        const batches = engine.update(0, quietFeatures);
        expect(batches).toHaveLength(1);
        expect(batches[0].emitters[0].particles).toBe(4);
        expect(engine.keyParticleOverride(0)?.style).toBe("acme_sparkle");

        const keyResolved = resolveKeyParticle(64, { particleStyle: 99, particlePalette: 0 }, { x: 1, z: 0 });
        expect(keyResolved.style).toBe("acme_sparkle");
        expect(keyResolved.emitters.length).toBe(2);

        expect(unregisterVfxPlugin("acme.aurora_pack")).toBe(true);
        expect(unregisterVfxPlugin("acme.aurora_pack")).toBe(false);
        expect(getVfxEffect("acme_pulse")).toBeUndefined();
        expect(getVfxTheme("acme_night")).toBeUndefined();
        expect(getStageLightLayout("acme_pillars")).toEqual([]);
        expect(getStageVeilLayout("acme_veil")).toEqual([]);
        expect(listPianoParticleStyles().some(s => s.style === "acme_sparkle")).toBe(false);
    });

    test("manifest validation, API compatibility, conflicts and register errors roll back atomically", () => {
        expect(isApiVersionCompatible("1.0.0", "1.0.0")).toBe(true);
        expect(isApiVersionCompatible("1.0.0", "1.2.0")).toBe(true);
        expect(isApiVersionCompatible("1.1.0", "1.0.0")).toBe(false);
        expect(isApiVersionCompatible("2.0.0", "1.0.0")).toBe(false);

        expect(() => validatePluginManifest({ ...makeManifest(), dependencies: ["thirdparty.sample"] })).toThrow();
        expect(() => new VfxRegistry().registerPlugin({
            manifest: makeManifest({ dependencies: ["other"] }), register() {},
        })).toThrow(/缺少可用依赖/);
        expect(() => validatePluginManifest(makeManifest({ id: "Bad_ID" }))).toThrow();
        expect(() => validatePluginManifest(makeManifest({ version: "1.0" }))).toThrow();
        expect(() => validatePluginManifest(makeManifest({ capabilities: [] }))).toThrow();
        expect(() => validatePluginManifest(makeManifest({ capabilities: ["unknown" as never] }))).toThrow();

        const reg = new VfxRegistry();
        reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.one" }),
            register(api) {
                api.registerEffect({
                    id: "shared_fx",
                    label: "First",
                    category: "atmosphere",
                    trigger: "continuous",
                    interval: 10,
                    priority: 1,
                    emit: () => null,
                });
                api.registerKeyStyle("style_one", {
                    label: "Style One",
                    value: 42,
                    render: "point",
                    brush: "star",
                    alpha: 0.9,
                    color: { mode: "free" },
                    draw: { count: 1, life: 0.5 },
                });
            },
        });

        // Duplicate plugin ID
        expect(() => reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.one" }),
            register() {},
        })).toThrow();

        // Incompatible API version
        expect(() => reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.future", apiVersion: "2.0.0" }),
            register() {},
        })).toThrow();

        // Effect ID conflict midway through register() must roll back staged_ok_fx
        expect(() => reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.two" }),
            register(api) {
                api.registerEffect({
                    id: "staged_ok_fx",
                    label: "Staged",
                    category: "atmosphere",
                    trigger: "continuous",
                    interval: 10,
                    priority: 1,
                    emit: () => null,
                });
                api.registerEffect({
                    id: "shared_fx",
                    label: "Conflicting",
                    category: "atmosphere",
                    trigger: "continuous",
                    interval: 10,
                    priority: 1,
                    emit: () => null,
                });
            },
        })).toThrow();
        expect(reg.hasPlugin("plugin.two")).toBe(false);
        expect(reg.hasEffect("staged_ok_fx")).toBe(false);

        // Numeric value collision in key styles must roll back
        expect(() => reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.three" }),
            register(api) {
                api.registerTheme("staged_theme", {
                    layers: [{ effect: "shared_fx", color: "#FFFFFF", level: 80 }],
                });
                api.registerKeyStyle("style_conflict_val", {
                    label: "Dup Value",
                    value: 42,
                    render: "point",
                    brush: "star",
                    alpha: 0.9,
                    color: { mode: "free" },
                    draw: { count: 1, life: 0.5 },
                });
            },
        })).toThrow();
        expect(reg.hasPlugin("plugin.three")).toBe(false);
        expect(reg.hasTheme("staged_theme")).toBe(false);

        // Reserved IDs rejected
        expect(() => reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.reserved_theme" }),
            register(api) {
                api.registerTheme("off", { layers: [{ effect: "shared_fx", color: "#FFFFFF", level: 80 }] });
            },
        })).toThrow();
        expect(() => reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.reserved_style" }),
            register(api) {
                api.registerKeyStyle("inherit", {
                    label: "Bad",
                    render: "point",
                    brush: "star",
                    alpha: 0.9,
                    color: { mode: "free" },
                    draw: { count: 1, life: 0.5 },
                });
            },
        })).toThrow();
    });

    test("fault isolation protects healthy channels & song playback and auto-disables after consecutive errors", () => {
        const reg = new VfxRegistry();
        let faultyEmitCalls = 0;
        let shouldThrow = true;

        reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.healthy", provides: { effects: ["healthy_fx"] } }),
            register(api) {
                api.registerEffect({
                    id: "healthy_fx",
                    label: "Healthy FX",
                    category: "atmosphere",
                    trigger: "continuous",
                    interval: 10,
                    priority: 2,
                    emit: ({ params }) => ({
                        priority: 2,
                        emitters: [drawPoints({ count: 2, life: 0.5, brush: "mote", color: params.color, opacity: 1 })],
                    }),
                });
            },
        });

        reg.registerPlugin({
            manifest: makeManifest({ id: "plugin.faulty", provides: { effects: ["faulty_fx"] } }),
            register(api) {
                api.registerEffect({
                    id: "faulty_fx",
                    label: "Faulty FX",
                    category: "accent",
                    trigger: "continuous",
                    interval: 5,
                    priority: 5,
                    emit() {
                        faultyEmitCalls++;
                        if (shouldThrow) throw new Error("boom in plugin emit");
                        return {
                            priority: 5,
                            emitters: [drawPoints({ count: 1, life: 0.5, brush: "star", color: "#FFFFFF", opacity: 1 })],
                        };
                    },
                });
            },
        });

        const program = createThemeProgram({
            layers: [
                { effect: "faulty_fx", color: "#FF0000", level: 90 },
                { effect: "healthy_fx", color: "#00FF00", level: 90 },
            ],
        }, { seconds: 30 }, reg);

        const engine = new VfxEngine(program, "upright", reg);

        for (let i = 0; i < VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS; i++) {
            const tick = i * 5;
            const batches = engine.update(tick / 20, quietFeatures);
            // Healthy channel keeps emitting when its interval hits; update never throws.
            if (tick % 10 === 0) {
                expect(batches).toHaveLength(1);
                expect(batches[0].emitters[0].particles).toBe(2);
            } else {
                expect(batches).toEqual([]);
            }
        }

        expect(faultyEmitCalls).toBe(VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS);
        const diag = reg.getPluginDiagnostic("plugin.faulty")!;
        expect(diag.disabled).toBe(true);
        expect(diag.consecutiveErrors).toBe(VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS);
        expect(diag.totalErrors).toBe(VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS);
        expect(diag.lastError?.effectId).toBe("faulty_fx");
        expect(diag.lastError?.phase).toBe("emit");
        expect(diag.lastError?.message).toContain("boom in plugin emit");

        // Disabled plugin is no longer invoked on future updates
        engine.update(2.0, quietFeatures);
        expect(faultyEmitCalls).toBe(VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS);

        // Re-enabling after recovery allows the plugin to run again
        shouldThrow = false;
        reg.reEnablePlugin("plugin.faulty");
        expect(reg.isPluginDisabled("plugin.faulty")).toBe(false);

        const singleEngine = new VfxEngine(
            createSingleEffectProgram({ effect: "faulty_fx", color: "#FFFFFF" }, reg),
            "upright",
            reg,
        );
        const recovered = singleEngine.update(0, quietFeatures);
        expect(recovered).toHaveLength(1);
        expect(faultyEmitCalls).toBe(VFX_PLUGIN_MAX_CONSECUTIVE_ERRORS + 1);
        expect(reg.getPluginDiagnostic("plugin.faulty")?.consecutiveErrors).toBe(0);
    });
});
