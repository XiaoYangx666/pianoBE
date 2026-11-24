"""Bake the Bedrock prop and billboard textures for the Sinner stage."""
import argparse
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugins/sinner"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=4) + "\n", encoding="utf-8")


def save_image(path, width, height, pixel):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (width, height))
    image.putdata([pixel((x + .5) / width, (y + .5) / height)
                   for y in range(height) for x in range(width)])
    image.save(path, optimize=True)


def sword_textures():
    palettes = (
        ((32, 70, 135), (112, 210, 246)),
        ((116, 198, 244), (228, 250, 255)),
        ((18, 108, 211), (118, 231, 255)),
        ((28, 142, 229), (192, 243, 255)),
    )

    def sample(x, y):
        tile = int(x * 2) + 2 * int(y * 2)
        u = (x * 2) % 1
        v = (y * 2) % 1
        ripple = math.sin(12 * u + 9 * v + 1.6 * math.sin(11 * v - 5 * u))
        cross = math.sin(18 * u - 7 * v + 1.2 * math.sin(12 * u + 9 * v))
        light = min(1, .22 + .24 * (.5 + .5 * ripple) + .45 * (.5 + .5 * cross) ** 6)
        return tile, light

    def color(x, y):
        tile, light = sample(x, y)
        shadow, highlight = palettes[tile]
        rgb = [round(a + (b - a) * light) for a, b in zip(shadow, highlight)]
        return (*rgb, 255)

    def mer(x, y):
        tile, light = sample(x, y)
        return (0, round((36 if tile == 0 else 67) + 122 * light), 76 + tile * 7, 255)

    save_image(PLUGIN / "stage_props/sinner_sword.png", 512, 512, color)
    save_image(PLUGIN / "stage_props/sinner_sword_mer.png", 512, 512, mer)


def gaussian(value, center, width):
    return math.exp(-((value - center) / width) ** 2)


def alpha(value):
    return round(255 * max(0, min(value, 1)))


def pool_pixel(u, v):
    x, y = 2 * u - 1, 2 * v - 1
    r = math.hypot(x, y)
    rim = max(0, 1 - r ** 2)
    caustic = (.5 + .5 * math.sin(18 * x + 2.1 * math.sin(9 * y))) ** 10
    rings = .66 * gaussian(r, .53, .20) + .34 * gaussian(r, .72, .1)
    return 255, 249, 242, alpha(.81 * rim ** 2.15 + .095 * rim * caustic * rings)


def cone_pixel(u, v):
    x = 2 * u - 1
    width = .15 + .84 * v
    side = max(0, 1 - (x / width) ** 2) ** 2
    fade = math.sin(math.pi * v) ** .64
    return 255, 251, 244, alpha(.84 * side * fade)


def spot_pool_pixel(u, v):
    radius = math.hypot(2 * u - 1, 2 * v - 1)
    feather = max(0, min(1, (.98 - radius) / .28))
    fade = feather * feather * (3 - 2 * feather)
    return 255, 251, 244, alpha(fade * (1 - .24 * radius))


def spot_beam_pixel(u, v):
    half_width = .06 + .91 * v
    x = (2 * u - 1) / half_width
    feather = max(0, 1 - x * x)
    fade = min(1, v / .12) * min(1, (1 - v) / .10)
    return 255, 252, 245, alpha(fade * feather ** 2 * (.85 - .39 * v))


def bubble_pixel(u, v):
    x, y = 2 * u - 1, 2 * v - 1
    r = math.hypot(x, y)
    edge = gaussian(r, .73, .046)
    halo = gaussian(r, .76, .129) * max(0, min(1, (1 - r) / .08))
    glint = gaussian(x, -.32, .24) * gaussian(y, -.58, .11)
    reflection = gaussian(x, .42, .16) * gaussian(y, .47, .12)
    inner = max(0, 1 - r / .73)
    a = edge * (.52 + .32 * max(0, -y) + .16 * max(0, x)) + halo * .22 + glint * .76 + reflection * .45
    return min(255, 166 + alpha(.22 * edge + .18 * glint)), 221 + alpha(.12 * edge), 255, alpha(a + .045 * inner)


