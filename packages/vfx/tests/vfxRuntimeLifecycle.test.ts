import { beforeEach, expect, test } from "bun:test";
import {
    createPerformanceProgram,
    createSingleEffectProgram,
    quietFeatures,
    VfxBudget,
    VfxEngine,
} from "../src";
import { ensureBuiltinPluginsRegistered } from "./helpers/builtinPlugins";

ensureBuiltinPluginsRegistered();
beforeEach(ensureBuiltinPluginsRegistered);

test("unknown effects and unknown brushes in performance cues degrade safely without blocking valid cues", () => {
    const program = createPerformanceProgram([
        { tick: 0, effect: "future_unknown_fx", color: "#68E4FF", level: 90, scale: 100, op: "set", fade: 0 },
        { tick: 0, effect: "unknown_flash_fx", color: "#FFE29A", level: 90, scale: 100, op: "flash" },
        { tick: 0, effect: "starfield", brush: "future_brush", color: "#8EB8FF", level: 85, scale: 100, op: "set", fade: 0 },
    ], 5);

    const engine = new VfxEngine(program);
    const batches = engine.update(0.1, 2, quietFeatures);
    expect(batches.length).toBe(1);
    expect(batches[0].emitters.some(emitter => emitter.particle === "dust" || emitter.particle === "draw_point")).toBe(true);
    expect(engine.activeSummary(0.1).map(channel => channel.effect)).toEqual(["starfield"]);
});

test("note-triggered effects only consume fresh notes based on trigger mode", () => {
    const engine = new VfxEngine(createSingleEffectProgram({
        effect: "key_notes",
        color: "#A4C9FF",
        level: 85,
    }));

    expect(engine.update(0, 0, quietFeatures, [])).toEqual([]);
    const noteBatch = engine.update(0.05, 1, quietFeatures, [
        { midi: 60, velocity: 0.9, duration: 0.6, tick: 1 },
    ]);
    expect(noteBatch.length).toBe(1);
    // 同 tick 的旧音符已被消费，未出现新音符前不重复发射
    expect(engine.update(0.25, 5, quietFeatures, [
        { midi: 60, velocity: 0.9, duration: 0.6, tick: 1 },
    ])).toEqual([]);
    // 新 tick 音符到达后恢复触发
    const nextBatch = engine.update(0.30, 6, quietFeatures, [
        { midi: 60, velocity: 0.9, duration: 0.6, tick: 1 },
        { midi: 64, velocity: 0.9, duration: 0.6, tick: 6 },
    ]);
    expect(nextBatch.length).toBe(1);
});

test("seek and reset cleanly clear per-channel effect state and flash cursor", () => {
    const engine = new VfxEngine(createPerformanceProgram([
        { tick: 0, effect: "silk_streams", variant: "right", color: "#A0CAFF", level: 90, scale: 100, op: "set", fade: 0 },
        { tick: 20, effect: "shockwave", color: "#FFE29A", level: 100, scale: 100, op: "flash" },
    ], 10));

    const atLow = engine.update(0, 0, { ...quietFeatures, pitch: 0.1 }).flatMap(batch => batch.emitters)[0];
    const atHigh = engine.update(1.5, 30, { ...quietFeatures, pitch: 0.9 }).flatMap(batch => batch.emitters);
    const beamHigh = atHigh.find(emitter => emitter.particle === "beam")!;
    expect(beamHigh.variables.height_delta).not.toBe(0);
    expect(atHigh.some(emitter => emitter.particle === "shock")).toBe(true);

    // seek 后清除旧高度连续性状态，首个发射帧的 height_delta 归零，且不再重复触发已越过的 flash
    engine.seek(0.75, true);
    const afterSeek = engine.update(0.8, 16, { ...quietFeatures, pitch: 0.9 }).flatMap(batch => batch.emitters);
    expect(afterSeek.find(emitter => emitter.particle === "beam")!.variables.height_delta).toBeCloseTo(0, 5);
    expect(afterSeek.some(emitter => emitter.particle === "shock")).toBe(false);

    // backward timestamp automatically resets flash cursor to replay cues after rewind target
    engine.reset(0);
    const replayed = engine.update(0.6, 12, quietFeatures).flatMap(batch => batch.emitters);
    expect(replayed.some(emitter => emitter.particle === "shock")).toBe(true);
});

test("VfxBudget.clearPending discards un-dispatched emitters while keeping live client particles reserved", () => {
    const budget = new VfxBudget();
    budget.enqueue([
        {
            priority: 5,
            emitters: Array.from({ length: 8 }, () => ({
                particle: "draw_point",
                group: "field",
                offset: { x: 0, y: 1, z: 0 },
                variables: { count: 10, life: 1 },
                particles: 10,
                lifetime: 1,
            })),
        },
    ]);
    expect(budget.reserved).toBe(80);

    // 首刻最多派发 6 个发射器（60 粒子进入客户端存活队列），剩余 2 个在 pending 中
    let dispatched = 0;
    budget.dispatch(10, () => dispatched++);
    expect(dispatched).toBe(6);
    expect(budget.active).toBe(6);
    expect(budget.reserved).toBe(80);

    // 暂停/seek 清空待发队列，仅退还尚未派发的 20 粒子，已发往客户端的 60 粒子继续占用预算直至到期
    budget.clearPending();
    expect(budget.reserved).toBe(60);
    expect(budget.active).toBe(6);

    budget.expire(10 + 20 + 2);
    expect(budget.active).toBe(0);
    expect(budget.reserved).toBe(0);
});
