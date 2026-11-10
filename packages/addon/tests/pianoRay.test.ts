import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CASE_HITBOXES, KEYBOARD_HITBOX, KEY_HITBOXES, MENU_HITBOX, MIDI_MENU_HITBOX, PIANO_PARTICLE_LINE, SETTINGS_HITBOX } from "../src/data/hitboxes.generated";
import { GRAND_BUTTONS, GRAND_KEY_HITBOXES } from "../src/data/grand.generated";
import { grandPianoHitModel, hitsPianoMenu, pickPianoMenu, pickPianoPanel, pianoParticleOrigin, pianoRay, pickPianoKey } from "../src/domain/geometry/keyRay";

test("grand keys resolve all 88 pitches and the three controls can be reached from the bench", () => {
    const seen = new Set<number>();
    for (const [midi, x, , z, X, , Z] of GRAND_KEY_HITBOXES) {
        if (seen.has(midi)) continue;
        seen.add(midi);
        const ray = { origin: [(x + X) / 2, 27, (z + Z) / 2], direction: [0, -16, 0] } as const;
        expect(pickPianoKey(ray, 4, undefined, grandPianoHitModel)).toBe(midi);
    }
    expect(seen.size).toBe(88);
    for (const [action, [x, , z, X, Y, Z]] of GRAND_BUTTONS) {
        const ray = { origin: [(x + X) / 2, 28, -20], direction: [0, Y - 28, (z + Z) / 2 + 20] } as const;
        expect(pickPianoMenu(ray, 4, grandPianoHitModel)).toBe(action);
    }
});

