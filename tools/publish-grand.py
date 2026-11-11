"""Publish the saved concert grand cuts as playable PianoBE resources."""

from collections import defaultdict
from hashlib import sha256
import json
from math import cos, radians, sin
from pathlib import Path
from runpy import run_path

from PIL import Image

from grand_score import (SCORES, STAND_HARDWARE_TOP, STAND_HARDWARE_UV_SIZE, STAND_PAGE_HEIGHT,
                         STAND_PAGE_WIDTH, STAND_TEXTURE_SIZE, blank_texture,
                         publish_score_assets, stand_texture, ui_pages)


MODEL = run_path(str(Path(__file__).with_name("model-grand.py")))
ASSETS = MODEL["ASSETS"]
ADDON = ASSETS.parents[1] / "packages/addon"
BP = ADDON / "bp"
RP = ADDON / "rp"
write = MODEL["write"]
rounded = MODEL["rounded"]
native_geometry = MODEL["CELL_TOOLS"]["native_geometry"]
DISPLAY = "xypiano:grand_display"
SCORE_DISPLAY = "xypiano:grand_score"
SCORE_PROPERTY = "xypiano:score_spread"
SCORE_MOUNTED = "xypiano:score_mounted"
SCORE_GRAND = "xypiano:score_grand"
SCORE_VARIANT = "xypiano:score_variant"
# Stand origin sits on the front crossblock or rear deck. The large-print
# two-page spread is intentionally wider and taller than the earlier A4 demo.
SCORE_ORIGIN_Z = 2.91
SCORE_HEIGHTS = {"grand": MODEL["model_point"]((0, MODEL["RIM_TOP"], 0))[1], "digital": 16.83335}
SCORE_LEAN = 24
SCORE_PIVOT = [0, .48, 0]
SCORE_FACE = [-6.8, 0, -.045, 6.8, 8.8, .025]
KEY_PRESS_DEGREES = 8  # Shared piano_display animation.
ITEM_SCALE = .22
# The compact outline is a subset of the cells already saved in worlds.
# Keep the old IDs registered until their invisible blocks tick and clear.
RETIRED_CELLS = (
    "grand_cell_2_0_0", "grand_cell_2_2_0",
    "grand_cell_3_0_0", "grand_cell_3_0_1", "grand_cell_3_1_0",
    "grand_cell_3_1_1", "grand_cell_3_2_0", "grand_cell_3_2_1",
)


def read(path):
    return json.loads(path.read_bytes())


def key_name(part):
    return " keys / MIDI " in part["name"]


def bounds(elements):
    return [min(e["from"][i] for e in elements) for i in range(3)] + [
        max(e["to"][i] for e in elements) for i in range(3)]


def box_component(elements):
    x, y, z, X, Y, Z = bounds(elements)
    return {"origin": [-X, y, z], "size": rounded((X - x, Y - y, Z - z))}


