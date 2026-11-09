"""Author the upright piano, then cut the saved Blockbench project into cells."""

import argparse
import base64
from collections import defaultdict
import hashlib
from io import BytesIO
import json
from math import sin
from pathlib import Path
from random import Random
from uuid import NAMESPACE_URL, uuid5

from PIL import Image, ImageDraw


ASSETS = Path(__file__).resolve().parents[1] / "assets/upright"
FULL = ASSETS / "upright_full.bbmodel"
ATLAS_SIZE = 256
PALETTE = {
    "ebony": (44, 30, 27),
    "lacquer": (61, 40, 34),
    "edge": (84, 54, 41),
    "shadow": (28, 22, 22),
    "walnut": (81, 46, 33),
    "inset": (57, 32, 26),
    "brass": (172, 117, 55),
    "brass_light": (210, 163, 86),
    "ivory": (235, 224, 195),
    "ivory_side": (189, 171, 144),
    "key": (47, 42, 44),
    "key_side": (23, 20, 23),
    "felt": (91, 30, 36),
    "badge": (48, 28, 24),
}
TILES = {name: (i % 4 * 64, i // 4 * 32) for i, name in enumerate(PALETTE)}

# Blockbench face planes and signed UV axes, as in ddz's editable table cutter.
FACE_PLANES = {
    "north": (2, -1), "south": (2, 1), "east": (0, 1), "west": (0, -1),
    "up": (1, 1), "down": (1, -1),
}
FACE_AXES = {
    "north": ((0, -1), (1, -1)), "south": ((0, 1), (1, -1)),
    "east": ((2, -1), (1, -1)), "west": ((2, 1), (1, -1)),
    "up": ((0, 1), (2, 1)), "down": ((0, 1), (2, -1)),
}


def uid(name):
    return str(uuid5(NAMESPACE_URL, f"xypiano/upright/{name}"))


def rounded(values):
    return [round(value, 6) or 0 for value in values]


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")


def atlas():
    image = Image.new("RGB", (ATLAS_SIZE, ATLAS_SIZE), PALETTE["shadow"])
    rng = Random(182)
    for material, rgb in PALETTE.items():
        u, v = TILES[material]
        for y in range(32):
            for x in range(64):
                tone = rng.choice((-1, 0, 0, 1))
                if material in {"ebony", "lacquer", "edge", "walnut", "inset"}:
                    grain = y + 1.5 * sin(x * .13) + sin(x * .06 + y * .3)
                    tone += 4 * sin(grain * 1.3) + 3 * sin(grain * .57) + (16 - y) * .21
                if material in {"brass", "brass_light"}:
                    tone += 11 * sin(y * .23) + (16 - y) * .4
                image.putpixel((u + x, v + y), tuple(round(c + tone) for c in rgb))

    u, v = TILES["badge"]
    draw = ImageDraw.Draw(image)
    gold = (211, 161, 86)
    draw.rectangle((u + 3, v + 3, u + 60, v + 28), outline=(137, 87, 43))
    draw.text((u + 32, v + 16), "NOCTURNE", fill=gold, anchor="mm")
    return image


def author():
    elements, sections = [], defaultdict(list)

    def box(section, name, start, end, material, **face_materials):
        label = f"{section} / {name}"
        faces = {}
        for face in FACE_PLANES:
            u, v = TILES[face_materials.get(face, material)]
            faces[face] = {"uv": [u + 1, v + 1, u + 63, v + 31], "texture": 0}
        element = {"name": label, "type": "cube", "uuid": uid(label), "box_uv": False,
                   "from": rounded(start), "to": rounded(end), "origin": [0, 0, 0],
                   "faces": faces, "autouv": 0}
        elements.append(element)
        sections[section].append(element["uuid"])

    def frame(section, name, x, y, X, Y, z, Z, width, material):
        box(section, name + " bottom", (x, y, z), (X, y + width, Z), material)
        box(section, name + " top", (x, Y - width, z), (X, Y, Z), material)
        box(section, name + " left", (X - width, y + width, z), (X, Y - width, Z), material)
        box(section, name + " right", (x, y + width, z), (x + width, Y - width, Z), material)

    box("Cabinet", "soundboard enclosure", (-22.5, 1.35, 2), (22.5, 27.6, 12.8), "ebony")
    box("Cabinet", "back panel", (-21.7, 2.1, 12.8), (21.7, 26.9, 13.25), "inset")
    for x in (-17, -8.5, 0, 8.5, 17):
        box("Cabinet", f"back post {x}", (x - .44, 1.5, 13.25), (x + .44, 27.6, 13.65), "ebony")
    box("Cabinet", "top cornice", (-23, 27.6, .6), (23, 28.05, 13.4), "edge")
    box("Cabinet", "overhanging lid", (-23.6, 28.05, .22), (23.6, 29.1, 13.9), "lacquer", up="ebony")
    box("Cabinet", "lid bead", (-22.95, 27.84, .45), (22.95, 28.05, .6), "shadow")
    box("Cabinet", "front lid pinstripe", (-22.45, 28.38, .18), (22.45, 28.5, .22), "brass")

    box("Upper panel", "front board", (-22.45, 15.6, 1.65), (22.45, 27.6, 2), "lacquer")
    box("Upper panel", "walnut field", (-20.65, 17.45, 1.34), (20.65, 26.28, 1.65), "walnut")
    frame("Upper panel", "outer moulding", -21.18, 16.95, 21.18, 26.79, 1.07, 1.65, .51, "edge")
    frame("Upper panel", "inner inlay", -20.46, 17.65, 20.46, 26.08, 1.24, 1.34, .12, "brass")
    for x in (-17, 17):
        frame("Upper panel", f"side inset {x}", x - 2.25, 18.7, x + 2.25, 25.04, 1.24, 1.34, .18, "inset")

    box("Music rest", "recessed center", (-11.4, 18.45, .94), (11.4, 25.13, 1.34), "inset")
    frame("Music rest", "edge", -11.52, 18.33, 11.52, 25.25, .64, .94, .32, "lacquer")
    for i in range(-5, 6):
        x = i * 1.57
        height = 2.1 - abs(i) * .27
        box("Music rest", f"flute {i}", (x - .24, 22.12 - height, .77),
            (x + .24, 22.12 + height, .94), "edge")
    box("Music rest", "sheet ledge", (-12.05, 17.96, .24), (12.05, 18.44, 1.34), "lacquer", up="edge")
    box("Music rest", "ledge lip", (-11.85, 18.44, .24), (11.85, 18.63, .48), "edge")

    box("Keyboard", "key bed", (-23.1, 12.55, -10.68), (23.1, 13.9, 2), "ebony")
    box("Keyboard", "front apron", (-22.72, 12.45, -10.93), (22.72, 13.54, -10.68), "lacquer")
    box("Keyboard", "apron bead", (-22.7, 12.94, -11.08), (22.7, 13.1, -10.93), "edge")
    box("Keyboard", "fallboard", (-22.3, 13.9, .12), (22.3, 16.53, 1.65), "lacquer")
    box("Keyboard", "felt strip", (-20.8, 14.26, -.06), (20.8, 15.38, .12), "felt")
    box("Keyboard", "fallboard inlay", (-20.7, 15.62, .04), (20.7, 15.72, .12), "brass")
    box("Keyboard", "maker's plate", (-3.42, 15.53, .015), (3.42, 16.42, .12), "brass", north="badge")

    for side in (-1, 1):
        section = "Left cheek and leg" if side == 1 else "Right cheek and leg"

        def side_box(name, x, y, z, X, Y, Z, material, **faces):
            low, high = sorted((side * x, side * X))
            box(section, name, (low, y, z), (high, Y, Z), material, **faces)

        side_box("keyboard cheek", 20.8, 13.9, -10.67, 23.1, 15.33, 2, "lacquer", up="edge")
        side_box("shoulder cap", 21.28, 15.33, -8.9, 23.02, 15.86, 2, "ebony")
        side_box("cabinet end stile", 22.5, 1.35, 2, 23.12, 27.6, 12.8, "lacquer")
        side_box("side inset", 23.12, 3.55, 3.25, 23.34, 26.48, 11.55, "inset")
        side_box("top leg collar", 19.82, 11.46, -8.8, 23.04, 12.55, -4.1, "edge")
        side_box("upper leg", 20.09, 9.95, -8.58, 22.79, 11.46, -4.3, "lacquer")
        side_box("leg", 20.37, 2.3, -8.32, 22.56, 9.95, -4.53, "ebony")
        side_box("leg flute", 21.09, 3.01, -8.48, 21.81, 9.42, -8.32, "lacquer")
        side_box("leg shoe", 20.03, 1.35, -8.72, 22.94, 2.3, -4.24, "lacquer")
        side_box("plinth base", 18.88, 0, -10.3, 23.43, .74, 13.37, "shadow")
        side_box("plinth crown", 19.18, .74, -10, 23.15, 1.35, 13.05, "ebony", up="edge")
        side_box("plinth front cap", 19.12, .34, -10.5, 23.2, .64, -10.3, "brass")

    box("Lower panel", "plinth crossrail", (-18.88, 0, .85), (18.88, .74, 12.8), "shadow")
    box("Lower panel", "crossrail crown", (-19.18, .74, .85), (19.18, 1.35, 12.8), "ebony")
    box("Lower panel", "kneeboard", (-21.6, 1.35, 1.4), (21.6, 12.55, 2), "lacquer")
    box("Lower panel", "walnut field", (-18.56, 3.04, 1.13), (18.56, 10.84, 1.4), "walnut")
    frame("Lower panel", "outer moulding", -19.13, 2.49, 19.13, 11.41, .93, 1.4, .56, "edge")
    frame("Lower panel", "inner bevel", -18.36, 3.25, 18.36, 10.62, 1.02, 1.13, .18, "inset")
    for x in (-13, 13):
        frame("Lower panel", f"panel {x}", x - 4.22, 4.1, x + 4.22, 9.77, 1.04, 1.13, .22, "inset")
    box("Pedals", "pedal housing", (-5.05, 0, -1.28), (5.05, 2.67, 1.4), "ebony", up="edge")
    box("Pedals", "pedal escutcheon", (-4.28, .38, -1.55), (4.28, 1.65, -1.28), "brass")
    for i, x in enumerate((-2.66, 0, 2.66)):
        tip = -6.65 if i == 1 else -6.18
        box("Pedals", f"heel {i}", (x - .45, .55, -3.28), (x + .45, 1.18, -1.55), "brass")
        box("Pedals", f"lever {i}", (x - .4, .55, tip + 1.24), (x + .4, 1.01, -3.28), "brass")
        box("Pedals", f"tread {i}", (x - .78, .51, tip + .29), (x + .78, 1.07, tip + 1.24),
            "brass", up="brass_light")
        box("Pedals", f"toe {i}", (x - .59, .55, tip), (x + .59, 1.01, tip + .29),
            "brass", up="brass_light")

    black_notes = {1, 3, 6, 8, 10}
    white = 0
    for note in range(21, 109):
        x = 20.8 - white * .8
        if note % 12 in black_notes:
            box("Black keys", f"MIDI {note}", (x - .236, 14.29, -6.98),
                (x + .236, 15.46, -.12), "key_side", up="key")
        else:
            box("White keys", f"MIDI {note} front", (x - .776, 13.9, -10.58),
                (x - .024, 14.78, -7.04), "ivory_side", up="ivory")
            lo = x - .8 + (.25 if (note + 1) % 12 in black_notes else .024)
            hi = x - (.25 if (note - 1) % 12 in black_notes else .024)
            box("White keys", f"MIDI {note} back", (lo, 13.9, -7.04),
                (hi, 14.78, -.10), "ivory_side", up="ivory")
            white += 1
    assert white == 52

    texture = BytesIO()
    atlas().save(texture, format="PNG")
    groups = [{"name": name, "uuid": uid(f"group/{name}"), "origin": [0, 0, 0],
               "rotation": [0, 0, 0]} for name in sections]
    return {
        "meta": {"format_version": "5.0", "model_format": "bedrock", "box_uv": False},
        "name": "Nocturne Upright Piano",
        "model_identifier": "upright_full",
        "visible_box": [4, 2, .9],
        "resolution": {"width": ATLAS_SIZE, "height": ATLAS_SIZE},
        "elements": elements, "groups": groups,
        "outliner": [{"uuid": uid(f"group/{name}"), "isOpen": False, "children": children}
                     for name, children in sections.items()],
        "textures": [{"id": "0", "uuid": uid("atlas"), "name": "upright.png",
                      "width": ATLAS_SIZE, "height": ATLAS_SIZE, "uv_width": ATLAS_SIZE, "uv_height": ATLAS_SIZE,
                      "source": "data:image/png;base64," + base64.b64encode(texture.getvalue()).decode("ascii")}],
    }


def clip(element, low, high, cell):
    lo = [max(a, b) for a, b in zip(element["from"], low)]
    hi = [min(a, b) for a, b in zip(element["to"], high)]
    if any(a >= b for a, b in zip(lo, hi)):
        return None
    result = {**element, "uuid": uid(f"{element['uuid']}/{cell}"),
              "name": f"{element['name']} / {cell}", "from": lo, "to": hi, "faces": {}}
    for face, data in element["faces"].items():
        axis, direction = FACE_PLANES[face]
        plane = "to" if direction == 1 else "from"
        if result[plane][axis] != element[plane][axis] or data["texture"] is None:
            result["faces"][face] = {**data, "texture": None}
            continue
        u, v, U, V = data["uv"]
        start, end = [], []
        for (axis, sign), uv_start, uv_end in zip(FACE_AXES[face], (u, v), (U, V)):
            origin = element["from"][axis]
            span = element["to"][axis] - origin
            a, b = (lo[axis] - origin) / span, (hi[axis] - origin) / span
            if sign < 0:
                a, b = 1 - b, 1 - a
            start.append(uv_start + (uv_end - uv_start) * a)
            end.append(uv_start + (uv_end - uv_start) * b)
        result["faces"][face] = {**data, "uv": rounded(start + end)}
    return result


def cut_project(source, name, pieces, refs, offset=(0, 0, 0)):
    def local(point):
        return rounded([a - b for a, b in zip(point, offset)])

    group_ids = set()

    def prune(nodes):
        kept = []
        for node in nodes:
            if isinstance(node, str):
                kept.extend(refs.get(node, []))
            else:
                children = prune(node["children"])
                if children:
                    group_ids.add(node["uuid"])
                    kept.append({**node, "children": children})
        return kept

    outliner = prune(source["outliner"])
    return {
        **source, "name": f"{source['name']} / {name}", "model_identifier": f"upright_{name}",
        "visible_box": [2, 2, .5] if name != "reassembled" else source["visible_box"],
        "groups": [{**group, "origin": local(group["origin"])} for group in source["groups"]
                   if group["uuid"] in group_ids],
        "elements": [{**e, **{key: local(e[key]) for key in ("from", "to", "origin")}} for e in pieces],
        "outliner": outliner,
    }


def native_geometry(project):
    cubes = []
    for element in project["elements"]:
        x, y, z = element["from"]
        X, Y, Z = element["to"]
        faces = {}
        for name, data in element["faces"].items():
            if data["texture"] is None:
                continue
            u, v, U, V = data["uv"]
            if name in {"up", "down"}:
                u, v, U, V = U, V, u, v
            faces[name] = {"uv": [u, v], "uv_size": rounded((U - u, V - v))}
        cubes.append({"origin": [-X, y, z], "size": rounded((X - x, Y - y, Z - z)), "uv": faces})
    return {"format_version": "1.26.10", "minecraft:geometry": [{
        "description": {
            "identifier": "geometry." + project["model_identifier"],
            "texture_width": project["resolution"]["width"],
            "texture_height": project["resolution"]["height"],
            "visible_bounds_width": 2, "visible_bounds_height": 2, "visible_bounds_offset": [0, .5, 0],
        },
        "bones": [{"name": "upright", "pivot": [0, 0, 0], "cubes": cubes}],
    }]}


def cut(raw):
    source = json.loads(raw)
    elements = source["elements"]
    if any(any(g.get("rotation", ())) for g in source["groups"]):
        raise ValueError("Bake group rotations before cutting.")
    for e in elements:
        if (e["type"] != "cube" or e.get("box_uv") or e.get("inflate") or any(e.get("rotation", ()))
                or any(f.get("rotation") or f["texture"] not in (0, None) for f in e["faces"].values())):
            raise ValueError(f"Expected an axis-aligned per-face UV cube using the shared atlas: {e['name']}")
        if not all(lo <= a < b <= hi for lo, a, b, hi in
                   zip((-24, 0, -16), e["from"], e["to"], (24, 32, 16))):
            raise ValueError(f"Cube is degenerate or outside the 3 × 2 × 2 grid: {e['name']}")

    assembled, cells, projects = [], [], []
    all_refs = defaultdict(list)
    for row, base_y in (("lower", 0), ("upper", 16)):
        for depth, center_z in (("front", -8), ("back", 8)):
            for side, center_x in (("left", 16), ("center", 0), ("right", -16)):
                cell = f"{row}_{depth}_{side}"
                center = (center_x, base_y, center_z)
                low = (center_x - 8, base_y, center_z - 8)
                high = (center_x + 8, base_y + 16, center_z + 8)
                pieces, refs = [], {}
                for element in elements:
                    fragment = clip(element, low, high, cell)
                    if fragment is None:
                        continue
                    pieces.append(fragment)
                    refs[element["uuid"]] = [fragment["uuid"]]
                    all_refs[element["uuid"]].append(fragment["uuid"])
                if not pieces:
                    continue
                assembled.extend(pieces)
                project_path = f"cut/upright_{cell}.bbmodel"
                geometry_path = f"bedrock/upright_{cell}.geo.json"
                project = cut_project(source, cell, pieces, refs, center)
                projects.append((project_path, geometry_path, project))
                cells.append({"cell": cell, "offset": [center_x // 16, base_y // 16, center_z // 16],
                              "center": center, "project": project_path, "geometry": geometry_path,
                              "cubes": len(pieces)})

    texture = source["textures"][0]["source"].split(",", 1)[1]
    (ASSETS / "upright.png").write_bytes(base64.b64decode(texture, validate=True))
    for project_path, geometry_path, project in projects:
        write(ASSETS / project_path, project)
        write(ASSETS / geometry_path, native_geometry(project))
    write(ASSETS / "cut/upright_reassembled.bbmodel", cut_project(source, "reassembled", assembled, all_refs))
    write(ASSETS / "cut-map.json", {
        "source": FULL.name, "sha256": hashlib.sha256(raw).hexdigest(),
        "cells": cells,
    })
    print(f"Cut {len(elements)} cubes into {len(assembled)} fragments across {len(cells)} occupied cells.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("author", "cut"))
    parser.add_argument("--replace", action="store_true", help="Allow author to replace an edited full model.")
    args = parser.parse_args()
    if args.stage == "author":
        if FULL.exists() and not args.replace:
            parser.error("Full model already exists. Use cut to export it or --replace to reset it.")
        write(FULL, author())
        print(f"Saved {FULL}")
    else:
        cut(FULL.read_bytes())


if __name__ == "__main__":
    main()
