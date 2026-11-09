"""Generate the piano's particle definitions and original RGBA sprite atlas."""

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


RP = Path(__file__).resolve().parents[1] / "packages/addon/rp"
TILE = 64
ATLAS_SIZE = (256, 2 * TILE)
TEXTURE = "textures/particle/piano_fx"
AGE = "math.clamp(variable.particle_age / variable.particle_lifetime, 0, 1)"
TINT = ["variable.piano_red ?? 0.39", "variable.piano_green ?? 0.86",
        "variable.piano_blue ?? 0.95"]


def glowing_sprite(draw_core, radius):
    # Draw larger than the destination tile to preserve thin, antialiased edges.
    mask = Image.new("L", (128, 128))
    draw_core(ImageDraw.Draw(mask))
    halo = mask.filter(ImageFilter.GaussianBlur(radius)).point(lambda value: int(value * .72))
    alpha = ImageChops.lighter(mask, halo).resize((TILE, TILE), Image.Resampling.LANCZOS)
    sprite = Image.new("RGBA", (TILE, TILE), "white")
    sprite.putalpha(alpha)
    return sprite


def draw_note(draw):
    draw.ellipse((23, 74, 49, 94), fill=255)
    draw.ellipse((65, 61, 92, 81), fill=255)
    draw.polygon([(43, 81), (43, 39), (92, 24), (92, 70), (85, 70), (85, 45), (50, 56), (50, 81)], fill=255)


def draw_ring(draw):
    draw.ellipse((18, 18, 110, 110), outline=235, width=4)
    for angle in (24, 114, 204, 294):
        draw.arc((10, 10, 118, 118), angle, angle + 37, fill=158, width=3)


def draw_trail(draw):
    # Bright head over a narrowing, translucent wake. The artwork points up.
    for y in range(20, 121):
        strength = 1 - (y - 20) / 101
        width = max(1, round(17 * strength**1.5))
        draw.line((64 - width, y, 64 + width, y), fill=round(168 * strength**1.55))
        draw.line((63, y, 65, y), fill=round(245 * strength**1.25))
    draw.polygon([(64, 6), (74, 20), (64, 37), (54, 20)], fill=255)


def draw_glimmer(draw):
    for inset in range(12, 38, 2):
        strength = (inset - 10) / 28
        draw.rounded_rectangle((inset, inset, 127 - inset, 127 - inset),
                               radius=8, fill=round(215 * strength**.85))


