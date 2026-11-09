"""Publish the saved concert grand cuts as playable PianoBE resources."""

from collections import defaultdict
from hashlib import sha256
import json
from math import cos, radians, sin
from pathlib import Path
from runpy import run_path

from PIL import Image, ImageDraw


MODEL = run_path(str(Path(__file__).with_name("model-grand.py")))
ASSETS = MODEL["ASSETS"]
ADDON = ASSETS.parents[1] / "packages/addon"
BP = ADDON / "bp"
RP = ADDON / "rp"
write = MODEL["write"]
rounded = MODEL["rounded"]
native_geometry = MODEL["CELL_TOOLS"]["native_geometry"]
DISPLAY = "xypiano:grand_display"
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


def publish_cell(project, part_id):
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
    components["minecraft:selection_box"] = box_component(elements) if elements else False
    # Lid and music desk remain selectable but do not stop players walking under
    # the overhang. Feet and main case contribute native collision in each cell.
    collision = []
    for names in (("Curved case", "Keyboard", "Controls"), ("Legs and casters",), ("Pedal lyre",)):
        solid = [e for e in elements if e["name"].startswith(names)]
        if solid:
            collision.append(box_component(solid))
    components["minecraft:collision_box"] = collision if len(collision) > 1 else collision[0] if collision else False
    write(BP / f"blocks/grand/{path}.json", template)


def publish_display(full, key_parts, midi_button, texture):
    bones = defaultdict(list)
    for e in key_parts:
        pitch = int(e["name"].split("MIDI ")[1].split()[0])
        bones[pitch].append(e)
    assert set(bones) == set(range(21, 109))
    geo = native_geometry({**full, "elements": [], "model_identifier": "grand_display"})
    geo["format_version"] = "1.16.0"
    model = geo["minecraft:geometry"][0]
    model["description"].update(visible_bounds_width=4, visible_bounds_height=2, visible_bounds_offset=[0, 1, 0])
    model["bones"] = [{"name": "piano", "pivot": [0, 0, 0]}]
    rows = []
    for note, parts in bones.items():
        x, y, _, X, Y, _ = bounds(parts)
        # Place the white hinge inside its exposed section so the shared
        # eight-degree animation stays above the shallower keybed.
        pz = MODEL["model_point"]((0, 0, -3.3))[2] if len(parts) == 2 else bounds(parts)[5]
        py = (y + Y) / 2
        native = native_geometry({**full, "elements": parts})["minecraft:geometry"][0]["bones"][0]["cubes"]
        model["bones"].append({"name": f"key_{note}", "parent": "piano",
                               "pivot": rounded((-(x + X) / 2, py, pz)), "cubes": native})
        for e in parts:
            rows.append([note, *rounded((*e["from"], *e["to"], py, pz))])

    lamp = MODEL["Grand"]()
    glow = (199, 137, 207, 145)
    ImageDraw.Draw(texture).rectangle(glow, fill=(122, 241, 211))
    lamp.box("Controls", "playing indicator", (1.47, 24.26, -1.26), (1.82, 24.6, -1.19),
             "brass", projected={face: glow for face in MODEL["FACE_PLANES"]})
    assert lamp.elements[0]["to"][2] == midi_button["from"][2]
    native = native_geometry({**full, "elements": lamp.elements})["minecraft:geometry"][0]["bones"][0]["cubes"]
    x, y, z, X, Y, Z = bounds(lamp.elements)
    model["bones"].append({"name": "playback_light", "parent": "piano",
                           "pivot": rounded((-(x + X) / 2, (y + Y) / 2, (z + Z) / 2)), "cubes": native})
    write(RP / "models/entity/grand_display.geo.json", geo)
    server = read(BP / "entities/piano_display.json")
    server["minecraft:entity"]["description"]["identifier"] = DISPLAY
    write(BP / "entities/grand_display.json", server)
    client = read(RP / "entity/piano_display.entity.json")
    desc = client["minecraft:client_entity"]["description"]
    desc.update(identifier=DISPLAY, textures={"default": "textures/blocks/grand"},
                geometry={"default": "geometry.grand_display"})
    write(RP / "entity/grand_display.entity.json", client)
    return rows


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


def write_runtime(parts, interaction_cells, full, buttons, keys):
    # The native target already rejects rays intercepted by other cells; the
    # keyboard assembly and nearby shelf still need per-cube occlusion checks.
    occluders = [e["from"] + e["to"] for e in full["elements"]
                 if e["name"].startswith(("Keyboard / ", "Music desk / ", "Curved case / front crossblock"))]
    data = {
        "GRAND_PARTS": parts,
        "GRAND_INTERACTION_CELLS": interaction_cells,
        "GRAND_RETIRED_CELLS": ["xypiano:" + name for name in RETIRED_CELLS],
        "GRAND_KEYBOARD_HITBOX": keyboard_bounds(keys),
        "GRAND_KEY_HITBOXES": keys,
        "GRAND_CASE_HITBOXES": occluders,
        "GRAND_BUTTONS": [[e["name"].split(" / ")[1], e["from"] + e["to"]] for e in buttons],
        "GRAND_PARTICLE_LINE": MODEL["model_point"]((0, 22.7, -2.9)),
        "GRAND_TEXT": {"center": MODEL["model_point"]((0, 34.2, 3)),
                       "width": MODEL["model_point"]((16, 0, 0))[0], "height": 1.8},
    }
    path = ADDON / "src/instrument/grand.generated.ts"
    path.write_text("// Generated by tools/publish-grand.py.\n" + "\n\n".join(
        f"export const {name} = {json.dumps(value, indent=4) if name == 'GRAND_PARTS' else json.dumps(value)} as const;"
        for name, value in data.items()) + "\n", encoding="utf-8")


def main():
    source = ASSETS / "grand_full.bbmodel"
    full = read(source)
    manifest = read(ASSETS / "cut-map.json")
    if sha256(source.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("Cut the current full model with tools/model-grand.py before publishing.")
    texture = Image.open(ASSETS / "grand.png").convert("RGB")
    buttons = [e for e in full["elements"] if e["name"].startswith("Controls / ")]
    midi_button = next(e for e in buttons if e["name"] == "Controls / midi")
    parts, interaction_cells = [], []
    for cell in manifest["cells"]:
        x, y, z = cell["offset"]
        project = read(ASSETS / cell["project"])
        assert project["model_identifier"] not in RETIRED_CELLS
        part_id = "xypiano:" + project["model_identifier"]
        parts.append({"typeId": part_id, "right": -x, "forward": -z, "up": y})
        if any(key_name(e) or e["name"].startswith("Controls / ") for e in project["elements"]):
            interaction_cells.append(part_id)
        publish_cell(project, part_id)
    for name in RETIRED_CELLS:
        publish_cell({**full, "model_identifier": name, "elements": []}, "xypiano:" + name)
    keys = publish_display(full, [e for e in full["elements"] if key_name(e)], midi_button, texture)
    publish_item(full)
    texture.save(RP / "textures/blocks/grand.png")
    write_runtime(parts, interaction_cells, full, buttons, keys)


if __name__ == "__main__":
    main()
