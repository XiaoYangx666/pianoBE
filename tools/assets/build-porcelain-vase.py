"""Build the Bedrock stage vase geometry and wraparound underglaze textures.

The vase is a fake lathe: a ring of flat panels, each split along the profile.
Because Bedrock shades these cubes per face, the panel count is what makes the
glaze read as round, so the geometry keeps its authored density and only the
numeric precision is trimmed.

The textures are the heavy part, so they are authored at 1024 (the ornament
coordinates below are tuned for that canvas), downscaled to ``SIZE``, and saved
as indexed PNG. The heightmap is gone: the entity material has no parallax, so
it could never be sampled in game.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


RP = Path(__file__).resolve().parents[2] / "packages/addon/rp"
# Art and UV coordinates are authored against this edge, then scaled to SIZE.
AUTHORED = 1024
SIZE = 512
UV_SCALE = SIZE / AUTHORED
BODY_UV_HEIGHT = round(960 * UV_SCALE)
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
    uv_width = round(SIZE / SIDES, 2)
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
                "origin": [round(-half_width, 3), round(y - length / 2, 3), round(radius - thickness, 3)],
                "size": [round(2 * half_width, 3), round(length + .025, 3), round(thickness, 3)],
                "pivot": [0, round(y, 3), round(radius, 3)],
                "rotation": [round(slant, 3), 0, 0],
                "uv": {
                    "south": {"uv": [round(side * uv_width, 2), round((1 - end) * BODY_UV_HEIGHT, 2)],
                              "uv_size": [uv_width, round((end - start) * BODY_UV_HEIGHT, 2)]},
                    **({"north": {"uv": [round(4 * UV_SCALE, 2), round(966 * UV_SCALE, 2)],
                                  "uv_size": [round(16 * UV_SCALE, 2), round(16 * UV_SCALE, 2)]}} if end > .92 else {}),
                    **({"up": {"uv": [round(28 * UV_SCALE, 2), round(966 * UV_SCALE, 2)],
                               "uv_size": [round(16 * UV_SCALE, 2), round(16 * UV_SCALE, 2)]}} if end == 1 else {}),
                },
            })
        faces.append({
            "name": f"panel_{side}", "parent": "vase", "pivot": [0, 0, 0],
            "rotation": [0, round(azimuth, 3), 0], "cubes": cubes,
        })
    # Short inner well prevents the top view from seeing straight through the neck.
    faces.append({
        "name": "mouth_well", "parent": "vase", "pivot": [0, 0, 0],
        "cubes": [{"origin": [-5.4, 50.1, -5.4], "size": [10.8, .18, 10.8],
                   "uv": {"up": {"uv": [round(4 * UV_SCALE, 2), round(966 * UV_SCALE, 2)],
                                 "uv_size": [round(16 * UV_SCALE, 2), round(16 * UV_SCALE, 2)]}}}],
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
    ink = Image.new("L", (AUTHORED, AUTHORED))
    draw = ImageDraw.Draw(ink)
    for y, width in [(14, 8), (40, 3), (100, 4), (162, 6), (178, 3), (757, 4), (780, 8), (884, 4), (928, 7)]:
        draw.line((0, y, AUTHORED, y), fill=230, width=width)

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
        draw.line([(x, stem(x) + delta) for x in range(AUTHORED + 1)], fill=shade, width=width)
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
    if SIZE != AUTHORED:
        ink = ink.resize((SIZE, SIZE), Image.LANCZOS)
        bleed = bleed.resize((SIZE, SIZE), Image.LANCZOS)
    color = Image.new("RGB", ink.size)
    mer = Image.new("RGB", ink.size)
    # Pattern frequencies stay in authored pixels so the downscale cannot shift them.
    step = AUTHORED / SIZE
    for y in range(SIZE):
        for x in range(SIZE):
            pigment = min(1, (ink.getpixel((x, y)) * .86 + bleed.getpixel((x, y)) * .19) / 255)
            u, v = x * step, y * step
            variation = math.sin(u * .041 + v * .02) * 1.7 + math.sin(u * .39 - v * .17) * .7
            ivory = (237, 242, 228)
            cobalt = (22, 57, 122)
            color.putpixel((x, y), tuple(round(a * (1 - pigment) + b * pigment + variation) for a, b in zip(ivory, cobalt)))
            # Metalness stays 0; emissive and roughness only carry the ink mask.
            # No grain here: sub-2/255 roughness noise is invisible in game but
            # makes the map uncompressible (40 KB vs 6 KB), so it stays in color only.
            mer.putpixel((x, y), (0, round(8 * (1 - pigment) ** 2), round(42 + pigment * 25)))

    target = RP / "textures/entity"
    color.quantize(colors=256, dither=Image.FLOYDSTEINBERG).save(target / "pbe_vfx_porcelain.png", optimize=True)
    mer.quantize(colors=64, dither=Image.NONE).save(target / "pbe_vfx_porcelain_mer.png", optimize=True)
    stale = target / "pbe_vfx_porcelain_height.png"
    if stale.exists():
        stale.unlink()
    (target / "pbe_vfx_porcelain.texture_set.json").write_text(json.dumps({
        "format_version": "1.21.30",
        "minecraft:texture_set": {
            "color": "pbe_vfx_porcelain",
            "metalness_emissive_roughness": "pbe_vfx_porcelain_mer",
        },
    }, indent=4) + "\n")


if __name__ == "__main__":
    model()
    textures()
