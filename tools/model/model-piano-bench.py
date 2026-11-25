"""Generate the concert bench block geometry and hand-painted material atlas."""

import json
from math import exp, sin
from pathlib import Path
from runpy import run_path

from PIL import Image, ImageDraw

from icon_export import save_pixel_icon


RP = Path(__file__).resolve().parents[2] / "packages/addon/rp"
BP = RP.with_name("bp")
FACES = ("north", "south", "west", "east", "up", "down")
ATLAS_SIZE = (128, 64)
CUSHION_TOP = 10.5
P88_BENCH_FORWARD = 3
PIANO_BENCH_SIT_FORWARD = 1.75

# Texture tiles: x, y, width, height. The leather top is projected across all
# the top pieces so the embossed seams continue across the clipped corners.
TILES = {
    "leather_top": (1, 1, 64, 40),
    "leather": (1, 45, 48, 12),
    "welt": (53, 45, 12, 10),
    "rim": (69, 1, 24, 12),
    "rail": (69, 17, 24, 12),
    "leg": (97, 1, 24, 28),
    "brass": (69, 35, 24, 12),
    "foot": (97, 35, 24, 12),
    "fabric": (69, 51, 24, 10),
    "steel": (97, 51, 24, 10),
}


def shade(base, brightness):
    return tuple(max(0, min(255, round(channel + brightness))) for channel in base)


def make_atlas():
    image = Image.new("RGB", ATLAS_SIZE)
    for material, (left, top, width, height) in TILES.items():
        # One duplicated pixel around each tile keeps mip sampling off its neighbours.
        for dy in range(-1, height + 1):
            for dx in range(-1, width + 1):
                x, y = min(width - 1, max(0, dx)), min(height - 1, max(0, dy))
                u, v = x / (width - 1), y / (height - 1)
                grain = ((x * 31 + y * 47 + x * y * 7) % 11 - 5) * 0.37
                if material == "leather_top":
                    # Six shallow upholstered buttons with the fold converging on each.
                    base = (49, 44, 44)
                    light = 7 * sin(3.14 * u) + 4 * (1 - v)
                    for bx in (14, 31.5, 49):
                        for by in (11, 28):
                            distance = ((x - bx) ** 2 + (y - by) ** 2) ** 0.5
                            light -= 17 * exp(-distance ** 2 / 10)
                            if distance < 1.2:
                                light += 13 if y < by else 3
                elif material == "leather":
                    base = (48, 42, 41)
                    light = 10 * sin(3.14 * v) - 9 * v
                elif material == "welt":
                    base = (55, 37, 35)
                    light = 13 * sin(3.14 * v)
                elif material == "brass":
                    base = (133, 102, 58)
                    light = 37 * exp(-((u - .3) / .24) ** 2) - 28 * v
                elif material == "foot":
                    base = (32, 26, 25)
                    light = 8 * (1 - v)
                elif material == "fabric":
                    base = (53, 56, 62)
                    light = 5 * (1 - v) + (3 if (x + y) % 2 == 0 else -2)
                elif material == "steel":
                    base = (34, 40, 46)
                    light = 22 * exp(-((u - .24) / .23) ** 2)
                else:
                    base = (34, 32, 38)
                    light = 19 * exp(-((u - .27) / .21) ** 2) + 7 * (1 - v)
                    if material == "rim":
                        light += 11 * (1 - v)
                    elif material == "rail":
                        light -= 5 * v
                image.putpixel((left + dx, top + dy), shade(base, grain + light))
    image.save(RP / "textures/blocks/piano_bench.png")


