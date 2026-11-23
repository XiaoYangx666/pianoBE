"""Build the Bedrock stage vase geometry and wraparound underglaze textures."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


RP = Path(__file__).resolve().parents[2] / "packages/addon/rp"
SIZE = 1024
BODY_UV_HEIGHT = 960
SIDES = 24
HEIGHT = 56.8
PROFILE = [
    (0.0, 7.7), (.016, 8.5), (.045, 8.6), (.068, 9.05), (.105, 9.65),
    (.155, 10.2), (.22, 11.05), (.29, 12.0), (.36, 13.1), (.43, 14.25),
    (.50, 15.4), (.57, 16.6), (.63, 17.7), (.68, 18.43), (.725, 18.72),
    (.76, 18.65), (.79, 18.12), (.82, 17.12), (.845, 15.8), (.87, 13.9),
    (.89, 11.52), (.907, 9.0), (.925, 6.55), (.944, 5.7), (.965, 5.55),
    (.98, 5.64), (.989, 6.53), (1.0, 6.6),
]


def model():
    faces = []
    uv_width = SIZE / SIDES
    for side in range(SIDES):
        azimuth = side * 360 / SIDES
        cubes = []
        for (start, lower), (end, upper) in zip(PROFILE, PROFILE[1:]):
            span = (end - start) * HEIGHT
            slant = math.degrees(math.atan2(upper - lower, span))
            length = math.hypot(span, upper - lower)
            radius = (lower + upper) / 2
            y = (start + end) / 2 * HEIGHT
            half_width = max(lower, upper) * math.tan(math.pi / SIDES) + .012
            thickness = .37 if end < .989 else .82
            cubes.append({
                "origin": [round(-half_width, 4), round(y - length / 2, 4), round(radius - thickness, 4)],
                "size": [round(2 * half_width, 4), round(length + .025, 4), thickness],
                "pivot": [0, round(y, 4), round(radius, 4)],
                "rotation": [round(slant, 4), 0, 0],
                "uv": {
                    "south": {"uv": [round(side * uv_width, 4), round((1 - end) * BODY_UV_HEIGHT, 4)],
                              "uv_size": [round(uv_width, 4), round((end - start) * BODY_UV_HEIGHT, 4)]},
                    **({"north": {"uv": [4, 966], "uv_size": [16, 16]}} if end > .92 else {}),
                    **({"up": {"uv": [28, 966], "uv_size": [16, 16]}} if end == 1 else {}),
                },
            })
        faces.append({
            "name": f"panel_{side}", "parent": "vase", "pivot": [0, 0, 0],
            "rotation": [0, round(azimuth, 4), 0], "cubes": cubes,
        })
    # Short inner well prevents the top view from seeing straight through the neck.
    faces.append({
        "name": "mouth_well", "parent": "vase", "pivot": [0, 0, 0],
        "cubes": [{"origin": [-5.4, 50.1, -5.4], "size": [10.8, .18, 10.8],
                   "uv": {"up": {"uv": [4, 966], "uv_size": [16, 16]}}}],
    })
    description = {
        "identifier": "geometry.pbe.vfx_porcelain_vase", "texture_width": SIZE, "texture_height": SIZE,
        "visible_bounds_width": 6, "visible_bounds_height": 8, "visible_bounds_offset": [0, 3, 0],
    }
    geometry = {"description": description, "bones": [{"name": "vase", "pivot": [0, 0, 0]}, *faces]}
    target = RP / "models/entity/vfx_porcelain_vase.geo.json"
    target.write_text(json.dumps({"format_version": "1.16.0", "minecraft:geometry": [geometry]}, separators=(",", ":")) + "\n")


def petal(draw, x, y, angle, length, width, color):
    path = []
    for side in (1, -1):
        for i in (range(31) if side == 1 else range(30, -1, -1)):
            u = i / 30
            narrow = math.sin(math.pi * u) ** .92 * width * side
            path.append((x + math.cos(angle) * length * u - math.sin(angle) * narrow,
                         y + math.sin(angle) * length * u + math.cos(angle) * narrow))
    draw.polygon(path, fill=color)
    draw.line(path + path[:1], fill=242, width=3, joint="curve")
    draw.line((x, y, x + math.cos(angle) * length * .74, y + math.sin(angle) * length * .74), fill=196, width=2)


def ornament():
    ink = Image.new("L", (SIZE, SIZE))
    draw = ImageDraw.Draw(ink)
    for y, width in [(14, 8), (40, 3), (100, 4), (162, 6), (178, 3), (757, 4), (780, 8), (884, 4), (928, 7)]:
        draw.line((0, y, SIZE, y), fill=230, width=width)

    for i in range(-1, 17):
        x = i * 64
        # Repeating ruyi heads on the shoulder and upright lotus lappets at the foot.
        arc = [(x + t, 121 + 28 * math.sin(math.pi * t / 64) ** 1.5) for t in range(65)]
        draw.line(arc, fill=234, width=5)
        draw.line([(u, v - 8) for u, v in arc], fill=155, width=2)
        petal(draw, x + 32, 864, -math.pi / 2, 69, 22, 173)
        draw.ellipse((x + 28, 852, x + 36, 860), fill=244)

    def stem(x):
        return 486 + 65 * math.sin(x * 2 * math.pi / 256)

    for delta, shade, width in [(0, 238, 9), (178, 182, 5)]:
        draw.line([(x, stem(x) + delta) for x in range(SIZE + 1)], fill=shade, width=width)
    for i in range(-1, 9):
        x = 53 + i * 128
        y = stem(x)
        direction = -1 if i % 2 == 0 else 1
        center = y + direction * 69
        draw.arc((x - 25, min(y, center) - 12, x + 39, max(y, center) + 19),
                 90 if direction < 0 else 230, 260 if direction < 0 else 345, fill=236, width=5)
        for j in range(-2, 3):
            angle = direction * math.pi / 2 + j * .42
            petal(draw, x + 3, center, angle, 73 - abs(j) * 11, 16 - abs(j) * 1.8, 120 + 15 * abs(j))
        draw.ellipse((x - 8, center - 7, x + 14, center + 8), fill=245)
        petal(draw, x - 22, y, -2.4 if direction < 0 else 2.4, 58, 12, 166)
        petal(draw, x + 18, y + 172, -.54, 72, 17, 145)

    draw.rectangle((0, 962, 22, 990), fill=190)
    draw.rectangle((24, 962, 47, 990), fill=95)
    return ink


def textures():
    ink = ornament()
    bleed = ink.filter(ImageFilter.GaussianBlur(2))
    color = Image.new("RGB", ink.size)
    mer = Image.new("RGB", ink.size)
    height = Image.new("L", ink.size)
    for y in range(SIZE):
        for x in range(SIZE):
            pigment = min(1, (ink.getpixel((x, y)) * .86 + bleed.getpixel((x, y)) * .19) / 255)
            variation = math.sin(x * .041 + y * .02) * 1.7 + math.sin(x * .39 - y * .17) * .7
            ivory = (237, 242, 228)
            cobalt = (22, 57, 122)
            color.putpixel((x, y), tuple(round(a * (1 - pigment) + b * pigment + variation) for a, b in zip(ivory, cobalt)))
            mer.putpixel((x, y), (0, round(8 * (1 - pigment) ** 2), round(42 + pigment * 25 + variation)))
            height.putpixel((x, y), round(128 + variation * .68 - pigment * 1.5))

    target = RP / "textures/entity"
    for image, suffix in [(color, ""), (mer, "_mer"), (height, "_height")]:
        image.save(target / f"pbe_vfx_porcelain{suffix}.png", optimize=True)


if __name__ == "__main__":
    model()
    textures()
