import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { digitalPianoHitModel, grandPianoHitModel } from "../src/domain/geometry/keyRay";
import {
    allocateHands,
    handTimelineClip,
    isBlackMidiKey,
    mapMidiToPlayerPos,
} from "../src/domain/piano/handAllocation";

const addonRoot = path.resolve(import.meta.dir, "..");

function collectExpressions(clip: { bones: Record<string, Record<string, unknown>> }): string[] {
    const out: string[] = [];
    for (const channels of Object.values(clip.bones)) {
        for (const value of Object.values(channels)) {
            const list = Array.isArray(value) ? value : [value];
            for (const entry of list) {
                if (typeof entry === "string") out.push(entry);
            }
        }
    }
    return out;
}

describe("smart two-hand allocation", () => {
    test("maps 88 keys monotonically from bass (-) to treble (+) across both piano models and shifts with playerLocalX", () => {
        for (const model of [digitalPianoHitModel, grandPianoHitModel]) {
            const bass = mapMidiToPlayerPos(28, 0, model.keyCenters);
            const mid = mapMidiToPlayerPos(60, 0, model.keyCenters);
            const treble = mapMidiToPlayerPos(96, 0, model.keyCenters);
            expect(bass).toBeLessThan(mid);
            expect(mid).toBeLessThan(treble);
            expect(bass).toBeGreaterThanOrEqual(-1);
            expect(treble).toBeLessThanOrEqual(1);

            // 玩家向高音侧（右方，localX 为负）移动后，原来的中央 C 相对玩家更靠左。
            const shifted = mapMidiToPlayerPos(60, -6, model.keyCenters);
            expect(shifted).toBeLessThan(mid);
        }
    });

    test("assigns outer notes across zones 0..4 and detects black keys", () => {
        const centers = digitalPianoHitModel.keyCenters;
        const lowBass = allocateHands([24], 0, centers);
        const innerBass = allocateHands([52], 0, centers);
        const innerTreble = allocateHands([68], 0, centers);
        const highTreble = allocateHands([99], 0, centers);

        expect(lowBass.left?.zone).toBe(4);
        expect(lowBass.right).toBeUndefined();
        expect(innerBass.left?.zone).toBeLessThan(lowBass.left!.zone);
        expect(highTreble.right?.zone).toBe(4);
        expect(highTreble.left).toBeUndefined();
        expect(innerTreble.right?.zone).toBeLessThan(highTreble.right!.zone);

        expect(isBlackMidiKey(61)).toBe(true);
        expect(isBlackMidiKey(60)).toBe(false);
        const blackNote = allocateHands([78], 0, centers);
        expect(blackNote.right?.black).toBe(true);
        expect(handTimelineClip("right", blackNote.right!)).toMatch(/^animation\.pbe\.performer\.r\.[0-4]b$/);
    });

    test("respects hand inertia in the center overlap zone instead of hard-splitting at MIDI 60", () => {
        const centers = digitalPianoHitModel.keyCenters;
        // 右手刚在高音区活动且靠近中央（prevRightPos = 0.08），左手远在低音区（prevLeftPos = -0.65）：
        // 落在中央区的 MIDI 59（B3）应顺手由右手继续弹，不机械切回左手。
        const stayRight = allocateHands([59], 0, centers, -0.65, 0.08);
        expect(stayRight.right).toBeDefined();
        expect(stayRight.left).toBeUndefined();

        // 反之左手刚靠近中央而右手在极高音时，MIDI 62（D4）归左手。
        const stayLeft = allocateHands([62], 0, centers, -0.05, 0.72);
        expect(stayLeft.left).toBeDefined();
        expect(stayLeft.right).toBeUndefined();
    });

    test("splits wide chords by largest gap, keeps tight single-hand chords together, and prevents hand crossing", () => {
        const centers = digitalPianoHitModel.keyCenters;

        // 左手低音伴奏 + 右手高音旋律（玩家站在偏右侧高音区 localX = -5.5）
        const shiftedAccomp = allocateHands([60, 67, 79, 83], -5.5, centers);
        expect(shiftedAccomp.left).toBeDefined();
        expect(shiftedAccomp.right).toBeDefined();
        expect(shiftedAccomp.left!.pos).toBeLessThan(shiftedAccomp.right!.pos - 0.13);

        // 单手密集三和弦应归同一只手
        const rightTriad = allocateHands([72, 76, 79], 0, centers);
        expect(rightTriad.right).toBeDefined();
        expect(rightTriad.left).toBeUndefined();

        // 近距离跨中音双音（Eb4=-0.051, F#4=+0.051）触发防交叉最小间距保护
        const tightPair = allocateHands([63, 66], 0, centers);
        expect(tightPair.left).toBeDefined();
        expect(tightPair.right).toBeDefined();
        expect(tightPair.left!.pos).toBeLessThanOrEqual(tightPair.right!.pos - 0.14 + 1e-6);
    });
});