def make_model():
    bones = {}

    def box(group, low, high, material, top_material=None):
        faces = {}
        for face in FACES:
            tile = top_material if face == "up" and top_material else material
            x, y, w, h = TILES[tile]
            if tile == "leather_top":
                # These bounds are the top cushion's complete width and depth.
                x0, x1 = (low[0] + 7.2) / 14.4, (high[0] + 7.2) / 14.4
                z0, z1 = (low[2] + 4.3) / 8.6, (high[2] + 4.3) / 8.6
                x, y, w, h = x + x0 * w, y + z0 * h, (x1 - x0) * w, (z1 - z0) * h
            faces[face] = {"uv": [round(x, 5), round(y, 5)], "uv_size": [round(w, 5), round(h, 5)]}
        size = [round(b - a, 4) for a, b in zip(low, high)]
        bones.setdefault(group, []).append({"origin": low, "size": size, "uv": faces})

    def clipped_slab(group, width, depth, y0, y1, clip, material, top_material=None):
        x, z = width / 2, depth / 2
        box(group, [-x + clip, y0, -z], [x - clip, y1, z], material, top_material)
        for side in (-1, 1):
            for index in range(2):
                start = x - clip + clip * index / 2
                end = x - clip + clip * (index + 1) / 2
                left, right = sorted((side * start, side * end))
                inset = clip * (index + 1) / 2
                box(group, [round(left, 4), y0, -z + inset],
                    [round(right, 4), y1, z - inset], material, top_material)

    for sx in (-1, 1):
        for sz in (-1, 1):
            for y0, y1, width, material in (
                (0, .25, 1.28, "foot"),
                (.25, .89, 1.23, "brass"),
                (.89, 2.35, 1.15, "leg"),
                (2.35, 4.02, 1.3, "leg"),
                (4.02, 5.85, 1.49, "leg"),
                (5.85, 7.52, 1.75, "leg"),
                (7.52, 8.16, 2.02, "rim"),
            ):
                # The feet flare outward as the legs taper.
                amount = (8.16 - y0) / 8.16
                x, z = sx * (5.98 + .37 * amount), sz * (3.04 + .30 * amount)
                radius = width / 2
                low = [round(x - radius, 4), y0, round(z - radius, 4)]
                high = [round(x + radius, 4), y1, round(z + radius, 4)]
                box("legs", low, high, material)

    for side in (-1, 1):
        z0, z1 = sorted((side * 3.41, side * 3.94))
        box("frame", [-5.35, 6.94, z0], [5.35, 7.98, z1], "rail")
        x0, x1 = sorted((side * 6.25, side * 6.76))
        box("frame", [x0, 6.94, -2.70], [x1, 7.98, 2.70], "rail")
    clipped_slab("frame", 14.6, 8.8, 7.98, 8.38, .5, "rim")
    clipped_slab("frame", 15.45, 9.55, 8.38, 8.97, .53, "rail")
    clipped_slab("upholstery", 15.12, 9.25, 8.97, 9.21, .63, "welt")
    clipped_slab("upholstery", 15.25, 9.45, 9.21, 9.88, .68, "leather")
    clipped_slab("upholstery", 14.85, 9.03, 9.88, 10.24, .63, "leather")
    clipped_slab("upholstery", 14.4, 8.6, 10.24, CUSHION_TOP, .6, "leather", "leather_top")

    geometry = {
        "description": {
            "identifier": "geometry.piano_bench",
            "texture_width": ATLAS_SIZE[0],
            "texture_height": ATLAS_SIZE[1],
            "visible_bounds_width": 2,
            "visible_bounds_height": 2,
            "visible_bounds_offset": [0, .5, 0],
        },
        "bones": [{"name": name, "pivot": [0, 0, 0], "cubes": cubes} for name, cubes in bones.items()],
    }
    output = RP / "models/blocks/piano_bench.geo.json"
    output.write_text(json.dumps({"format_version": "1.12.0", "minecraft:geometry": [geometry]},
                                 separators=(",", ":")) + "\n", encoding="utf-8")