describe("direct piano key ray", () => {
    test("all 88 playable surfaces resolve to their MIDI pitch", () => {
        const seen = new Set<number>();
        for (const [midi, x, , z, X, , Z] of KEY_HITBOXES) {
            if (seen.has(midi)) continue;
            seen.add(midi);
            const hit = pickPianoKey({ origin: [(x + X) / 2, 25, (z + Z) / 2], direction: [0, -16, 0] });
            expect(hit).toBe(midi);
        }
        expect(seen.size).toBe(88);
    });

    test("particle origins line up with their keys above the cabinet in all four orientations", () => {
        const center = { x: 12, y: 64, z: -7 };
        expect(CASE_HITBOXES.some(box =>
            box[2] <= PIANO_PARTICLE_LINE.z && PIANO_PARTICLE_LINE.z < box[5] &&
            box[4] < PIANO_PARTICLE_LINE.y && PIANO_PARTICLE_LINE.y - box[4] < 2
        )).toBe(true);
        for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const right = { x, y: 0, z };
            for (let midi = 21; midi <= 108; midi++) {
                const origin = pianoParticleOrigin(center, right, midi)!;
                const [, keyLeft, , , keyRight] = KEY_HITBOXES.find(box => box[0] === midi)!;
                const [modelX, , modelZ] = pianoRay(center, right, origin, { x: 0, y: -1, z: 0 }).origin;
                expect(modelX).toBeCloseTo((keyLeft + keyRight) / 2);
                expect(modelZ).toBeCloseTo(PIANO_PARTICLE_LINE.z);
                const glimmer = pianoParticleOrigin(center, right, midi, true)!;
                expect(pickPianoKey(pianoRay(center, right, glimmer, { x: 0, y: -1, z: 0 }))).toBe(midi);
            }
            expect(pianoParticleOrigin(center, right, 20)).toBeUndefined();
            expect(pianoParticleOrigin(center, right, 109)).toBeUndefined();
        }
    });

    test("rejects rays behind the case, between keys, or beyond reach", () => {
        expect(pickPianoKey({ origin: [0, 13, 7], direction: [0, 0, -16] })).toBeUndefined();
        expect(pickPianoKey({ origin: [0, 25, -2.7], direction: [0, -16, 0] })).toBeUndefined();
        expect(pickPianoKey({ origin: [12.47, 82, -2.7], direction: [0, -16, 0] })).toBeUndefined();
    });

    test("transform keeps the bass key on the player's left in all directions", () => {
        const center = { x: 5, y: 60, z: -5 };
        const [, x, , z, X, , Z] = KEY_HITBOXES[0];
        const along = (x + X) / 32;
        const depth = (z + Z) / 32;
        const facing = [
            { right: { x: -1, y: 0, z: 0 }, dx: along, dz: depth },
            { right: { x: 0, y: 0, z: 1 }, dx: depth, dz: -along },
            { right: { x: 1, y: 0, z: 0 }, dx: -along, dz: -depth },
            { right: { x: 0, y: 0, z: -1 }, dx: -depth, dz: along },
        ];
        for (const { right, dx, dz } of facing) {
            const ray = pianoRay(center, right,
                { x: center.x + dx, y: center.y + 1.6, z: center.z + dz },
                { x: 0, y: -1, z: 0 });
            expect(pickPianoKey(ray)).toBe(21);
        }
    });

    test("only the dedicated panel button opens the menu", () => {
        const [x, , z, X, , Z] = MENU_HITBOX;
        const menu = { origin: [(x + X) / 2, 22, (z + Z) / 2], direction: [0, -16, 0] } as const;
        expect(hitsPianoMenu(menu)).toBe(true);
        expect(pickPianoKey(menu)).toBeUndefined();
        expect(hitsPianoMenu({ origin: [0, 22, -2.3], direction: [0, -16, 0] })).toBe(false);
    });

    test("the body behind the keys opens the panel", () => {
        expect(pickPianoPanel({ origin: [0, 25, .5], direction: [0, -16, 0] })).toBe("panel");
        expect(pickPianoPanel({ origin: [0, 15.5, 10], direction: [0, 0, -16] })).toBe("panel");
        // Same shallow angle a standing player has when aiming at the panel.
        expect(pickPianoPanel({ origin: [0, 25.92, -6], direction: [0, 16.8 - 25.92, .5 + 6] })).toBe("panel");
    });

    test("the apron, cheeks, legs, front face and sides stay inert", () => {
        expect(pickPianoPanel({ origin: [0, 25, -3.7], direction: [0, -16, 0] })).toBe("case");
        expect(pickPianoPanel({ origin: [15.5, 25, -2], direction: [0, -16, 0] })).toBe("case");
        expect(pickPianoPanel({ origin: [-20, 5, 0], direction: [16, 0, 0] })).toBe("case");
        expect(pickPianoPanel({ origin: [0, 15, -10], direction: [0, 0, 16] })).toBe("case");
        expect(pickPianoPanel({ origin: [-10, 15.5, 1.5], direction: [16, 0, 0] })).toBe("case");
        // A miss under the keys from a player's angle must not open the panel.
        expect(pickPianoPanel({ origin: [0, 25.92, -6], direction: [0, 14 - 25.92, -3.7 + 6] })).toBe("case");
    });

    test("a key click is never a panel click", () => {
        const [midi, x, , z, X, , Z] = KEY_HITBOXES[0];
        const ray = { origin: [(x + X) / 2, 25, (z + Z) / 2], direction: [0, -16, 0] } as const;
        expect(pickPianoKey(ray)).toBe(midi);
        expect(pickPianoPanel(ray)).not.toBe("panel");
    });

    test("a tap that misses every case box reports a miss", () => {
        // Touch players aim at the block; the ray can pass through the open
        // frame in front of the body without touching any case box.
        expect(pickPianoPanel({ origin: [0, 20, -4], direction: [0, -16, 0] })).toBe("miss");
        expect(pickPianoPanel({ origin: [0, 5, -4.2], direction: [0, 0, 16] })).toBe("miss");
    });

    test("the grand piano keeps its own body region", () => {
        expect(pickPianoPanel({ origin: [0, 30, 1.5], direction: [0, -16, 0] }, 4, grandPianoHitModel)).toBe("panel");
        // Front apron below the grand keyboard.
        expect(pickPianoPanel({ origin: [0, 30, -6.6], direction: [0, -16, 0] }, 4, grandPianoHitModel)).toBe("case");
    });

    test("distinct menu caps resolve to their own actions and miss outside", () => {
        for (const [box, kind] of [[MENU_HITBOX, "menu"], [MIDI_MENU_HITBOX, "midi"], [SETTINGS_HITBOX, "settings"]] as const) {
            const [x, , z, X, , Z] = box;
            expect(pickPianoMenu({ origin: [(x + X) / 2, 22, (z + Z) / 2], direction: [0, -16, 0] })).toBe(kind);
        }
        expect(pickPianoMenu({ origin: [0, 22, -2.3], direction: [0, -16, 0] })).toBeUndefined();
        expect(pickPianoMenu({ origin: [0, 13, 7], direction: [0, 0, -16] })).toBeUndefined();
    });

    test("head ray uses the Tabletop eye-height correction for a shallow click", () => {
        const [midi, x, , z, X, Y, Z] = KEY_HITBOXES.find(box => box[0] === 108)!;
        const center = { x: 20, y: 60, z: -4.5 };
        const view = { x: 0, y: -.6, z: .8 };
        const head = {
            x: center.x + (x + X) / 32,
            y: center.y + Y / 16 - .1 - view.y * 1.5,
            z: center.z + (z + Z) / 32 - view.z * 1.5,
        };
        const ray = pianoRay(center, { x: -1, y: 0, z: 0 }, head, view);
        expect(pickPianoKey(ray)).toBe(midi);
        expect(pickPianoKey({ ...ray, origin: [ray.origin[0], ray.origin[1] - 1.6, ray.origin[2]] })).toBeUndefined();
    });

    test("an oblique ray can pass over a depressed key that it hits at rest", () => {
        const [midi, x, , z, X, Y] = KEY_HITBOXES[0];
        const ray = { origin: [(x + X) / 2, Y - .1, z - .2], direction: [0, -.2, 16] } as const;
        expect(pickPianoKey(ray, .055)).toBe(midi);
        expect(pickPianoKey(ray, .055, key => key === midi)).toBeUndefined();
    });
});

