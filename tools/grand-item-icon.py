"""Render the grand piano inventory icon from the authored model."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/grand/grand_full.bbmodel"
OUT = ROOT / "packages/addon/rp/textures/items/grand_piano_item.png"
CANVAS = 1024
SIZE = 64

PALETTE = {
    "body": (24, 28, 35),
    "body_hi": (35, 40, 49),
    "edge": (64, 72, 84),
    "keys": (232, 227, 214),
    "black": (31, 34, 41),
    "brass": (177, 132, 62),
    "felt": (122, 33, 43),
}


def colour(element):
    name = element["name"]
    if "black keys" in name.lower():
        return PALETTE["black"]
    if "white keys" in name.lower():
        return PALETTE["keys"]
    if "cast plate" in name or "string" in name.lower():
        return PALETTE["brass"]
    if "music desk" in name:
        return PALETTE["body_hi"]
    if "pedal" in name.lower() and "brass" not in name.lower():
        return PALETTE["brass"]
    if "brass" in name.lower() or "gold" in name.lower():
        return PALETTE["brass"]
    if "felt" in name.lower():
        return PALETTE["felt"]
    if "curved case" in name or "raised lid" in name or "lid hardware" in name:
        return PALETTE["body"]
    return PALETTE["body_hi"]


def shade(colour, factor):
    return tuple(min(255, round(c * factor)) for c in colour)


model = json.loads(SOURCE.read_text(encoding="utf-8"))
elements = model["elements"]

# Front-left three-quarter view: the keyboard faces the viewer.
view = (0.26, 0.20, -0.945)
vl = math.sqrt(sum(v * v for v in view))
view = tuple(v / vl for v in view)
up0 = (0.0, 1.0, 0.0)
right = (
    view[1] * up0[2] - view[2] * up0[1],
    view[2] * up0[0] - view[0] * up0[2],
    view[0] * up0[1] - view[1] * up0[0],
)
rl = math.sqrt(sum(v * v for v in right))
right = tuple(v / rl for v in right)
up = (
    right[1] * view[2] - right[2] * view[1],
    right[2] * view[0] - right[0] * view[2],
    right[0] * view[1] - right[1] * view[0],
)

points = []
for e in elements:
    x, y, z = e["from"]
    X, Y, Z = e["to"]
    for px in (x, X):
        for py in (y, Y):
            for pz in (z, Z):
                points.append((px, py, pz))
projected = [(sum(p[i] * right[i] for i in range(3)), sum(p[i] * up[i] for i in range(3))) for p in points]
min_x = min(p[0] for p in projected)
max_x = max(p[0] for p in projected)
min_y = min(p[1] for p in projected)
max_y = max(p[1] for p in projected)
scale = (CANVAS * 0.80) / max(max_x - min_x, max_y - min_y, 1e-6)
offset_x = CANVAS / 2 - (min_x + max_x) / 2 * scale
offset_y = CANVAS / 2 + (min_y + max_y) / 2 * scale


def project(point):
    return (
        offset_x + sum(point[i] * right[i] for i in range(3)) * scale,
        offset_y - sum(point[i] * up[i] for i in range(3)) * scale,
    )


normals = {
    "north": (0, 0, -1), "south": (0, 0, 1),
    "east": (1, 0, 0), "west": (-1, 0, 0),
    "up": (0, 1, 0), "down": (0, -1, 0),
}
shades = {"north": .88, "south": .82, "east": .74, "west": .68, "up": 1.08, "down": .52}

faces = []
for e in elements:
    x, y, z = e["from"]
    X, Y, Z = e["to"]
    vertices = {
        "north": [(x, y, z), (X, y, z), (X, Y, z), (x, Y, z)],
        "south": [(X, y, Z), (x, y, Z), (x, Y, Z), (X, Y, Z)],
        "east": [(X, y, z), (X, y, Z), (X, Y, Z), (X, Y, z)],
        "west": [(x, y, Z), (x, y, z), (x, Y, z), (x, Y, Z)],
        "up": [(x, Y, Z), (X, Y, Z), (X, Y, z), (x, Y, z)],
        "down": [(x, y, z), (X, y, z), (X, y, Z), (x, y, Z)],
    }
    base = colour(e)
    for name, verts in vertices.items():
        normal = normals[name]
        if sum(normal[i] * view[i] for i in range(3)) >= 0:
            continue
        centre = [sum(v[i] for v in verts) / 4 for i in range(3)]
        depth = sum(centre[i] * view[i] for i in range(3))
        faces.append((depth, shade(base, shades[name]), [project(v) for v in verts]))

faces.sort(key=lambda f: f[0])
image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
for _, colour_value, polygon in faces:
    draw.polygon(polygon, fill=(*colour_value, 255))
image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(OUT)
print(OUT)