def make_p88_models():
    cutter = run_path(str(Path(__file__).with_name("model-upright.py")))
    cubes = []

    def add(name, low, high, tile):
        faces = {}
        for face in FACES:
            x, y, w, h = TILES[tile]
            faces[face] = {"texture": 0, "uv": [x, y, x + w, y + h]}
        def point(coords):
            x, y, z = coords
            return [x, y, round(z + P88_BENCH_FORWARD, 4)]

        cubes.append({"name": name, "uuid": cutter["uid"]("p88_bench/" + name),
                      "from": point(low), "to": point(high), "faces": faces})

    # Author around the seat midpoint, then shift the complete model toward the keys.
    add("steel frame", [-7.25, 7.95, -4.4], [7.25, 8.65, 4.4], "steel")
    add("fabric sides", [-7.4, 8.65, -4.5], [7.4, 10.06, 4.5], "fabric")
    add("cushion crown", [-7.07, 10.06, -4.17], [7.07, CUSHION_TOP, 4.17], "fabric")
    for side in (-1, 1):
        x = side * 6.16
        add(f"side brace {side}", [x - .41, 2.35, -2.91], [x + .41, 3.03, 2.91], "steel")
        for z in (-2.91, 2.91):
            add(f"leg {side} {z}", [x - .46, .31, z - .46], [x + .46, 7.95, z + .46], "steel")
            add(f"foot {side} {z}", [x - .57, 0, z - .55], [x + .57, .31, z + .55], "foot")

    assert all(-8 <= cube["from"][2] < cube["to"][2] <= 8 for cube in cubes)

    # Hand-held model: the same bench before the block-grid cut, with the seat
    # recentred on the origin so the attachable pivots around the middle.
    held = []
    for cube in cubes:
        piece = json.loads(json.dumps(cube))
        for field in ("from", "to"):
            x, y, z = piece[field]
            piece[field] = [x, y, round(z - P88_BENCH_FORWARD, 4)]
        held.append(piece)
    item_geometry = cutter["native_geometry"]({
        "elements": held, "model_identifier": "p88_bench_item",
        "resolution": dict(zip(("width", "height"), ATLAS_SIZE)),
    })
    # Held models sit away from the entity origin once the pose is applied; a
    # small visible bound culls the whole bench in first person.
    item_geometry["minecraft:geometry"][0]["description"].update({
        "visible_bounds_width": 4, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1, 0],
    })
    # Bind the root bone to the item slot: without it the game draws the model
    # relative to the player entity instead of the hand, which also hides it in
    # first person.
    item_geometry["minecraft:geometry"][0]["bones"][0]["binding"] = "q.item_slot_to_bone_name(context.item_slot)"
    (RP / "models/entity/p88_bench_item.geo.json").write_text(
        json.dumps(item_geometry, separators=(",", ":")) + "\n", encoding="utf-8")

    for half, low_x, high_x in (("left", 0, 16), ("right", -16, 0)):
        identifier = f"p88_bench_{half}"
        center = (low_x + high_x) / 2
        pieces = []
        for cube in cubes:
            piece = cutter["clip"](cube, (low_x, 0, -8), (high_x, 16, 8), identifier)
            if piece:
                for field in ("from", "to"):
                    point = piece[field]
                    piece[field] = [round(point[0] - center, 4), point[1], point[2]]
                pieces.append(piece)
        geo = cutter["native_geometry"]({
            "elements": pieces, "model_identifier": identifier,
            "resolution": dict(zip(("width", "height"), ATLAS_SIZE)),
        })
        target = RP / f"models/blocks/{identifier}.geo.json"
        target.write_text(json.dumps(geo, separators=(",", ":")) + "\n", encoding="utf-8")
        write_p88_block(identifier, center)
    (BP.parent / "src/data/pianoBench.generated.ts").write_text(
        "// Generated by tools/model-piano-bench.py. Distance is in model units.\n"
        f"export const P88_BENCH_FORWARD = {P88_BENCH_FORWARD};\n"
        f"export const PIANO_BENCH_SIT_FORWARD = {PIANO_BENCH_SIT_FORWARD};\n", encoding="utf-8")