test("exported block halves put the legs at the outer edges and meet at the seam", () => {
    type Cube = { origin: number[]; size: number[] };
    const model = (name: string) => JSON.parse(readFileSync(
        new URL(`../rp/models/blocks/piano_${name}.geo.json`, import.meta.url), "utf8"
    ))["minecraft:geometry"][0].bones.flatMap((bone: { cubes?: Cube[] }) => bone.cubes ?? []) as Cube[];

    for (const [name, center] of [["left", 8], ["right", -8]] as const) {
        const cubes = model(name);
        const leg = cubes.find(cube => cube.origin[1] > 0 && cube.origin[1] < 1 && cube.size[1] > 10);
        expect(leg).toBeDefined();
        const legX = center - leg!.origin[0] - leg!.size[0] / 2;
        expect(legX).toBeCloseTo(name === "left" ? 14.44 : -14.44);

        const tray = cubes.find(cube => cube.size[0] === 16);
        expect(tray).toBeDefined();
        const edge = center - tray!.origin[0];
        expect(name === "left" ? edge - tray!.size[0] : edge).toBeCloseTo(0);
    }
});

test("all key poses fit inside the two occupied block cells", () => {
    const [minX, minY, minZ, maxX, maxY, maxZ] = KEYBOARD_HITBOX;
    expect(minX).toBeGreaterThan(-16);
    expect(maxX).toBeLessThan(16);
    expect(minY).toBeGreaterThan(0);
    expect(maxY).toBeLessThan(16);
    expect(minZ).toBeGreaterThan(-8);
    expect(maxZ).toBeLessThan(8);
});