def publish_cell(project, part_id, *, front_layer=None):
    path = part_id.split(":")[1]
    elements = project["elements"]
    parts = [e for e in elements if not key_name(e)]
    # Retired/empty carriers stay registered only so old worlds can tick them
    # away. An empty geometry makes Bedrock reject the whole block, so emit a
    # geometry-less invisible block instead of a zero-cube schematic.
    invisible = not parts
    geometry_path = RP / f"models/blocks/grand/{path}.geo.json"
    if invisible:
        geometry_path.unlink(missing_ok=True)
    else:
        geometry = native_geometry({**project, "elements": parts})
        geometry["minecraft:geometry"][0]["bones"][0]["name"] = "concert_grand"
        write(geometry_path, geometry)
    template = read(BP / "blocks/piano_left.json")
    block = template["minecraft:block"]
    block["description"]["identifier"] = part_id
    components = block["components"]
    if invisible:
        components.pop("minecraft:geometry", None)
        components.pop("minecraft:material_instances", None)
        block.pop("permutations", None)
    else:
        components["minecraft:geometry"] = geometry["minecraft:geometry"][0]["description"]["identifier"]
        components["minecraft:material_instances"]["*"]["texture"] = "piano:grand"
    selection = elements
    if front_layer == 0:
        selection = [e for e in elements if key_name(e) or e["name"].startswith("Keyboard / ")]
    elif front_layer == 1:
        # The upper cheeks extend over empty space in front of the fallboard.
        # Keep their block's single native selection box off the playable keys.
        front = MODEL["model_point"]((0, 0, MODEL["FALLBOARD_FRONT"]))[2]
        selection = [{**e, "from": [*e["from"][:2], max(e["from"][2], front)]} for e in elements
                     if e["to"][2] > front and not e["name"].startswith("Raised lid / ")]
    components["minecraft:selection_box"] = box_component(selection) if selection else False
    # Keep the lid out of physical collision. Upper front cells use the same
    # recessed cabinet boundary for cursor targeting and collision.
    collision = []
    for names in (("Curved case", "Keyboard"), ("Legs and casters",), ("Pedal lyre",)):
        solid = [e for e in (selection if front_layer == 1 else elements) if e["name"].startswith(names)]
        if solid:
            collision.append(box_component(solid))
    components["minecraft:collision_box"] = collision if len(collision) > 1 else collision[0] if collision else False
    write(BP / f"blocks/grand/{path}.json", template)


def score_bones():
    x, y, z, X, Y, Z = SCORE_FACE
    _, py, pz = SCORE_PIVOT
    uv = []
    for page in range(4):
        u = page % 2 * STAND_PAGE_WIDTH
        v = page // 2 * STAND_PAGE_HEIGHT
        uv.append({"uv": [u + 1, v + 1], "uv_size": [STAND_PAGE_WIDTH - 2, STAND_PAGE_HEIGHT - 2]})

    def leaf(name, start, end, front, *, back=None, depth=0):
        faces = {"north": uv[front]}
        if back is not None:
            faces["south"] = uv[back]
        return {"name": name, "parent": "score_lean", "pivot": rounded((0, py, pz + z + depth + (Z - z) / 2)), "cubes": [
            {"origin": rounded((start, py + y, pz + z + depth)),
             "size": rounded((end - start, Y - y, Z - z)), "uv": faces},
        ]}

    def hardware(origin, size, finish):
        u = round(finish * STAND_TEXTURE_SIZE / 2048)
        return {"origin": origin, "size": size, "uv": {
            face: {"uv": [u, STAND_HARDWARE_TOP], "uv_size": [STAND_HARDWARE_UV_SIZE, STAND_HARDWARE_UV_SIZE]}
            for face in MODEL["FACE_PLANES"]
        }}

    grand_mount = [hardware([x, 0, -.56], [1.55, .27, 1.05], 128) for x in (-8.7, 7.15)]
    grand_mount.extend([hardware([-9.7, .27, -.64], [19.4, .21, 1.24], 0),
                        hardware([-9.5, .48, -.64], [19, .18, .23], 128)])
    digital_mount = [hardware([x, 0, -.33], [1.08, .48, .59], 128) for x in (-5.62, 4.54)]
    digital_mount.extend([hardware([-7.32, .31, -.46], [14.64, .17, .79], 0),
                          hardware([-7.22, .48, -.46], [14.44, .13, .15], 128)])
    grand_board = hardware([-9.35, py, pz + .10], [18.7, 7.9, .24], 0)
    digital_board = hardware([-7.2, py, pz + .10], [14.4, 7.65, .13], 128)
    # Native X is reflected relative to the author's coordinates. The moving
    # leaf shows page 2 from the front and page 3 after rotating around its spine.
    return [{"name": "grand_mount", "pivot": [0, 0, 0], "cubes": grand_mount},
            {"name": "digital_mount", "pivot": [0, 0, 0], "cubes": digital_mount},
            {"name": "score_lean", "pivot": SCORE_PIVOT, "rotation": [-SCORE_LEAN, 0, 0]},
            {"name": "grand_board", "parent": "score_lean", "pivot": SCORE_PIVOT, "cubes": [grand_board]},
            {"name": "digital_board", "parent": "score_lean", "pivot": SCORE_PIVOT, "cubes": [digital_board]},
            leaf("score_left_first", -X, -.025, 0), leaf("score_left_second", -X, -.025, 2),
            leaf("score_right_first", .025, -x, 1), leaf("score_right_second", .025, -x, 3),
            leaf("score_leaf", .025, -x, 1, back=2, depth=-.08)]