def write_p88_block(identifier, center):
    # Raw Bedrock block boxes use the same X reflection as the exported geometry.
    x = .6 if center > 0 else -8
    leg = 1.27 if center > 0 else -2.41
    forward = P88_BENCH_FORWARD
    components = {
        "minecraft:geometry": f"geometry.{identifier}",
        "minecraft:material_instances": {"*": {"texture": "pbe:bench", "render_method": "opaque"}},
        "minecraft:collision_box": [
            {"origin": [x, 7.95, forward - 4.5], "size": [7.4, 2.55, 9]},
            {"origin": [leg, 0, round(forward - 3.46, 4)], "size": [1.14, 7.95, 1.1]},
            {"origin": [leg, 0, round(forward + 2.36, 4)], "size": [1.14, 7.95, 1.1]},
        ],
        "minecraft:selection_box": {"origin": [x, 0, forward - 4.5], "size": [7.4, CUSHION_TOP, 9]},
        "minecraft:destructible_by_mining": {"seconds_to_destroy": .8},
        "minecraft:destructible_by_explosion": {"explosion_resistance": 2},
        "minecraft:loot": "loot_tables/piano.json",
        "minecraft:movable": {"movement_type": "immovable"},
        "minecraft:light_dampening": 0,
        "minecraft:tick": {"interval_range": [80, 120], "looping": True},
        "pbe:piano_bench_seating": {},
        "pbe:p88_bench_recovery": {},
    }
    block = {
        "description": {
            "identifier": f"pbe:{identifier}",
            "menu_category": {"category": "none", "is_hidden_in_commands": True},
            "traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}},
        },
        "components": components,
        "permutations": [
            {"condition": f"q.block_state('minecraft:cardinal_direction') == '{direction}'",
             "components": {"minecraft:transformation": {"rotation": [0, angle, 0]}}}
            for direction, angle in (("west", 90), ("south", 180), ("east", -90))
        ],
    }
    (BP / f"blocks/{identifier}.json").write_text(
        json.dumps({"format_version": "1.26.10", "minecraft:block": block}, indent=4) + "\n", encoding="utf-8")


def close_cracks(image):
    """Fill transparent pixels enclosed by the drawing.

    The facets of the hand-drawn bench share edges, and PIL's rasteriser can
    leave 1px gaps between them. Those gaps sit in the middle of the seat and
    read as holes once the icon is drawn over the slot background; the artwork
    has no intentional see-through areas of its own.
    """
    width, height = image.size
    pixels = image.load()
    enclosed = Image.new("L", image.size, 0)
    mask = enclosed.load()
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] == 0:
                mask[x, y] = 255
    ImageDraw.floodfill(enclosed, (0, 0), 128, thresh=0)

    while True:
        pending = [(x, y) for y in range(height) for x in range(width)
                   if mask[x, y] == 255 and pixels[x, y][3] == 0]
        if not pending:
            return image
        for x, y in pending:
            neighbours = [pixels[x + dx, y + dy]
                          for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                          if 0 <= x + dx < width and 0 <= y + dy < height
                          and pixels[x + dx, y + dy][3] == 255]
            if not neighbours:
                continue
            pixels[x, y] = tuple(sum(c[i] for c in neighbours) // len(neighbours)
                                 for i in range(3)) + (255,)


def make_p88_icon():
    # Hand-painted at 64px, then doubled with the same hard pixels so every
    # inventory icon ships at 128px.
    image = Image.new("RGBA", (64, 64))
    draw = ImageDraw.Draw(image)
    # Seat silhouette first so the dark front and light top never leave a crack
    # between them.
    draw.polygon([(6, 26), (20, 15), (57, 22), (57, 30), (44, 42), (6, 34)], fill=(100, 105, 112))
    for x, y in ((22, 30), (51, 26), (12, 37), (43, 42)):
        draw.polygon([(x, y), (x + 4, y - 1), (x + 4, y + 15), (x + 2, y + 17),
                      (x, y + 17)], fill=(48, 54, 60))
        draw.line([(x, y + 1), (x, y + 15)], fill=(97, 106, 113), width=1)
    draw.polygon([(6, 27), (43, 34), (57, 23), (57, 30), (44, 42), (6, 34)], fill=(41, 47, 53))
    draw.polygon([(6, 26), (20, 15), (57, 22), (43, 34)], fill=(100, 105, 112))
    draw.polygon([(9, 26), (21, 17), (54, 23), (42, 32)], fill=(78, 84, 93))
    draw.line([(7, 29), (43, 36), (56, 26)], fill=(120, 124, 132), width=1)
    save_pixel_icon(close_cracks(image), 128, RP / "textures/items/p88_bench.png")


if __name__ == "__main__":
    make_atlas()
    make_model()
    make_p88_models()
    make_p88_icon()