def emissive_particle(name, pixel, strength):
    shared = PLUGIN / "textures/particle"
    texture = f"pbe_{name}"

    def mer(u, v):
        mask = pixel(u, v)[3] / 255
        return (0, round(strength * mask ** .85), 62, 255)

    save_image(shared / f"{texture}_mer.png", 128, 128, mer)
    write_json(shared / f"{texture}.texture_set.json", {
        "format_version": "1.21.30",
        "minecraft:texture_set": {"color": texture, "metalness_emissive_roughness": f"{texture}_mer"},
    })


def particle(name, pixel, mode, material, motion=None):
    shared = PLUGIN / "textures/particle"
    size = 128
    save_image(shared / f"pbe_{name}.png", size, size, pixel)
    life = "(variable.vfx_life ?? 1.08)"
    if motion is None:
        bounds = ["(variable.vfx_width ?? 1)", "(variable.vfx_depth ?? 1)"]
        envelope = "math.clamp(variable.particle_age / 0.32, 0, 1) * math.clamp((variable.particle_lifetime - variable.particle_age) / 0.49, 0, 1)"
    else:
        bounds = ["(variable.vfx_size ?? 0.22)"] * 2
        envelope = "math.clamp(variable.particle_age / 0.43, 0, 1) * math.clamp((variable.particle_lifetime - variable.particle_age) / 0.97, 0, 1)"
    components = {
        "minecraft:emitter_rate_instant": {"num_particles": 1},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {"offset": [0, 0, 0]},
        "minecraft:particle_lifetime_expression": {"max_lifetime": life},
        "minecraft:particle_appearance_billboard": {
            "facing_camera_mode": mode, "size": bounds,
            "uv": {"texture_width": size, "texture_height": size, "uv": [0, 0], "uv_size": [size, size]},
        },
        "minecraft:particle_appearance_tinting": {"color": [
            "(variable.vfx_red ?? 1)", "(variable.vfx_green ?? 1)", "(variable.vfx_blue ?? 1)",
            f"(variable.vfx_opacity ?? 0.7) * {envelope}",
        ]},
    }
    if motion is not None:
        components["minecraft:emitter_local_space"] = {"position": True, "rotation": True}
        components["minecraft:particle_motion_parametric"] = {"relative_position": motion}
    write_json(PLUGIN / f"particles/pbe_vfx_{name}.particle.json", {
        "format_version": "1.10.0",
        "particle_effect": {"description": {"identifier": f"pbe:vfx_{name}",
            "basic_render_parameters": {"material": material, "texture": f"textures/particle/pbe_{name}"}},
            "components": components},
    })


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sword", action="store_true")
    args = parser.parse_args()
    if args.sword:
        sword_textures()
    particle("sinner_pool", pool_pixel, "emitter_transform_xz", "particles_blend")
    particle("sinner_cone", cone_pixel, "lookat_y", "particles_add")
    particle("sinner_spot_pool", spot_pool_pixel, "emitter_transform_xz", "particles_add")
    particle("sinner_spot_beam", spot_beam_pixel, "lookat_y", "particles_add")
    emissive_particle("sinner_spot_pool", spot_pool_pixel, 84)
    emissive_particle("sinner_spot_beam", spot_beam_pixel, 74)
    particle("sinner_bubble", bubble_pixel, "lookat_xyz", "particles_add", [
        "0.18 * (math.sin((variable.vfx_phase ?? 0) + 94 * variable.particle_age) - math.sin(variable.vfx_phase ?? 0))",
        "(variable.vfx_speed ?? 0.7) * variable.particle_age + 0.09 * variable.particle_age * variable.particle_age",
        "0.21 * (math.cos((variable.vfx_phase ?? 0) + 71 * variable.particle_age) - math.cos(variable.vfx_phase ?? 0))",
    ])
    emissive_particle("sinner_bubble", bubble_pixel, 220)