def publish_display(full, key_parts):
    bones = defaultdict(list)
    for e in key_parts:
        pitch = int(e["name"].split("MIDI ")[1].split()[0])
        bones[pitch].append(e)
    assert set(bones) == set(range(21, 109))
    geo = native_geometry({**full, "elements": [], "model_identifier": "grand_display"})
    geo["format_version"] = "1.16.0"
    model = geo["minecraft:geometry"][0]
    model["description"].update(visible_bounds_width=4, visible_bounds_height=2, visible_bounds_offset=[0, 1, 0])
    model["bones"] = []
    rows = []
    for note, parts in bones.items():
        x, y, _, X, Y, _ = bounds(parts)
        # Place the white hinge inside its exposed section so the shared
        # eight-degree animation stays above the shallower keybed.
        pz = MODEL["model_point"]((0, 0, -3.3))[2] if len(parts) == 2 else bounds(parts)[5]
        py = (y + Y) / 2
        native = native_geometry({**full, "elements": parts})["minecraft:geometry"][0]["bones"][0]["cubes"]
        model["bones"].append({"name": f"key_{note}",
                               "pivot": rounded((-(x + X) / 2, py, pz)), "cubes": native})
        for e in parts:
            rows.append([note, *rounded((*e["from"], *e["to"], py, pz))])

    write(RP / "models/entity/grand_display.geo.json", geo)
    server = read(BP / "entities/piano_display.json")
    server["minecraft:entity"]["description"]["identifier"] = DISPLAY
    write(BP / "entities/grand_display.json", server)
    client = read(RP / "entity/piano_display.entity.json")
    desc = client["minecraft:client_entity"]["description"]
    desc.update(identifier=DISPLAY, textures={"default": "textures/blocks/grand"},
                geometry={"default": "geometry.grand_display"})
    desc["animations"].pop("lamp")
    desc["scripts"]["animate"].pop()
    write(RP / "entity/grand_display.entity.json", client)
    return rows


