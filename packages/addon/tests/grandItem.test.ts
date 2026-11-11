import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { SCORE_STAND } from "../src/data/grand.generated";
import { PIANO_SCORES } from "../src/data/scorePack";

const rp = new URL("../rp/", import.meta.url);
const bp = new URL("../bp/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, rp), "utf8"));
const retired = new Set([
    "xypiano:grand_cell_2_0_0", "xypiano:grand_cell_2_2_0",
    "xypiano:grand_cell_3_0_0", "xypiano:grand_cell_3_0_1",
    "xypiano:grand_cell_3_1_0", "xypiano:grand_cell_3_1_1",
    "xypiano:grand_cell_3_2_0", "xypiano:grand_cell_3_2_1",
]);

test("retired grand cells stay invisible instead of shipping empty geometry", () => {
    for (const name of readdirSync(new URL("blocks/grand/", bp))) {
        if (!name.endsWith(".json")) continue;
        const block = readFileSync(new URL(`blocks/grand/${name}`, bp), "utf8");
        const definition = JSON.parse(block)["minecraft:block"];
        const id = definition.description.identifier;
        const geometry = definition.components["minecraft:geometry"];
        const geoPath = new URL(`models/blocks/grand/${name.replace(/\.json$/, ".geo.json")}`, rp);
        if (retired.has(id)) {
            expect(geometry).toBeUndefined();
            expect(existsSync(geoPath)).toBe(false);
        } else {
            expect(geometry).toBeDefined();
            expect(existsSync(geoPath)).toBe(true);
        }
    }
});

test("grand item attachable uses the shared item renderer and a bindable bone", () => {
    const attachable = read("attachables/grand_piano.attachable.json")["minecraft:attachable"]["description"];
    expect(attachable.identifier).toBe("xypiano:grand_piano_item");
    expect(attachable.render_controllers).toEqual(["controller.render.xypiano.item"]);
    expect(attachable.textures.default).toBe("textures/blocks/grand");

    const controller = read("render_controllers/piano_item.render_controllers.json")["render_controllers"];
    expect(controller["controller.render.xypiano.item"]).toEqual({
        geometry: "Geometry.default",
        materials: [{ "*": "Material.default" }],
        textures: ["Texture.default"],
    });

    const geometry = read("models/entity/grand_piano_item.geo.json")["minecraft:geometry"][0];
    const root = geometry.bones[0];
    expect(root.name).toBe("piano");
    expect(root.binding).toBe("q.item_slot_to_bone_name(context.item_slot)");
    expect(geometry.description.texture_width).toBe(512);

    const animations = read("animations/grand_piano_item.animation.json")["animations"];
    expect(animations["animation.xypiano.grand_piano_item.first_person"].bones.piano).toBeDefined();
    expect(animations["animation.xypiano.grand_piano_item.third_person"].bones.piano).toBeDefined();
    expect(existsSync(new URL("textures/items/grand_piano_item.png", rp))).toBe(true);
});

test("the score uses an entity and atlas separate from the keyboard", () => {
    const keys = read("entity/grand_display.entity.json")["minecraft:client_entity"].description;
    const score = read("entity/grand_score.entity.json")["minecraft:client_entity"].description;
    expect(keys.textures.default).toBe("textures/blocks/grand");
    expect(score.identifier).toBe("xypiano:grand_score");
    const first = PIANO_SCORES[0];
    const firstTexture = first
        ? `textures/entity/piano_score/${first.id}`
        : "textures/entity/piano_score/blank";
    expect(score.textures.default).toBe(firstTexture);
    expect(score.geometry.default).toBe("geometry.grand_score");
    expect(score.textures.score_0).toBe(firstTexture);
    expect(existsSync(new URL(`${firstTexture}.png`, rp))).toBe(true);
    const controller = read("render_controllers/grand_score.render_controllers.json")["render_controllers"]
        ["controller.render.xypiano.grand_score"];
    expect(controller.arrays.textures["Array.scores"])
        .toHaveLength(Math.max(1, PIANO_SCORES.length));
    expect(controller.textures).toEqual(["Array.scores[q.property('xypiano:score_variant')]"]);
    const behavior = JSON.parse(readFileSync(new URL("entities/grand_score.json", bp), "utf8"))["minecraft:entity"];
    expect(behavior.description.properties["xypiano:score_variant"].range)
        .toEqual([0, Math.max(1, PIANO_SCORES.length - 1)]);

    const keyGeometry = read("models/entity/grand_display.geo.json")["minecraft:geometry"][0];
    expect(keyGeometry.description.texture_width).toBe(512);
    expect(keyGeometry.bones).toHaveLength(88);
    expect(keyGeometry.bones.every((bone: { name: string }) => bone.name.startsWith("key_"))).toBe(true);
    const scoreGeometry = read("models/entity/grand_score.geo.json")["minecraft:geometry"][0];
    const leaf = scoreGeometry.bones.find((bone: { name: string }) => bone.name === "score_leaf");
    const board = scoreGeometry.bones.find((bone: { name: string }) => bone.name === "score_lean");
    expect(leaf.cubes[0].uv.south).toBeDefined();
    const { size, uv } = leaf.cubes[0];
    expect(size[0] * 2).toBeGreaterThan(.8 * 16);
    expect(size[1]).toBeGreaterThan(.5 * 16);
    expect(size[0] / size[1]).toBeCloseTo(uv.north.uv_size[0] / uv.north.uv_size[1], 2);
    expect(leaf.parent).toBe(board.name);
    expect(board.rotation).toEqual([-SCORE_STAND.lean, 0, 0]);
    const grandBoard = scoreGeometry.bones.find((bone: { name: string }) => bone.name === "grand_board");
    const digitalBoard = scoreGeometry.bones.find((bone: { name: string }) => bone.name === "digital_board");
    expect(grandBoard.cubes[0].size[0]).toBeGreaterThan(digitalBoard.cubes[0].size[0]);
    expect(behavior.description.properties["xypiano:score_mounted"].default).toBe(false);
    expect(behavior.components["minecraft:collision_box"]).toEqual({ width: 0, height: 0 });
    expect(behavior.components["minecraft:interact"]).toBeUndefined();
});

test("published scores use one tall page image per source page", () => {
    for (const score of PIANO_SCORES) {
        expect(score.pageCount).toBe(score.pages.length);
        for (const path of score.pages) {
            const image = readFileSync(new URL(path, rp));
            expect(image.toString("ascii", 12, 16)).toBe("IHDR");
            expect(image.readUInt32BE(16)).toBe(1280);
            expect(image.readUInt32BE(20)).toBe(1810);
        }
        const atlas = readFileSync(new URL(`textures/entity/piano_score/${score.id}.png`, rp));
        expect(atlas.toString("ascii", 12, 16)).toBe("IHDR");
        expect(atlas.readUInt32BE(16)).toBe(1024);
        expect(atlas.readUInt32BE(20)).toBe(1024);
    }
    // 模板始终带一张空白谱架图，没有曲谱时实体仍然可以渲染。
    const blank = readFileSync(new URL("textures/entity/piano_score/blank.png", rp));
    expect(blank.toString("ascii", 12, 16)).toBe("IHDR");
    expect(blank.readUInt32BE(16)).toBe(1024);
    expect(blank.readUInt32BE(20)).toBe(1024);
});
