"""Author the complete FP-30X-inspired piano and export the Bedrock assets.

Design coordinates are in sixteenths of a block. For north placement the
anchor is at design x=8 and the player is at negative z. Bedrock mirrors
geometry's local X when drawing a block, so publication reflects the model
before cutting it into native cells.
Run from any directory with Python 3 and Pillow.
"""
import base64
from collections import defaultdict
from dataclasses import dataclass
from io import BytesIO
import json
import math
from pathlib import Path
import random
import uuid

from PIL import Image, ImageDraw

ADDON = Path(__file__).resolve().parents[1] / "packages/addon"
RP = ADDON / "rp"
BP = ADDON / "bp"
SIZE = 128
CASE_WIDTH = 31.3
HORIZONTAL_SCALE = 32 / CASE_WIDTH
HEIGHT_SCALE = HORIZONTAL_SCALE / .86  # Preserve the current model's proportions.
KEY_PRESS_DEGREES = 8
KEY_PRESS_SECONDS = .04
KEY_RELEASE_SECONDS = .08
KEY_RESTRIKE_LIFT_SECONDS = .025
DISPLAY = "xypiano:piano_display"
KEYS_PER_MASK = 11
PITCHES = range(21, 109)
FACES = ("north", "south", "west", "east", "up", "down")
# The Bedrock cube codec reflects X relative to Blockbench. Up/down UV
# endpoints are also flipped, so their U increases with native X.
FACE_X_DIRECTION = {"north": 1, "south": -1, "up": 1, "down": 1}
SURFACES = {
    "charcoal": (45, 49, 54), "shell_edge": (29, 33, 39), "feet": (30, 33, 37),
    "white": (242, 239, 224), "white_side": (201, 202, 194),
    "black": (42, 47, 56), "black_side": (17, 20, 25),
    "panel": (25, 31, 39), "grille": (58, 64, 72),
    "pedal": (192, 179, 142), "pedal_edge": (123, 115, 94),
    "button": (101, 113, 130), "strip": (75, 86, 101),
    "label": (47, 52, 58), "led_off": (18, 40, 48), "led_on": (84, 225, 246),
    "keys_cap": (63, 74, 85), "midi_cap": (37, 74, 83),
    "lcd": (23, 48, 52), "bezel": (30, 35, 42),
    "settings_cap": (75, 66, 53),
}
TILES = {name: (i % 4 * 32, i // 4 * 16) for i, name in enumerate(SURFACES)}


@dataclass
class Part:
    name: str
    start: tuple
    end: tuple
    faces: dict
    bone: str
    pivot: tuple = (0, 0, 0)


parts = []


def part(name, start, end, surface, *, top=None, bone="case", pivot=(0, 0, 0), open_faces=()):
    faces = {}
    for face in FACES:
        if face in open_faces:
            continue
        u, v = TILES[top if face == "up" and top else surface]
        faces[face] = (u + 1, v + 1, 30, 14)
    if top in {"label", "keys_cap", "midi_cap", "settings_cap"}:
        u, v, w, h = faces["up"]
        faces["up"] = (u + w, v, -w, h)
    def scale(point):
        x, y, z = point
        return x * HORIZONTAL_SCALE, y * HEIGHT_SCALE, z * HORIZONTAL_SCALE
    parts.append(Part(name, scale(start), scale(end), faces, bone, scale(pivot)))


def author_piano():
    part("keyboard tray", (-15.65, 11.45, -3.55), (15.65, 11.82, 3.25), "shell_edge")
    part("rear keyboard support", (-15.65, 11.82, -.54), (15.65, 12.22, 3.25), "shell_edge")
    part("rounded front lip", (-15.5, 11.60, -3.71), (15.5, 11.80, -3.55), "charcoal")
    part("rear body", (-15.5, 12.22, -.54), (15.5, 13.83, 3.15), "charcoal", open_faces=("up",))
    # Four shell strips leave the screen aperture open; only the entity draws
    # the LCD surface there.
    for sign, name in ((-1, "right"), (1, "left")):
        def deck(label, a, b, z, Z, top=None):
            x, X = (a, b) if sign > 0 else (-b, -a)
            part(f"rear deck {name} {label}", (x, 13.83, z), (X, 14.16, Z), "charcoal", top=top)

        if sign > 0:
            deck("inner front", 4.14, 6.5, -.54, -.08)
            deck("badge front", 4.14, 6.5, .32, 1.8)
            deck("badge back", 4.14, 6.5, 2.53, 3.15)
            deck("badge left", 4.14, 4.64, 1.8, 2.53)
            deck("badge right", 6.23, 6.5, 1.8, 2.53)
            deck("badge", 4.64, 6.23, 1.8, 2.53, "label")
            edge = 4.14
            for i in range(4):
                x = 4.28 + .53 * i
                deck(f"marker surround {i}", edge, x, -.08, .32)
                edge = x + .34
                deck(f"inlaid marker {i}", x, edge, -.08, .32, "button")
            deck("marker surround end", edge, 6.5, -.08, .32)
        else:
            deck("inner", 4.14, 6.5, -.54, 3.15)
        deck("outer", 13.7, 15.5, -.54, 3.15)
        deck("front of speaker", 6.5, 13.7, -.54, .78)
        deck("speaker grille", 6.5, 13.7, .78, 2.44, "grille")
        deck("behind speaker", 6.5, 13.7, 2.44, 3.15)
    part("rear deck front", (-4.14, 13.83, -.54), (4.14, 14.16, 1.04), "charcoal")
    part("rear deck back", (-4.14, 13.83, 2.81), (4.14, 14.16, 3.15), "charcoal")
    part("rear trim", (-15.45, 12.36, 3.15), (15.45, 13.96, 3.27), "shell_edge")
    part("keyboard felt", (-14.8, 12.22, -.58), (14.8, 13.26, -.54), "shell_edge")
    for sign, name in ((-1, "right"), (1, "left")):
        def bounds(a, b):
            return (a, b) if sign > 0 else (-b, -a)

        def side(label, inner, outer, y, Y, z, Z, surface, top=None):
            x, X = bounds(inner, outer)
            part(f"{name} {label}", (x, y, z), (X, Y, Z), surface, top=top)

        side("end cheek", 14.82, 15.65, 12.22, 13.21, -3.58, -0.54, "charcoal")
        side("stand leg", 13.6, 14.65, 0.44, 11.45, -1.65, 2.38, "shell_edge", "charcoal")
        side("stand face", 13.61, 14.64, 0.48, 11.4, -1.72, -1.65, "charcoal")
        side("foot", 13.28, 14.97, 0, 0.44, -4.14, 3.88, "feet")
    part("rear modesty panel", (-13.6, 7.42, 1.82), (13.6, 10.5, 2.38), "shell_edge")
    part("rear brace", (-13.6, 2.48, 2.06), (13.6, 3.17, 2.38), "charcoal")
    part("pedal bridge", (-2.53, 0.18, 0.86), (2.53, 1.06, 2.38), "shell_edge")
    part("pedal base", (-2.5, 0.04, -0.49), (2.5, 0.18, 2.47), "feet")
    for i, x in enumerate((1.4, 0, -1.4)):
        bone = f"pedal_{i}"
        pivot = (x, 0.57, 0.99)
        part(f"{bone} lever", (x - .28, .34, -.98), (x + .28, .54, 1.02), "pedal_edge",
             top="pedal", bone=bone, pivot=pivot)
        part(f"{bone} toe", (x - .41, .33, -1.46), (x + .41, .55, -.78), "pedal_edge",
             top="pedal", bone=bone, pivot=pivot)
    part("menu button", (-.84, 14.16, -.28), (.84, 14.26, .38), "button", top="keys_cap")
    part("MIDI button", (-4.45, 14.16, -.28), (-2.60, 14.26, .38), "button", top="midi_cap")
    part("settings button", (2.60, 14.16, -.28), (4.10, 14.26, .38), "button",
         top="settings_cap", bone="settings_button")
    part("LCD bezel front", (-4.35, 14.16, .85), (4.35, 14.36, 1.04), "bezel")
    part("LCD bezel back", (-4.35, 14.16, 2.81), (4.35, 14.36, 3), "bezel")
    part("LCD bezel left", (4.14, 14.16, 1.04), (4.35, 14.36, 2.81), "bezel")
    part("LCD bezel right", (-4.35, 14.16, 1.04), (-4.14, 14.36, 2.81), "bezel")
    part("LCD glass", (-4.11, 14.19, 1.07), (4.11, 14.28, 2.78), "lcd", bone="lcd")
    part("playback light", (4.9, 14.25, 1.30), (5.36, 14.31, 1.57), "led_on",
         bone="playback_light", pivot=(5.13, 14.25, 1.435))

    black_pitch_classes = {1, 3, 6, 8, 10}
    step = 29.6 / 52
    white = 0
    for midi in PITCHES:
        x = 14.8 - white * step
        bone = f"key_{midi}"
        if midi % 12 in black_pitch_classes:
            pivot = (x, 12.71, -.7)
            part(bone, (x - .17, 12.68, -2.32), (x + .17, 13.32, -.62),
                 "black_side", top="black", bone=bone, pivot=pivot)
        else:
            pivot = (x - step / 2, 12.42, -.7)
            part(bone + " front", (x - step + .023, 12.22, -3.51), (x - .023, 12.92, -2.37),
                 "white_side", top="white", bone=bone, pivot=pivot)
            # Narrow the back only on the sides where adjacent black keys pass.
            lo = x - step + (.18 if midi < 108 and (midi + 1) % 12 in black_pitch_classes else .023)
            hi = x - (.18 if midi > 21 and (midi - 1) % 12 in black_pitch_classes else .023)
            part(bone + " back", (lo, 12.22, -2.37), (hi, 12.92, -.71),
                 "white_side", top="white", bone=bone, pivot=pivot)
            white += 1
    assert white == 52 and len({p.bone for p in parts if p.bone.startswith("key_")}) == 88


def atlas():
    image = Image.new("RGB", (SIZE, SIZE), SURFACES["charcoal"])
    rng = random.Random(88)
    draw = ImageDraw.Draw(image)
    for material, rgb in SURFACES.items():
        u, v = TILES[material]
        for x in range(32):
            for y in range(16):
                tone = rng.choice((-1, 0, 0, 0, 1))
                if material in {"charcoal", "white", "black", "pedal"}:
                    tone += 2 - y // 4
                if material == "grille":
                    tone += -24 if x % 3 == 1 and y % 3 == 1 else 4
                image.putpixel((u + x, v + y), tuple(max(0, min(255, c + tone)) for c in rgb))
    u, v = TILES["label"]
    draw.text((u + 4, v + 1), "P-88", fill=(190, 198, 202))
    for tile, label, color in (("keys_cap", "KEYS", (221, 226, 223)),
                               ("midi_cap", "MIDI", (157, 228, 222)),
                               ("settings_cap", "SET", (249, 220, 159))):
        u, v = TILES[tile]
        draw.text((u + 16, v + 8), label, anchor="mm", fill=color)
    u, v = TILES["led_on"]
    draw.line((u + 1, v + 5, u + 30, v + 5), fill=(175, 248, 255), width=2)
    return image


def inventory_icon(texture):
    """Rasterize the same geometry and atlas for the item slot."""
    size = 192
    scale = 5
    # A slight turn and tilt keep the keys and pedal bank readable at 64px.
    view = (.21, .43, -.878)
    right = (-.9726, 0, -.2326)
    up = (-.10, .903, .418)
    icon = Image.new("RGBA", (size, size))
    depth = [-math.inf] * (size * size)
    pixels = icon.load()
    texels = texture.load()

    def dot(a, b):
        return sum(x * y for x, y in zip(a, b))

    def project(point):
        point = (point[0], point[1] - 7.3, point[2])
        return (size / 2 + dot(point, right) * scale, size / 2 - dot(point, up) * scale, dot(point, view))

    for p in parts:
        if p.bone == "playback_light":
            continue
        x, y, z = p.start
        X, Y, Z = p.end
        faces = {
            "north": ((x, Y, z), (X, Y, z), (x, y, z), .82),
            "west": ((X, Y, z), (X, Y, Z), (X, y, z), .70),
            "up": ((x, Y, Z), (X, Y, Z), (x, Y, z), 1.08),
        }
        for face, (start, across, down, shade) in faces.items():
            if face not in p.faces:
                continue
            a, b, c = map(project, (start, across, down))
            dx, dy, dz = (t - s for s, t in zip(a, b))
            ex, ey, ez = (t - s for s, t in zip(a, c))
            end = (b[0] + ex, b[1] + ey)
            det = dx * ey - dy * ex
            u, v, width, height = p.faces[face]
            for iy in range(max(0, int(min(a[1], b[1], c[1], end[1]))),
                            min(size, math.ceil(max(a[1], b[1], c[1], end[1])))):
                for ix in range(max(0, int(min(a[0], b[0], c[0], end[0]))),
                                min(size, math.ceil(max(a[0], b[0], c[0], end[0])))):
                    px, py = ix + .5 - a[0], iy + .5 - a[1]
                    s, t = (px * ey - py * ex) / det, (py * dx - px * dy) / det
                    if not (0 <= s <= 1 and 0 <= t <= 1):
                        continue
                    distance = a[2] + s * dz + t * ez
                    pixel = iy * size + ix
                    if distance <= depth[pixel]:
                        continue
                    depth[pixel] = distance
                    rgb = texels[int(u + s * width), int(v + t * height)]
                    pixels[ix, iy] = (*(min(255, round(channel * shade)) for channel in rgb), 255)

    return icon.resize((64, 64), Image.Resampling.LANCZOS)


def to_bedrock(p):
    opposite = {"east": "west", "west": "east"}
    faces = {
        opposite.get(face, face): (u + width, v, -width, height)
        for face, (u, v, width, height) in p.faces.items()
    }
    return Part(p.name, (-p.end[0], *p.start[1:]), (-p.start[0], *p.end[1:]),
                faces, p.bone, (-p.pivot[0], *p.pivot[1:]))


def cut_case(pieces, center):
    """Clip the fully mapped case to a cell, keeping the exterior UV subrectangles."""
    clipped = []
    for p in pieces:
        if p.bone != "case":
            continue
        lo, hi = max(center - 8, p.start[0]), min(center + 8, p.end[0])
        if hi <= lo:
            continue
        faces = {}
        original_width = p.end[0] - p.start[0]
        a, b = (lo - p.start[0]) / original_width, (hi - p.start[0]) / original_width
        for face, (u, v, width, height) in p.faces.items():
            if (face == "west" and hi < p.end[0]) or (face == "east" and lo > p.start[0]):
                continue
            if face in FACE_X_DIRECTION:
                start = a if FACE_X_DIRECTION[face] == 1 else 1 - b
                u, width = u + width * start, width * (b - a)
            faces[face] = (u, v, width, height)
        clipped.append(Part(p.name, (lo - center, *p.start[1:]), (hi - center, *p.end[1:]), faces, p.bone))
    return clipped


def rounded(values):
    return [round(v, 5) for v in values]


def cube(p):
    return {"origin": rounded(p.start),
            "size": rounded([b - a for a, b in zip(p.start, p.end)]),
            "uv": {face: {"uv": rounded(rect[:2]), "uv_size": rounded(rect[2:])}
                   for face, rect in p.faces.items()}}


def geometry(identifier, pieces, *, item=False, block=False):
    root = {"name": "piano", "pivot": [0, 0, 0]}
    bones = [root]
    if item:
        root["binding"] = "q.item_slot_to_bone_name(context.item_slot)"
        root["cubes"] = [cube(p) for p in pieces if p.bone != "playback_light"]
    else:
        by_bone = defaultdict(list)
        for p in pieces:
            by_bone[p.bone].append(p)
        for name, group in by_bone.items():
            bones.append({"name": name, "parent": "piano", "pivot": rounded(group[0].pivot),
                          "cubes": [cube(p) for p in group]})
    return {"format_version": "1.26.10" if block else "1.16.0", "minecraft:geometry": [{
        "description": {"identifier": f"geometry.{identifier}", "texture_width": SIZE, "texture_height": SIZE,
                        "visible_bounds_width": 3, "visible_bounds_height": 2, "visible_bounds_offset": [0, .5, 0]},
        "bones": bones,
    }]}


def project(pieces, image):
    """Editable Blockbench copy, with the atlas embedded and bone pivots preserved."""
    def uid(name):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, "xypiano/FP88/" + name))

    elements, children, groups = [], defaultdict(list), []
    for p in pieces:
        name = uid(p.name)
        children[p.bone].append(name)
        faces = {}
        for face, (u, v, w, h) in p.faces.items():
            uv = [u + w, v + h, u, v] if face in ("up", "down") else [u, v, u + w, v + h]
            faces[face] = {"uv": rounded(uv), "texture": 0}
        elements.append({"name": p.name, "type": "cube", "uuid": name, "box_uv": False,
                         "from": rounded([-p.end[0], *p.start[1:]]), "to": rounded([-p.start[0], *p.end[1:]]),
                         "origin": rounded([-p.pivot[0], *p.pivot[1:]]), "faces": faces, "autouv": 0})
    outliner = []
    for name, group in children.items():
        pivot = next(p.pivot for p in pieces if p.bone == name)
        groups.append({"name": name, "uuid": uid(name + "_bone"),
                       "origin": rounded([-pivot[0], *pivot[1:]]), "rotation": [0, 0, 0]})
        outliner.append({"uuid": uid(name + "_bone"), "isOpen": False, "children": group})
    image_bytes = BytesIO()
    image.save(image_bytes, "PNG")
    return {
        "meta": {"format_version": "5.0", "model_format": "bedrock", "box_uv": False},
        "name": "P-88 Digital Piano", "model_identifier": "piano_full", "visible_box": [3, 2, .5],
        "resolution": {"width": SIZE, "height": SIZE}, "elements": elements, "groups": groups,
        "outliner": outliner, "textures": [{
            "id": "0", "uuid": uid("atlas"), "name": "piano.png", "relative_path": "../../textures/blocks/piano.png",
            "width": SIZE, "height": SIZE, "uv_width": SIZE, "uv_height": SIZE,
            "source": "data:image/png;base64," + base64.b64encode(image_bytes.getvalue()).decode("ascii"),
        }],
    }