def publish_score():
    bones = score_bones()
    write(RP / "models/entity/grand_score.geo.json", {"format_version": "1.16.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.grand_score", "texture_width": STAND_TEXTURE_SIZE,
                        "texture_height": STAND_TEXTURE_SIZE, "visible_bounds_width": 2,
                        "visible_bounds_height": 1.2, "visible_bounds_offset": [0, .28, 0]},
        "bones": bones,
    }]})
    server = read(BP / "entities/piano_display.json")
    server["minecraft:entity"]["description"].update(identifier=SCORE_DISPLAY, properties={
        SCORE_PROPERTY: {"type": "int", "range": [0, 1], "default": 0, "client_sync": True},
        SCORE_MOUNTED: {"type": "bool", "default": False, "client_sync": True},
        SCORE_GRAND: {"type": "bool", "default": True, "client_sync": True},
        # Bedrock rejects an int property whose range min equals max; keep one
        # spare slot even when there is only one score.
        SCORE_VARIANT: {"type": "int",
                        "range": [0, max(1, len(SCORES) - 1)], "default": 0, "client_sync": True},
    })
    write(BP / "entities/grand_score.json", server)
    if SCORES:
        textures = {"default": stand_texture(SCORES[0])}
        textures.update({f"score_{index}": stand_texture(score)
                         for index, score in enumerate(SCORES)})
    else:
        textures = {"default": blank_texture(), "score_0": blank_texture()}
    write(RP / "entity/grand_score.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {
        "description": {"identifier": SCORE_DISPLAY, "materials": {"default": "entity_alphatest"},
                        "textures": textures,
                        "geometry": {"default": "geometry.grand_score"},
                        "animations": {"score": "animation.xypiano.grand_score"},
                        "scripts": {"pre_animation": [
                            f"t.page=q.property('{SCORE_PROPERTY}');"
                            "t.turn=v.score_turn??t.page;"
                            "t.step=2.5*math.max(0,q.delta_time);"
                            "v.score_turn=t.turn+math.clamp(t.page-t.turn,-t.step,t.step);",
                        ], "animate": ["score"]},
                        "render_controllers": [{"controller.render.xypiano.grand_score": f"q.property('{SCORE_MOUNTED}')"}]},
    }})
    write(RP / "animations/grand_score.animation.json", {"format_version": "1.8.0", "animations": {
        "animation.xypiano.grand_score": {"loop": True, "bones": {
            "score_leaf": {"rotation": [0, "180*v.score_turn", 0]},
        }},
    }})
    write(RP / "render_controllers/grand_score.render_controllers.json", {"format_version": "1.8.0",
        "render_controllers": {"controller.render.xypiano.grand_score": {
            "arrays": {"textures": {"Array.scores": [
                f"Texture.score_{index}" for index in range(max(1, len(SCORES)))]}},
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
            "textures": [f"Array.scores[q.property('{SCORE_VARIANT}')]"],
            "part_visibility": [{"grand_*": f"q.property('{SCORE_GRAND}')"}, {"digital_*": f"!q.property('{SCORE_GRAND}')"},
                                {"score_left_first": "v.score_turn<1"}, {"score_left_second": "v.score_turn>=1"},
                                {"score_right_first": "v.score_turn<=0"}, {"score_right_second": "v.score_turn>0"},
                                {"score_leaf": "v.score_turn>0&&v.score_turn<1"}],
        }}})


def publish_item(full):
    # The held item reuses the authored model directly; the cut cells are only
    # for the placed block assembly. Baking scale/centering keeps the existing
    # first/third-person hold animations usable without a new skeleton.
    zs = [value for e in full["elements"] for value in (e["from"][2], e["to"][2])]
    center_z = (min(zs) + max(zs)) / 2
    elements = []
    for e in full["elements"]:
        item = {**e}
        for key in ("from", "to", "origin"):
            x, y, z = e[key]
            item[key] = [x * ITEM_SCALE, y * ITEM_SCALE, (z - center_z) * ITEM_SCALE]
        elements.append(item)
    geo = native_geometry({**full, "elements": elements, "model_identifier": "grand_piano_item"})
    geo["format_version"] = "1.16.0"
    model = geo["minecraft:geometry"][0]
    model["description"].update(visible_bounds_width=3, visible_bounds_height=2, visible_bounds_offset=[0, .5, 0])
    model["bones"][0].update(name="piano", pivot=[0, 0, 0],
                             binding="q.item_slot_to_bone_name(context.item_slot)")
    write(RP / "models/entity/grand_piano_item.geo.json", geo)


def keyboard_bounds(keys):
    angle = radians(-KEY_PRESS_DEGREES)
    boxes = []
    for _, x, y, z, X, Y, Z, py, pz in keys:
        boxes.append({"from": [x, y, z], "to": [X, Y, Z]})
        rotated = [(py + cos(angle) * (yy - py) - sin(angle) * (zz - pz),
                    pz + sin(angle) * (yy - py) + cos(angle) * (zz - pz))
                   for yy in (y, Y) for zz in (z, Z)]
        boxes.append({"from": [x, min(p[0] for p in rotated), min(p[1] for p in rotated)],
                      "to": [X, max(p[0] for p in rotated), max(p[1] for p in rotated)]})
    limits = bounds(boxes)
    return rounded([v + (-.001 if i < 3 else .001) for i, v in enumerate(limits)])