describe("performer animations and zero-override policy", () => {
    const standingPath = path.join(addonRoot, "rp", "animations", "piano_performer.animation.json");
    const seatedPath = path.join(addonRoot, "rp", "animations", "piano_midi_performer.animation.json");
    const standingRaw = fs.readFileSync(standingPath, "utf8");
    const seatedRaw = fs.readFileSync(seatedPath, "utf8");
    const standingJson = JSON.parse(standingRaw);
    const seatedJson = JSON.parse(seatedRaw);

    test("defines standing play/release and all 20 independent left/right zone timeline clips", () => {
        expect(Object.keys(standingJson.animations)).toEqual([
            "animation.pbe.performer.play",
            "animation.pbe.performer.release",
        ]);
        const expectedClips = ["animation.pbe.performer.midi"];
        for (const side of ["l", "r"] as const) {
            for (const bw of ["w", "b"] as const) {
                for (let z = 0; z <= 4; z++) {
                    expectedClips.push(`animation.pbe.performer.${side}.${z}${bw}`);
                }
            }
        }
        expect(Object.keys(seatedJson.animations)).toEqual(expectedClips);

        // 确保 handTimelineClip 生成的所有动画 ID 在资源包中真实存在
        for (const side of ["left", "right"] as const) {
            for (const black of [false, true]) {
                for (const zone of [0, 1, 2, 3, 4] as const) {
                    const clip = handTimelineClip(side, { pos: 0, zone, black });
                    expect(seatedJson.animations[clip]).toBeDefined();
                }
            }
        }
    });

    test("supports both first-person arms, Vanilla item_use_normalized, and A&S creator variables", () => {
        for (const [json, raw, clipName] of [
            [standingJson, standingRaw, "animation.pbe.performer.play"],
            [seatedJson, seatedRaw, "animation.pbe.performer.midi"],
        ] as const) {
            const clip = json.animations[clipName];
            expect(Object.keys(clip.bones)).toEqual(["waist", "leftarm", "rightarm"]);
            expect(clip.bones.leftarm.position).toHaveLength(3);
            expect(clip.bones.leftarm.rotation).toHaveLength(3);
            expect(clip.bones.rightarm.position).toHaveLength(3);
            expect(clip.bones.rightarm.rotation).toHaveLength(3);

            expect(raw).toContain("v.item_use_normalized");
            expect(raw).toContain("v.actions_and_stuff");
            expect(raw).toContain("v.oreville_offhand_visible");
            expect(raw).toContain("v.oreville_offhand_custom_pos");
            expect(raw).toContain("v.oreville_mainhand_visible");
            expect(raw).toContain("v.oreville_mainhand_custom_pos");
            expect(raw).not.toContain("oreville_mainhand_hold_up");
            expect(raw).not.toContain("oreville_offhand_hold_up");

            const exprs = collectExpressions(clip);
            for (const expr of exprs) {
                expect(expr).not.toContain("{");
                expect(expr.length).toBeLessThan(600);
            }
        }
    });

    test("does not ship destructive vanilla player entity or render controller overrides", () => {
        expect(fs.existsSync(path.join(addonRoot, "rp", "entity", "player.entity.json"))).toBe(false);
        expect(fs.existsSync(path.join(addonRoot, "rp", "render_controllers", "player.render_controllers.json"))).toBe(false);
        expect(fs.existsSync(path.join(addonRoot, "bp", "entities", "player.json"))).toBe(false);
    });
});
