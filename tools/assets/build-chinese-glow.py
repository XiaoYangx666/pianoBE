"""Generate the additive stroke and its emissive tile alongside the two matte ink brushes."""

import json
import math
from pathlib import Path

from PIL import Image


PLUGIN = Path(__file__).resolve().parents[2] / "plugins/chinese"
PARTICLES = PLUGIN / "particles"
TEXTURES = PLUGIN / "textures/particle"
BRUSH_SIZE = 64
ATLAS_SIZE = (256, 32)


def smooth(value):
    value = max(0, min(1, value))
    return value * value * (3 - 2 * value)


with Image.open(TEXTURES / "pbe_chinese_ink.png") as current:
    matte = current.convert("RGBA").crop((0, 0, 128, 32))
color = Image.new("RGBA", ATLAS_SIZE, (255, 255, 255, 0))
color.paste(matte, (0, 0))
mer = Image.new("RGB", ATLAS_SIZE, (0, 0, 190))
for y in range(ATLAS_SIZE[1]):
    v = (y + 0.5) / 16 - 1
    for x in range(BRUSH_SIZE):
        u = (x + 0.5) / BRUSH_SIZE
        cap = smooth(u / 0.2) * smooth((1 - u) / 0.2)
        core = math.exp(-((v + 0.02 * math.sin(u * math.tau)) / 0.22) ** 2)
        halo = math.exp(-(v / 0.57) ** 2)
        alpha = cap * (0.72 * core + 0.28 * halo) * smooth((1 - abs(v)) / 0.23)
        px = (128 + x, y)
        color.putpixel(px, (255, 255, 255, round(255 * alpha)))
        mer.putpixel(px, (0, round(255 * cap * (0.75 * core + 0.25 * halo)), 90))

color.save(TEXTURES / "pbe_chinese_ink.png", optimize=True)
mer.save(TEXTURES / "pbe_chinese_ink_mer.png", optimize=True)

glow = json.loads((PARTICLES / "pbe_vfx_chinese_ink.particle.json").read_text(encoding="utf-8"))
effect = glow["particle_effect"]
effect["description"]["identifier"] = "pbe:vfx_chinese_glow"
effect["description"]["basic_render_parameters"]["material"] = "particles_add"
uv = effect["components"]["minecraft:particle_appearance_billboard"]["uv"]
uv["uv"] = [128, 0]
(PARTICLES / "pbe_vfx_chinese_glow.particle.json").write_text(json.dumps(glow, indent=2) + "\n", encoding="utf-8")
