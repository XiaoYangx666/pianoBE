import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const rp = new URL("../rp/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, rp), "utf8"));

test("the P-88 bench item ships a held model", () => {
    const attachable = read("attachables/p88_bench.attachable.json")["minecraft:attachable"].description;
    expect(attachable.identifier).toBe("pbe:p88_bench_item");
    expect(attachable.geometry.default).toBe("geometry.p88_bench_item");

    const texture = attachable.textures.default;
    expect(existsSync(new URL(`${texture}.png`, rp))).toBe(true);

    const geometryPath = "models/entity/p88_bench_item.geo.json";
    expect(existsSync(new URL(geometryPath, rp))).toBe(true);
    const geometry = read(geometryPath)["minecraft:geometry"][0];
    expect(geometry.description.identifier).toBe("geometry.p88_bench_item");
    // The hand-held model must be bound to the item slot, otherwise the game
    // draws it around the player entity and first person shows nothing.
    expect(geometry.bones[0].binding).toBe("q.item_slot_to_bone_name(context.item_slot)");
    const bones = geometry.bones as Array<{ name: string; cubes: unknown[] }>;
    expect(bones.map((bone) => bone.name)).toEqual(["upright"]);
    expect(bones[0].cubes.length).toBeGreaterThan(8);

    const animations = read("animations/p88_bench_item.animation.json").animations;
    for (const name of Object.values(attachable.animations) as string[]) {
        expect(animations[name]).toBeDefined();
        expect(animations[name].bones.upright).toBeDefined();
    }
});

test("held bench model is centred on its pivot", () => {
    const geometry = read("models/entity/p88_bench_item.geo.json")["minecraft:geometry"][0];
    const boxes = geometry.bones[0].cubes as Array<{ origin: number[]; size: number[] }>;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (const box of boxes) {
        for (let axis = 0; axis < 3; axis += 1) {
            low[axis] = Math.min(low[axis], box.origin[axis]);
            high[axis] = Math.max(high[axis], box.origin[axis] + box.size[axis]);
        }
    }
    // X and Z are centred so the attachable pose rotates around the seat.
    expect(Math.abs(low[0] + high[0])).toBeLessThan(0.5);
    expect(Math.abs(low[2] + high[2])).toBeLessThan(0.5);
    expect(low[1]).toBe(0);
});
