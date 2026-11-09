import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

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