def write_runtime(parts, interaction_cells, full, keys):
    # The native target already rejects rays intercepted by other cells; the
    # keyboard assembly and nearby shelf still need per-cube occlusion checks.
    case = [e for e in full["elements"] if e["name"].startswith(("Keyboard / ", "Curved case / front crossblock"))]
    panel = {"Keyboard / fallboard", "Keyboard / folded fallboard cap", "Keyboard / nameplate", "Curved case / front crossblock"}
    data = {
        "GRAND_PARTS": parts,
        "GRAND_INTERACTION_CELLS": interaction_cells,
        "GRAND_RETIRED_CELLS": ["xypiano:" + name for name in RETIRED_CELLS],
        "GRAND_KEYBOARD_HITBOX": keyboard_bounds(keys),
        "GRAND_KEY_HITBOXES": keys,
        "GRAND_CASE_HITBOXES": [e["from"] + e["to"] for e in case],
        "GRAND_PANEL_BOXES": [i for i, e in enumerate(case) if e["name"] in panel],
        "GRAND_PARTICLE_LINE": {"y": MODEL["model_point"]((0, 22.7, -2.9))[1], "z": MODEL["model_point"]((0, 22.7, -2.9))[2]},
        "SCORE_STAND": {"heights": SCORE_HEIGHTS, "z": SCORE_ORIGIN_Z, "pivot": SCORE_PIVOT,
                        "lean": SCORE_LEAN, "face": SCORE_FACE},
    }
    path = ADDON / "src/data/grand.generated.ts"
    path.write_text("// Generated by tools/publish-grand.py.\n" + "\n\n".join(
        f"export const {name} = {json.dumps(value, indent=4) if name == 'GRAND_PARTS' else json.dumps(value)} as const;"
        for name, value in data.items()) + "\n", encoding="utf-8")


def write_score_pack():
    # 预制曲谱使用 assets/scores 下的真实谱面图片；生成器可以继续追加/替换。
    scores = [{"id": score["id"], "title": score["title"],
               "pageCount": len(score["source_pages"]),
               "pages": list(ui_pages(score))}
              for score in SCORES]
    text = ("// Generated by tools/publish-grand.py.\n"
            "export const SCORE_RESOURCE_PACK_ID = __PIANO_SCORE_RESOURCE_PACK__;\n\n"
            f"export const PIANO_SCORES = {json.dumps(scores, ensure_ascii=False, indent=4)} as const;\n")
    (ADDON / "src/data/scorePack.ts").write_text(text, encoding="utf-8")


def main():
    source = ASSETS / "grand_full.bbmodel"
    full = read(source)
    manifest = read(ASSETS / "cut-map.json")
    if sha256(source.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("Cut the current full model with tools/model-grand.py before publishing.")
    texture = Image.open(ASSETS / "grand.png").convert("RGB")
    parts, interaction_cells = [], []
    for cell in manifest["cells"]:
        x, y, z = cell["offset"]
        project = read(ASSETS / cell["project"])
        assert project["model_identifier"] not in RETIRED_CELLS
        part_id = "xypiano:" + project["model_identifier"]
        parts.append({"typeId": part_id, "right": -x, "forward": -z, "up": y})
        front_layer = y if z == 0 and y <= 1 else None
        if front_layer is not None:
            interaction_cells.append(part_id)
        publish_cell(project, part_id, front_layer=front_layer)
    for name in RETIRED_CELLS:
        publish_cell({**full, "model_identifier": name, "elements": []}, "xypiano:" + name)
    keys = publish_display(full, [e for e in full["elements"] if key_name(e)])
    publish_score()
    publish_score_assets(RP)
    publish_item(full)
    texture.save(RP / "textures/blocks/grand.png")
    write_runtime(parts, interaction_cells, full, keys)
    write_score_pack()


if __name__ == "__main__":
    main()