def sync_property(high):
    return {"type": "int", "range": [1, high], "default": 1, "client_sync": True}


def display_assets():
    mask_base = 2**KEYS_PER_MASK
    groups = range(len(PITCHES) // KEYS_PER_MASK)
    properties = {f"xypiano:keys_{i}": sync_property(mask_base**2) for i in groups}
    properties["xypiano:playback_light"] = sync_property(2)
    write(BP / "entities/piano_display.json", {"format_version": "1.21.100", "minecraft:entity": {
        "description": {"identifier": DISPLAY, "is_spawnable": False, "is_summonable": True, "properties": properties},
        "components": {
            "minecraft:collision_box": {"width": 0, "height": 0},
            "minecraft:physics": {"has_gravity": False, "has_collision": False},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
            "minecraft:fire_immune": {}, "minecraft:persistent": {},
        },
    }})
    reads = [
        f"t.mask=q.property('xypiano:keys_{i}')-1;"
        f"v.keys_{i}=math.mod(t.mask,{mask_base});"
        f"v.strikes_{i}=math.floor(t.mask/{mask_base});"
        for i in groups
    ]
    key_sum = "+".join(f"v.keys_{i}" for i in groups)
    write(RP / "entity/piano_display.entity.json", {"format_version": "1.10.0", "minecraft:client_entity": {
        "description": {"identifier": DISPLAY, "materials": {"default": "entity_alphatest"},
                        "textures": {"default": "textures/blocks/piano"},
                        "geometry": {"default": "geometry.piano_display"},
                        "animations": {"keys": "animation.xypiano.piano_display",
                                       "lamp": "animation.xypiano.playback_light"},
                        "scripts": {
                            "initialize": ["v.key_tail=0;"] + [
                                "".join(f"v.key_{midi}=0;v.strike_{midi}=0;v.lift_{midi}=0;"
                                        for midi in PITCHES[i*KEYS_PER_MASK:(i+1)*KEYS_PER_MASK])
                                for i in groups
                            ],
                            "pre_animation": reads + [
                                f"v.key_down=({key_sum})>0;",
                                "v.key_animate=v.key_down||v.key_tail>0;",
                                "v.key_dt=math.max(0,q.delta_time);",
                                f"v.key_tail=v.key_down?{KEY_RELEASE_SECONDS}:math.max(0,v.key_tail-v.key_dt);",
                                f"v.key_release_step=v.key_dt/{KEY_RELEASE_SECONDS};",
                            ],
                            "animate": [{"keys": "v.key_animate"}, "lamp"],
                        },
                        "render_controllers": ["controller.render.default"]},
    }})
    bones = {}
    for midi in PITCHES:
        mask, bit = divmod(midi - 21, KEYS_PER_MASK)
        weight = 2**bit
        value = f"v.key_{midi}"
        strike = f"v.strike_{midi}"
        lift = f"v.lift_{midi}"
        motion = (
            f"t.down=math.mod(v.keys_{mask},{2*weight})>={weight};"
            f"t.strike=math.mod(v.strikes_{mask},{2*weight})>={weight};"
            f"{lift}=!t.down?0:((t.strike!={strike}&&{value}>0)?{KEY_RESTRIKE_LIFT_SECONDS}:{lift});"
            f"{strike}=t.strike;"
            f"t.lift_dt=math.min(v.key_dt,{lift});"
            f"{lift}={lift}-t.lift_dt;"
            f"t.depth=math.max(0,{value}-t.lift_dt/{KEY_RESTRIKE_LIFT_SECONDS});"
            f"t.step=t.down?(v.key_dt-t.lift_dt)/{KEY_PRESS_SECONDS}:-v.key_release_step;"
            f"{value}=math.clamp(t.depth+t.step,0,1);return {value}*{KEY_PRESS_DEGREES};"
        )
        bones[f"key_{midi}"] = {"rotation": [motion, 0, 0]}
    write(RP / "animations/piano_display.animation.json", {"format_version": "1.8.0",
          "animations": {
              "animation.xypiano.piano_display": {"loop": True, "bones": bones},
              "animation.xypiano.playback_light": {"loop": True, "bones": {
                  "playback_light": {"scale": "q.property('xypiano:playback_light')==2?1:0"}
              }},
          }})


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_hitboxes():
    path = ADDON / "src/piano/hitboxes.generated.ts"
    key_parts = [p for p in parts if p.bone.startswith("key_")]
    keys = [(int(p.bone.split("_")[1]), *rounded(p.start), *rounded(p.end), *rounded(p.pivot[1:]))
            for p in key_parts]
    case = [(*rounded(p.start), *rounded(p.end)) for p in parts if p.bone == "case"]
    def button_hitbox(name):
        button = next(p for p in parts if p.name == name)
        x, y, z = button.start
        X, Y, Z = button.end
        return rounded([x - .16, y, z - .12, X + .16, Y, Z + .12])

    screen = next(p for p in parts if p.bone == "lcd")
    x, _, z = screen.start
    X, Y, Z = screen.end
    # Calibrate between the observed high (0.38) and low (0.0625) positions.
    screen_pose = {"center": rounded([(x + X) / 2, Y + .22, (z + Z) / 2]),
                   "width": round(X - x, 5), "height": round(Z - z, 5)}
    particle_line = {"y": round(Y + .6, 5), "z": screen_pose["center"][2]}
    keyboard = [min(row[axis] for row in keys) for axis in range(1, 4)]
    keyboard += [max(row[axis] for row in keys) for axis in range(4, 7)]
    angle = math.radians(-KEY_PRESS_DEGREES)
    for p in key_parts:
        _, py, pz = p.pivot
        for y in (p.start[1], p.end[1]):
            for z in (p.start[2], p.end[2]):
                yy = py + math.cos(angle) * (y-py) - math.sin(angle) * (z-pz)
                zz = pz + math.sin(angle) * (y-py) + math.cos(angle) * (z-pz)
                keyboard[1] = min(keyboard[1], yy)
                keyboard[2] = min(keyboard[2], zz)
                keyboard[4] = max(keyboard[4], yy)
                keyboard[5] = max(keyboard[5], zz)
    keyboard = [math.floor(x * 1e5)/1e5 if i < 3 else math.ceil(x * 1e5)/1e5 for i,x in enumerate(keyboard)]
    path.write_text(
        "// Generated by tools/model-piano.py in design coordinates.\n"
        f"export const KEY_PRESS_DEGREES = {KEY_PRESS_DEGREES};\n"
        f"export const KEYBOARD_HITBOX = {keyboard} as const;\n\n"
        f"export const MENU_HITBOX = {button_hitbox('menu button')} as const;\n"
        f"export const MIDI_MENU_HITBOX = {button_hitbox('MIDI button')} as const;\n"
        f"export const SETTINGS_HITBOX = {button_hitbox('settings button')} as const;\n"
        f"export const PIANO_SCREEN = {json.dumps(screen_pose)} as const;\n\n"
        f"export const PIANO_PARTICLE_LINE = {json.dumps(particle_line)} as const;\n\n"
        "export const KEY_HITBOXES = [\n"
        + "".join(f"    {list(row)},\n" for row in keys)
        + "] as const;\n\nexport const CASE_HITBOXES = [\n"
        + "".join(f"    {list(row)},\n" for row in case)
        + "] as const;\n", encoding="utf-8",
    )


def main():
    author_piano()
    write_hitboxes()
    image = atlas()
    image.save(RP / "textures/blocks/piano.png")
    inventory_icon(image).save(RP / "textures/items/piano_item.png")
    native = [to_bedrock(p) for p in parts]
    write(RP / "models/blocks/piano_full.bbmodel", project(native, image))
    for name, center in (("left", -8), ("right", 8)):
        identifier = f"piano_{name}"
        write(RP / f"models/blocks/{identifier}.geo.json", geometry(identifier, cut_case(native, center), block=True))
    write(RP / "models/blocks/piano.geo.json", geometry("piano_item", native, item=True))
    write(RP / "models/entity/piano_display.geo.json",
          geometry("piano_display", [p for p in native if p.bone != "case"]))
    display_assets()


if __name__ == "__main__":
    main()
