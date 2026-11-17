"""Preview the seated MIDI clip against both published keyboards in model units."""

import json
import math
import re
import sys
from itertools import product
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2] / "packages/addon/rp"
VANILLA_RIDING_ARM_PITCH = -36.0


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def boxes(model):
    return [cube for bone in model["minecraft:geometry"][0]["bones"] for cube in bone.get("cubes", [])]


def world_angle(expression):
    if not isinstance(expression, str):
        return expression
    world = expression.rsplit(":", 1)[-1]
    if "press;" in world:
        # Preview the end of the press and compare it with the white-key plane.
        base, stroke = re.search(r"(-?\d+(?:\.\d+)?) \+ (\d+(?:\.\d+)?) \* v\.pbe_\w+_press", world).groups()
        return VANILLA_RIDING_ARM_PITCH + float(base) + float(stroke)
    if "_turn;" in world:
        base, direction, sweep = re.search(r"([+-]?\d+(?:\.\d+)?) ([+-]) (\d+(?:\.\d+)?) \* v\.pbe_\w+_turn", world).groups()
        return float(base) + (-1 if direction == "-" else 1) * float(sweep)
    return float(world)


def arm_points(side, base_z, seat_height, angles, waist_pitch, end_only=False):
    pitch, yaw, _ = map(math.radians, angles)
    yaw = -yaw  # reflect the model's X axis into the assembly space
    points = []
    for x, y, z in product((-1, 3) if side > 0 else (-3, 1),
                           (-10,) if end_only else (-10, 2), (-2, 2)):
        y, z = y * math.cos(pitch) - z * math.sin(pitch), y * math.sin(pitch) + z * math.cos(pitch)
        x, z = x * math.cos(yaw) + z * math.sin(yaw), -x * math.sin(yaw) + z * math.cos(yaw)
        points.append(seated_point((x + side * 5, 10 + y, z), base_z, seat_height, waist_pitch))
    return points


def seated_point(point, base_z, seat_height, waist_pitch):
    x, y, z = point
    c, s = math.cos(waist_pitch), math.sin(waist_pitch)
    scale = .9375
    return scale * x, seat_height + scale * (y * c - z * s), base_z + scale * (y * s + z * c)


def hull(points):
    vertices = sorted(set(points))
    def half(order):
        result = []
        for p in order:
            while len(result) > 1:
                a, b = result[-2:]
                if (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0:
                    break
                result.pop()
            result.append(p)
        return result[:-1]
    return half(vertices) + half(reversed(vertices))


animations = load("animations/piano_midi_performer.animation.json")["animations"]
clip = animations["animation.pbe.performer.midi"]
waist_pitch = math.radians(world_angle(clip["bones"]["waist"]["rotation"][0]))
seat_height = max(c["origin"][1] + c["size"][1] for c in boxes(load("models/blocks/piano_bench.geo.json")))
image = Image.new("RGB", (1120, 740), "#151d29")
draw = ImageDraw.Draw(image)
draw.text((28, 19), "Seated MIDI / model preview   |   Side and top projections, 16 units = 1 block", fill="white")
draw.text((28, 39), "Orange: seated pose   White dot: shoulder pivot", fill="#c6d2df")

for row, (model, seat_z) in enumerate((("piano", -11.25), ("grand", -14.25))):
    for column, (horizontal, vertical) in enumerate(((2, 1), (0, 2))):
        top, left = 66 + row * 332, 20 + column * 550
        draw.rectangle((left, top, left + 530, top + 313), fill="#202b3b")
        draw.text((left + 12, top + 9), f"{'P-88' if model == 'piano' else 'Grand'} / {'side' if column == 0 else 'top'}", fill="white")
        scale = 12
        ox, oy = left + (325 if column == 0 else 265), top + (315 if column == 0 else 97)

        def project(p):
            return (round(ox + p[horizontal] * scale), round(oy - p[vertical] * scale))

        geometry = load(f"models/entity/{model}_display.geo.json")["minecraft:geometry"][0]
        keys = [cube for bone in geometry["bones"] if bone["name"].startswith("key_") for cube in bone["cubes"]]
        white_key = next(bone for bone in geometry["bones"] if bone["name"] == "key_21")
        key_top = max(c["origin"][1] + c["size"][1] for c in white_key["cubes"])
        for cube in keys:
            origin, size = cube["origin"], cube["size"]
            low = -origin[0] - size[0], origin[1], origin[2]
            a = project(low)
            b = project(tuple(x + d for x, d in zip(low, size)))
            draw.rectangle((min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])),
                           fill="#e9dfcf" if size[0] > .35 else "#9ca8b6")
        for side, bone in ((1, "leftarm"), (-1, "rightarm")):
            angles = [world_angle(value) for value in clip["bones"][bone]["rotation"]]
            polygon = hull([project(point) for point in arm_points(side, seat_z, seat_height, angles, waist_pitch)])
            draw.line(polygon + [polygon[0]], fill="#ffad61", width=2)
            if column == 0:
                contact = min(arm_points(side, seat_z, seat_height, angles, waist_pitch, end_only=True), key=lambda p: p[1])
                # The real-client screenshot showed a gap at the nominal
                # contact angle. Allow the calibrated press below the static plane.
                assert -.8 < contact[1] - key_top < .05, (model, bone, contact[1], key_top)
                x, y = project(contact)
                draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill="#ffad61")
            x, y = project(seated_point((side * 5, 10, 0), seat_z, seat_height, waist_pitch))
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill="white")

output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parents[2] / "build/piano-midi-preview.png"
output.parent.mkdir(parents=True, exist_ok=True)
image.save(output)
print(output)