def draw_bubbles(draw):
    for x, y, radius, brightness in (
        (58, 50, 12, 245), (72, 71, 8, 217), (41, 67, 6, 173),
        (61, 86, 4, 191), (81, 45, 4, 167), (43, 41, 3, 145),
        (88, 62, 3, 160), (50, 96, 2, 119), (34, 78, 2, 115),
    ):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                     outline=brightness, width=max(2, radius // 3))
        draw.ellipse((x - radius, y - radius, x, y), fill=brightness)


def effect(name, tile, *, count, lifetime, active_time, direction, size, tint,
           alpha, facing="lookat_xyz", speed=None, motion=None, spin=None):
    components = {
        "minecraft:emitter_rate_instant": {"num_particles": count},
        "minecraft:emitter_lifetime_once": {"active_time": active_time},
        "minecraft:emitter_shape_point": {"direction": direction},
        "minecraft:particle_lifetime_expression": {"max_lifetime": lifetime},
        "minecraft:particle_appearance_billboard": {
            "size": size,
            "facing_camera_mode": facing,
            "uv": {"texture_width": ATLAS_SIZE[0], "texture_height": ATLAS_SIZE[1],
                   "uv": [tile % 4 * TILE, tile // 4 * TILE], "uv_size": [TILE, TILE]},
        },
        "minecraft:particle_appearance_tinting": {"color": [*tint, alpha]},
    }
    if speed is not None:
        components["minecraft:particle_initial_speed"] = speed
    if motion is not None:
        components["minecraft:particle_motion_dynamic"] = motion
    if spin is not None:
        components["minecraft:particle_initial_spin"] = spin
    return {
        "format_version": "1.10.0",
        "particle_effect": {
            "description": {
                "identifier": f"xypiano:{name}",
                "basic_render_parameters": {"material": "particles_add", "texture": TEXTURE},
            },
            "components": components,
        },
    }


def main():
    atlas = Image.new("RGBA", ATLAS_SIZE)
    for tile, (draw_core, halo) in enumerate(((draw_note, 8), (draw_ring, 5), (draw_trail, 8),
                                              (draw_glimmer, 5), (draw_bubbles, 5))):
        atlas.paste(glowing_sprite(draw_core, halo), (tile % 4 * TILE, tile // 4 * TILE))
    texture = RP / (TEXTURE + ".png")
    texture.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(texture)
    emissive = atlas.getchannel("A").point(lambda value: round(value * .68))
    metalness = Image.new("L", ATLAS_SIZE, 0)
    roughness = Image.new("L", ATLAS_SIZE, 230)
    mer_name = f"{texture.stem}_mer"
    Image.merge("RGB", (metalness, emissive, roughness)).save(texture.with_name(mer_name + ".png"))
    texture_set = {
        "format_version": "1.21.30",
        "minecraft:texture_set": {"color": texture.stem, "metalness_emissive_roughness": mer_name},
    }
    texture.with_suffix(".texture_set.json").write_text(json.dumps(texture_set, indent=2) + "\n", encoding="utf-8")

    effects = [
        effect("neon_note", 0, count=1, lifetime=.48, active_time=.54,
               direction=["math.random(-0.045, 0.045)", 1, "math.random(-0.045, 0.045)"],
               size=[f"0.072 + 0.042 * math.sin(150 * ({AGE}))"] * 2,
               tint=TINT,
               alpha=f"(1 - ({AGE})) * 0.94",
               speed=1.1, motion={"linear_acceleration": [0, .24, 0], "linear_drag_coefficient": 1.0,
                                  "rotation_drag_coefficient": .8},
               spin={"rotation": "math.random(-10, 10)", "rotation_rate": "math.random(-24, 24)"}),
        effect("pulse_ring", 1, count=1, lifetime=.33, active_time=.38, direction=[0, 1, 0],
               size=[f"0.03 + 0.145 * (1 - math.pow(1 - ({AGE}), 2))"] * 2,
               tint=TINT,
               alpha=f"0.9 * (1 - ({AGE}))", facing="emitter_transform_xz",
               speed=.8, motion={"linear_acceleration": [0, .2, 0], "linear_drag_coefficient": 1.1}),
        effect("magic_trail", 2, count=1, lifetime=.62, active_time=.68, direction=[0, 1, 0],
               size=[f"0.08 * (1 - 0.45 * ({AGE}))",
                     f"0.015 + 0.16 * math.sin(140 * ({AGE}))"],
               tint=TINT,
               alpha=f"math.pow(1 - ({AGE}), 0.68)", facing="rotate_y",
               speed=1.35, motion={"linear_acceleration": [0, .16, 0], "linear_drag_coefficient": 1.05}),
        effect("key_glimmer", 3, count=1, lifetime=.16, active_time=.21, direction=[0, 1, 0],
               size=["math.lerp(0.042, 0.014, (variable.piano_key_axis_x ?? 1))",
                     "math.lerp(0.014, 0.042, (variable.piano_key_axis_x ?? 1))"], tint=TINT,
               alpha=f"0.82 * math.pow(1 - ({AGE}), 1.7)", facing="emitter_transform_xz"),
        effect("blue_tears", 4, count=5, lifetime="math.random(0.35, 0.67)", active_time=.72,
               direction=["math.random(-0.10, 0.10)", 1, "math.random(-0.10, 0.10)"],
               size=[f"(0.024 + 0.052 * variable.particle_random_2) * (1 - 0.42 * ({AGE}))"] * 2,
               tint=TINT,
               alpha=f"math.pow(1 - ({AGE}), 0.85) * (0.6 + 0.4 * variable.particle_random_3)",
               speed="math.random(0.9, 2.2)",
               motion={"linear_acceleration": [0, 0.34, 0], "linear_drag_coefficient": 0.95,
                       "rotation_drag_coefficient": 1.1},
               spin={"rotation": "math.random(0, 180)", "rotation_rate": "math.random(-36, 36)"}),
    ]
    directory = RP / "particles"
    directory.mkdir(exist_ok=True)
    for data in effects:
        name = data["particle_effect"]["description"]["identifier"].split(":")[1]
        (directory / f"{name}.particle.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
