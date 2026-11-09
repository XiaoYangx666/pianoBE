"""Build a concert grand as one Blockbench model, then cut the saved model."""

import argparse
import base64
from collections import defaultdict
from hashlib import sha256
from io import BytesIO
import json
from math import ceil, sin, sqrt
from pathlib import Path
from random import Random
from runpy import run_path
from uuid import NAMESPACE_URL, uuid5

from PIL import Image, ImageDraw, ImageFont


ASSETS = Path(__file__).resolve().parents[1] / "assets/grand"
FULL = ASSETS / "grand_full.bbmodel"
# Same Blockbench UV/cell conventions as the upright, which follows ddz's cutter.
CELL_TOOLS = run_path(str(Path(__file__).with_name("model-upright.py")))
FACE_PLANES = CELL_TOOLS["FACE_PLANES"]
FACE_AXES = CELL_TOOLS["FACE_AXES"]
rounded = CELL_TOOLS["rounded"]
write = CELL_TOOLS["write"]
SIZE = 512
WIDTH = 78 * 157 / 274
HORIZONTAL_SCALE = (274 / 65 * 16) / 78
KEY_TOP = 21.42
PLAY_HEIGHT = 15.35924  # Match the existing digital piano's white keys.
FRONT = -7.6
TAIL = FRONT + 78
RIM_FRONT = 3.2
RIM_TOP = 28.65
HINGE_X = WIDTH / 2 - .44
# Projection and rise of the open lid in the authoring profile.
LID_SPAN = .70
LID_RISE = .64
CASE_BOTTOM = 22.2
CONTROLS = (
    ("menu", "KEYS", 6.7, (43, 83, 70)),
    ("midi", "MIDI", 0, (45, 71, 110)),
    ("settings", "SET", -6.7, (116, 74, 35)),
)
PALETTE = {
    "ebony": (26, 29, 35),
    "lacquer": (38, 43, 50),
    "edge": (54, 60, 67),
    "shadow": (18, 20, 25),
    "lid": (41, 46, 54),
    "underside": (31, 34, 39),
    "brass": (156, 103, 45),
    "gold": (202, 153, 74),
    "plate": (173, 128, 61),
    "ivory": (235, 230, 215),
    "ivory_side": (201, 190, 169),
    "black_key": (54, 55, 63),
    "felt": (107, 28, 37),
    "badge": (29, 32, 38),
    "paper": (244, 234, 209),
}
TILES = {name: (i % 4 * 64, i // 4 * 32) for i, name in enumerate(PALETTE)}

# Viewed from the bench, positive X is the straight bass side. The other rim
# curves inward before rounding back around the tail. The stations are a
# visual approximation of the reference profile, in model units.
STATIONS = (
    (RIM_FRONT, WIDTH / 2, -WIDTH / 2), (11, WIDTH / 2, -WIDTH / 2),
    (16, 22.3, -21.72), (24, 22.24, -18.75), (32, 22.18, -12.72),
    (41, 22.11, -7.05), (49, 22, -4.42), (55, 21.08, -4.58),
    (60, 19.16, -4.35), (64, 16.65, -3.2), (67, 13.55, -1.12),
    (69, 10.85, 1.8), (70, 8.9, 4.6), (TAIL, 7.0, 7.0),
)


def contour(z, side):
    """Monotone cubic interpolation between stations on one side of the rim."""
    def secant(i):
        a, b = STATIONS[i:i + 2]
        return (b[side] - a[side]) / (b[0] - a[0])

    def slope(i):
        if i == 0 or i == len(STATIONS) - 1:
            return secant(max(0, i - 1))
        a, b = secant(i - 1), secant(i)
        return 2 * a * b / (a + b) if a * b > 0 else 0

    for i, (a, b) in enumerate(zip(STATIONS, STATIONS[1:])):
        if z <= b[0]:
            span = b[0] - a[0]
            t = (max(z, a[0]) - a[0]) / span
            return (1 - t) * a[side] + t * b[side] + t * (1 - t) * (
                (1 - t) * (slope(i) * span - b[side] + a[side])
                + t * (b[side] - a[side] - slope(i + 1) * span))
    return STATIONS[-1][side]


def uid(label):
    return str(uuid5(NAMESPACE_URL, "xypiano/concert-grand/" + label))


def plate_uv(x, z):
    return 260 + (x + 23) * 5.2, 10 + (z - RIM_FRONT) * 7.2


def model_point(point):
    x, y, z = point
    height = y * PLAY_HEIGHT / KEY_TOP if y <= KEY_TOP else PLAY_HEIGHT + (y - KEY_TOP) * HORIZONTAL_SCALE
    return rounded((x * HORIZONTAL_SCALE, height, z * HORIZONTAL_SCALE))


def make_atlas():
    texture = Image.new("RGB", (SIZE, SIZE), PALETTE["shadow"])
    rng = Random(274)
    for material, rgb in PALETTE.items():
        u, v = TILES[material]
        for x in range(64):
            for y in range(32):
                tone = rng.choice((-1, 0, 0, 1))
                if material == "lacquer":
                    tone += 12 * max(0, 1 - abs(y - 8) / 9) - y * .26
                elif material in {"lid", "underside"}:
                    tone += 14 * max(0, 1 - abs(y - 9 - .13 * x) / 11) - y * .28
                elif material in {"brass", "gold", "plate"}:
                    tone += 9 * sin(y * .31) - y * .24
                texture.putpixel((u + x, v + y), tuple(round(c + tone) for c in rgb))

    draw = ImageDraw.Draw(texture)
    u, v = TILES["badge"]
    draw.text((u + 32, v + 15), "NOCTURNE", anchor="mm", fill=(222, 177, 94))
    draw.line((u + 17, v + 22, u + 47, v + 22), fill=(173, 124, 55))
    u, v = TILES["paper"]
    for row in (6, 14, 22):
        for y in range(row, row + 5):
            draw.line((u + 7, v + y, u + 56, v + y), fill=(142, 132, 113))
        for i in range(5):
            x, y = u + 12 + i * 9, v + row + rng.randrange(1, 6)
            draw.ellipse((x, y - 1, x + 2, y + 1), fill=(67, 59, 53))
            draw.line((x + 2, y, x + 2, y - 4), fill=(67, 59, 53))
    font = ImageFont.load_default(size=19)
    for i, (_, label, _, color) in enumerate(CONTROLS):
        u, v = 64 * i, 136
        draw.rectangle((u + 1, v + 1, u + 62, v + 30), fill=color, outline=(231, 187, 109), width=2)
        draw.text((u + 32, v + 16), label, fill=(255, 244, 217), font=font, anchor="mm")

    # Painted mechanical detail is world-projected so the string fan remains
    # aligned across the soundboard strips and across Bedrock cell boundaries.
    for x in range(259, 502):
        for y in range(9, 499):
            tone = round(8 * sin(.84 * x + sin(.046 * y)) + 4 * sin(.12 * x) + rng.randrange(-3, 4))
            texture.putpixel((x, y), (159 + tone, 110 + tone, 60 + tone))

    def line(points, color, width):
        draw.line([plate_uv(*p) for p in points], fill=color, width=width)

    for x in (-18, -8, 2, 12, 19):
        line([(x, 7), (x, 67)], (165, 113, 64), 1)
    line([(-20, 7.8), (20.25, 7.8), (20.25, 12), (-20, 12), (-20, 7.8)], (108, 35, 37), 5)
    line([(-19.8, 14.7), (-12, 25), (-4, 36.4), (6, 43), (13, 49.6), (19, 56.8)], (96, 60, 37), 12)
    line([(-19.8, 15.15), (-12, 25.45), (-4, 36.8), (6, 43.4), (13, 50), (19, 57.2)],
         (194, 148, 80), 3)
    for i in range(73):
        x = -19.4 + i * .535
        z = 15 + (x + 19.4) * .995 + 2.9 * sin(i * .043)
        z = min(z, 59)
        # Move the tail end toward the bass spine as the treble rim recedes.
        end_x = x + (19.1 - x) * .11
        line([(x, 8.9 + .38 * (i % 3)), (end_x, z)], (221, 208, 164), 1)
        u, v = plate_uv(x, 8.8 + .38 * (i % 3))
        draw.ellipse((u - 1, v - 1, u + 1, v + 1), fill=(75, 69, 62))
    line([(19.8, 11.1), (9.3, 64.2)], (104, 48, 34), 9)
    for i in range(22):
        a = 20 - i * .52
        b = 17.5 - i * .96
        line([(a, 10.8 + .18 * i), (b, 66.7 - .78 * i)], (97, 53, 31), 2)
        line([(a - .13, 10.8 + .18 * i), (b - .13, 66.7 - .78 * i)], (219, 155, 77), 1)
    return texture


class Grand:
    def __init__(self):
        self.elements = []
        self.sections = defaultdict(list)

    def box(self, section, name, start, end, material, *, projected=None, **face_materials):
        label = f"{section} / {name}"
        faces = {}
        for face in FACE_PLANES:
            u, v = TILES[face_materials.get(face, material)]
            uv = (u + 1, v + 1, u + 63, v + 31)
            if projected and face in projected:
                uv = projected[face]
            faces[face] = {"uv": rounded(uv), "texture": 0}
        self.elements.append({"name": label, "type": "cube", "uuid": uid(label), "box_uv": False,
                              "from": model_point(start), "to": model_point(end), "origin": [0, 0, 0],
                              "faces": faces, "autouv": 0})
        self.sections[section].append(uid(label))

    def project(self):
        png = BytesIO()
        make_atlas().save(png, format="PNG")
        return {
            "meta": {"format_version": "5.0", "model_format": "bedrock", "box_uv": False},
            "name": "Nocturne Concert Grand", "model_identifier": "grand_full", "visible_box": [7, 4, 1.65],
            "resolution": {"width": SIZE, "height": SIZE},
            "elements": self.elements,
            "groups": [{"name": name, "uuid": uid(f"group/{name}"), "origin": [0, 0, 0],
                        "rotation": [0, 0, 0]} for name in self.sections],
            "outliner": [{"uuid": uid(f"group/{name}"), "isOpen": False, "children": children}
                         for name, children in self.sections.items()],
            "textures": [{"id": "0", "uuid": uid("atlas"), "name": "grand.png",
                          "width": SIZE, "height": SIZE, "uv_width": SIZE, "uv_height": SIZE,
                          "source": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode("ascii")}],
        }


def case(grand):
    box = grand.box
    count = ceil((TAIL - RIM_FRONT) / .57)
    bounds = [RIM_FRONT + (TAIL - RIM_FRONT) * i / count for i in range(count + 1)]

    def strips(z, Z):
        # Keep adjacent walls overlapping even at the tight bend around the tail.
        if max(abs(contour(Z, side) - contour(z, side)) for side in (1, 2)) <= .31:
            yield z, Z
        else:
            mid = (z + Z) / 2
            yield from strips(z, mid)
            yield from strips(mid, Z)

    rows = (row for z, Z in zip(bounds, bounds[1:]) for row in strips(z, Z))
    for i, (z, Z) in enumerate(rows):
        mid = (z + Z) / 2
        left, right = contour(mid, 1), contour(mid, 2)
        inset = min(.2, (left - right) / 4)
        box("Curved case", f"belly {i}", (right + inset, CASE_BOTTOM, z), (left - inset, 23.25, Z), "shadow")
        box("Curved case", f"rim heel {i}", (right, 23.25, z), (left, 24.02, Z), "ebony")
        if left - right > 2.4:
            u, v = plate_uv(right + .84, z)
            U, V = plate_uv(left - .84, Z)
            box("Cast plate and strings", f"plate field {i}", (right + .84, 24.02, z),
                (left - .84, 26.55, Z), "plate", projected={"up": (u, v, U, V)})
            for side, x, X in (("bass", left - 1.25, left - .82), ("treble", right + .82, right + 1.25)):
                box("Cast plate and strings", f"{side} flange {i}", (x, 26.55, z), (X, 26.88, Z),
                    "plate", up="gold")
            walls = (("bass", left - .82, left), ("treble", right, right + .82))
        else:
            walls = (("tail", right, left),)
        for name, x, X in walls:
            box("Curved case", f"{name} wall {i}", (x, 24.02, z), (X, 28.21, Z), "lacquer", up="ebony")
            box("Curved case", f"{name} cap {i}", (x, 28.21, z), (X, RIM_TOP, Z), "edge", up="ebony")

    box("Curved case", "front crossblock", (-WIDTH / 2, 24.02, RIM_FRONT - .45),
        (WIDTH / 2, RIM_TOP, RIM_FRONT), "ebony", up="edge")
    box("Curved case", "pinblock cover", (-21.5, 26.55, RIM_FRONT), (21.5, 27.32, 6.35), "ebony", up="edge")
    for i, z in enumerate((16.2, 26.7, 35.6)):
        # In the real instrument these braces are part of the plate casting.
        x, X = contour(z, 2) + 1.4, contour(z, 1) - 1.4
        box("Cast plate and strings", f"transverse brace {i}", (x, 26.58, z), (X, 27.04, z + .4),
            "brass", up="gold")


def lid(grand):
    box = grand.box
    # The raised lid is a series of thin, overlapping-height solid bands. Its
    # curve is sampled from the same closed outline before tilting.
    samples = [6.52 + (TAIL - 6.52) * i / 1024 for i in range(1025)]
    outline = [(z, contour(z, 2), contour(z, 1)) for z in samples]
    width = WIDTH
    count = ceil(width / .29)
    for i in range(count):
        a, b = (-width / 2 + width * k / count for k in (i, i + 1))
        x = (a + b) / 2
        span = [z for z, right, left in outline if right - .055 <= x <= left + .055]
        if len(span) < 2:
            continue
        z, Z = span[0], span[-1]
        start = HINGE_X + (a - HINGE_X) * LID_SPAN
        end = HINGE_X + (b - HINGE_X) * LID_SPAN
        height = RIM_TOP + .32 + (HINGE_X - x) * LID_RISE
        projected = {}
        for face, material in (("up", "lid"), ("down", "underside")):
            u, v = TILES[material]
            s, t = (1 + 62 * k / count for k in (i, i + 1))
            top, bottom = (1 + 30 * (point - 6.52) / (TAIL - 6.52) for point in (z, Z))
            if face == "down":
                top, bottom = 32 - bottom, 32 - top
            projected[face] = (u + s, v + top, u + t, v + bottom)
        box("Raised lid", f"band {i}", (start, height, z), (end, height + .72, Z), "ebony",
            projected=projected)

    for i, z in enumerate((9.1, 25.2, 41.3)):
        box("Lid hardware", f"hinge {i}", (21.58, 28.37, z), (22.42, 29.1, z + 1.9), "brass")
    z = 34
    x = contour(z, 2) + 1.65
    box("Lid hardware", "prop socket", (x - .58, 26.55, z - .57), (x + .6, 27.36, z + .59), "brass")
    target_x = 0
    top = RIM_TOP + .32 + (HINGE_X - target_x) * LID_RISE / LID_SPAN + .12
    count = ceil((top - 27.25) / .49)
    for i in range(count):
        y = 27.25 + (top - 27.25) * i / count
        Y = 27.25 + (top - 27.25) * (i + 1) / count
        center = x + (target_x - x) * (i + .5) / count
        box("Lid hardware", f"prop {i}", (center - .34, y, z - .33), (center + .34, Y, z + .33),
            "ebony" if 1 < i < count - 2 else "brass", east="edge")


def keyboard(grand):
    box = grand.box
    box("Keyboard", "apron", (-WIDTH / 2, 18.1, FRONT), (WIDTH / 2, 20.3, 4.2), "lacquer")
    box("Keyboard", "apron lip", (-22.05, 18.1, FRONT - .12), (22.05, 18.56, FRONT), "edge")
    box("Keyboard", "action frame", (-20.52, 20.3, -7.45), (20.52, 20.64, 3.0), "shadow")
    box("Keyboard", "fallboard", (-20.61, 20.3, -.26), (20.61, 24.78, 3.2), "lacquer", up="edge")
    box("Keyboard", "folded fallboard cap", (-20.53, 24.78, .36), (20.53, 25.25, 3.2), "ebony", up="lacquer")
    box("Keyboard", "nameplate", (-4.1, 25.18, .35), (4.1, 26.45, .58), "ebony", north="badge")
    box("Keyboard", "red key felt", (-18.57, 20.61, -.39), (18.57, 22.4, -.26), "felt")
    for sign in (-1, 1):
        x, X = sorted((18.57 * sign, WIDTH / 2 * sign))
        box("Keyboard", f"cheek {sign}", (x, 20.3, -7.48), (X, 23.1, 4.2), "lacquer", up="edge")
        box("Keyboard", f"side return {sign}", (x, 23.1, -.42), (X, 24.95, RIM_FRONT - .45), "ebony", up="lacquer")
        box("Keyboard", f"fallboard hinge {sign}", (x + .52, 24.95, .18), (X - .52, 25.15, 1.55), "brass")

    step = 37.14 / 52
    black = {1, 3, 6, 8, 10}
    white = 0
    for note in range(21, 109):
        x = 18.57 - white * step
        if note % 12 in black:
            box("Black keys", f"MIDI {note}", (x - .197, 20.68, -4.84), (x + .197, 22.08, -.39),
                "shadow", up="black_key", north="black_key")
        else:
            box("White keys", f"MIDI {note} front", (x - step + .025, 20.64, -7.38),
                (x - .025, 21.42, -4.89), "ivory_side", up="ivory")
            lo = x - step + (.209 if (note + 1) % 12 in black else .025)
            hi = x - (.209 if (note - 1) % 12 in black else .025)
            box("White keys", f"MIDI {note} back", (lo, 20.64, -4.89), (hi, 21.42, -.39),
                "ivory_side", up="ivory")
            white += 1
    assert white == 52

    for i, (name, _, x, _) in enumerate(CONTROLS):
        u, v = 64 * i, 136
        box("Controls", name, (x - 2.18, 22.66, -1.19), (x + 2.18, 24.68, -.26),
            "gold", projected={"north": (u + 1, v + 1, u + 62, v + 30)})

    box("Music desk", "support foot", (-10, 25.2, 1.1), (10, 27.5, 2.3), "ebony")
    box("Music desk", "music shelf", (-11.1, 27.35, .13), (11.1, 28.03, 2.85), "lacquer", up="edge")
    box("Music desk", "sheet stop", (-10.85, 28.03, .13), (10.85, 28.24, .41), "edge")
    for i in range(18):
        y, Y = (27.98 + k * .315 for k in (i, i + 1))
        z = 1.46 + .145 * i
        half = 10.55 - max(0, i - 14) * .39
        box("Music desk", f"desk band {i}", (-half, y, z), (half, Y, z + .54), "lacquer", up="edge")
        if i in range(1, 17):
            u, v = TILES["paper"]
            v0, v1 = v + 1 + (17 - i) * 30 / 16, v + 1 + (16 - i) * 30 / 16
            for x, X in ((-7.75, -.11), (.11, 7.75)):
                label = "left" if x > 0 else "right"
                box("Music desk", f"{label} score band {i}", (x, y, z - .12), (X, Y, z),
                    "paper", projected={"north": (u + 1, v1, u + 63, v0)})


def undercarriage(grand):
    box = grand.box
    for name, x, z, height in (("bass", 19.05, 1.3, 18.1), ("treble", -19.05, 1.3, 18.1),
                               ("tail", 8.7, 67.1, CASE_BOTTOM)):
        mount_depth = 1.6 if name == "tail" else 2.35
        box("Legs and casters", f"{name} mounting block", (x - 2.66, height - .82, z - mount_depth),
            (x + 2.66, height, z + mount_depth), "shadow")
        for i in range(19):
            y = 2.17 + (height - 2.17 - .82) * i / 19
            Y = 2.17 + (height - 2.17 - .82) * (i + 1) / 19
            radius = 1.02 + 1.26 * (i / 18) ** 1.68
            projected = {}
            for face, material in (("north", "lacquer"), ("south", "lacquer"),
                                   ("east", "ebony"), ("west", "edge")):
                u, v = TILES[material]
                projected[face] = (u + 1, v + 31 - (i + 1) * 30 / 19, u + 63, v + 31 - i * 30 / 19)
            depth = radius * .83 if name == "tail" else radius
            box("Legs and casters", f"{name} tapered leg {i}", (x - radius, y, z - depth),
                (x + radius, Y, z + depth), "lacquer", projected=projected)
        box("Legs and casters", f"{name} caster socket", (x - 1.2, 1.67, z - 1.1),
            (x + 1.2, 2.17, z + 1.1), "gold")
        for side in (-1, 1):
            X = x + side * .67
            for j in range(8):
                y, Y = j * .245, (j + 1) * .245
                length = .20 + .73 * sqrt(max(0, 1 - ((j - 3.5) / 4) ** 2))
                box("Legs and casters", f"{name} wheel {side} {j}", (X - .39, y, z - length),
                    (X + .39, Y, z + length), "brass" if j in (0, 7) else "gold")

    box("Pedal lyre", "upper bracket", (-3.1, 16.75, 3.9), (3.1, CASE_BOTTOM, 6.5), "ebony")
    for sign in (-1, 1):
        for i in range(15):
            y, Y = (1.52 + k * 1.0154 for k in (i, i + 1))
            x = sign * (1.98 + .66 * sin(i * .16))
            box("Pedal lyre", f"column {sign} {i}", (x - .49, y, 4.25), (x + .49, Y, 5.55), "lacquer")
    box("Pedal lyre", "housing", (-3.27, .46, 3.24), (3.27, 2.13, 6.05), "ebony", up="edge")
    box("Pedal lyre", "brass pedal plate", (-2.6, .62, 3.03), (2.6, 1.61, 3.24), "brass")
    for i, x in enumerate((-1.62, 0, 1.62)):
        z = .35 if i == 1 else .65
        box("Pedal lyre", f"pedal stem {i}", (x - .31, .72, z + .88), (x + .31, 1.12, 3.03), "brass")
        box("Pedal lyre", f"pedal tread {i}", (x - .55, .67, z), (x + .55, 1.19, z + .88), "brass", up="gold")


def author():
    grand = Grand()
    case(grand)
    lid(grand)
    keyboard(grand)
    undercarriage(grand)
    return grand.project()


def cut_saved_model():
    raw = FULL.read_bytes()
    source = json.loads(raw)
    elements = source["elements"]
    if any(any(group.get("rotation", ())) for group in source["groups"]):
        raise ValueError("Bake group rotations before cutting.")
    for e in elements:
        if (e["type"] != "cube" or e.get("box_uv") or e.get("inflate") or any(e.get("rotation", ()))
                or any(f.get("rotation") or f["texture"] not in (0, None) for f in e["faces"].values())):
            raise ValueError(f"Expected an axis-aligned per-face UV cube using the shared atlas: {e['name']}")
        if not all(lo <= a < b <= hi for lo, a, b, hi in
                   zip((-24, 0, -8), e["from"], e["to"], (24, 48, 72))):
            raise ValueError(f"Cube is degenerate or outside the 3 × 5 × 3 grid: {e['name']}")

    clip = CELL_TOOLS["clip"]
    cut_project = CELL_TOOLS["cut_project"]
    native_geometry = CELL_TOOLS["native_geometry"]
    atlas_data = source["textures"][0]["source"].split(",", 1)[1]
    (ASSETS / "grand.png").write_bytes(base64.b64decode(atlas_data, validate=True))
    cells, assembled, all_refs = [], defaultdict(list), defaultdict(list)
    for y in range(3):
        for z in range(5):
            for x in range(-1, 2):
                name = f"cell_{y}_{z}_{x + 1}"
                center = (x * 16, y * 16, z * 16)
                low = (center[0] - 8, center[1], center[2] - 8)
                high = (center[0] + 8, center[1] + 16, center[2] + 8)
                pieces, refs = [], {}
                for e in elements:
                    fragment = clip(e, low, high, name)
                    if fragment is None:
                        continue
                    pieces.append(fragment)
                    refs[e["uuid"]] = [fragment["uuid"]]
                    all_refs[e["uuid"]].append(fragment["uuid"])
                    assembled[e["uuid"]].append(fragment)
                if not pieces:
                    continue
                project = cut_project(source, name, pieces, refs, center)
                project["model_identifier"] = "grand_" + name
                geo = native_geometry(project)
                geo["minecraft:geometry"][0]["bones"][0]["name"] = "concert_grand"
                editable, bedrock = f"cut/grand_{name}.bbmodel", f"bedrock/grand_{name}.geo.json"
                write(ASSETS / editable, project)
                write(ASSETS / bedrock, geo)
                cells.append({"offset": [x, y, z], "project": editable, "geometry": bedrock, "cubes": len(pieces)})
    fragments = [p for e in elements for p in assembled[e["uuid"]]]
    rebuilt = cut_project(source, "reassembled", fragments, all_refs)
    rebuilt["model_identifier"] = "grand_reassembled"
    write(ASSETS / "cut/grand_reassembled.bbmodel", rebuilt)
    write(ASSETS / "cut-map.json", {"source": FULL.name, "sha256": sha256(raw).hexdigest(), "cells": cells})
    for field, folder, extension in (("project", "cut", "bbmodel"), ("geometry", "bedrock", "geo.json")):
        kept = {cell[field] for cell in cells}
        for path in (ASSETS / folder).glob(f"grand_cell_*.*"):
            if path.name.endswith(f".{extension}") and path.relative_to(ASSETS).as_posix() not in kept:
                path.unlink()
    print(f"Cut {len(elements)} cubes into {len(fragments)} fragments in {len(cells)} cells.")


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
        cut_saved_model()


if __name__ == "__main__":
    main()
