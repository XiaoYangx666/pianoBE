"""Export inventory icons as crisp pixel art.

The game draws item icons straight over the slot background, so a partially
transparent anti-aliased rim reads as a thin outline around the sprite. Icons
are therefore downsampled with premultiplied alpha (so edge colours stay clean)
and cut to a hard 1-bit silhouette.

Running at 128px keeps the silhouette detail while still fitting the slot, and
the transparent margin is bled with the neighbouring colour so any filtering the
game applies while drawing cannot pull black into the edge.
"""

import numpy as np
from PIL import Image

# Coverage a sample needs before it survives the silhouette cut. Half-covered
# pixels keep 1px lines alive after an integer downsample.
COVERAGE = .45
# How far the edge colour is smeared into the transparent margin.
BLEED = 2


def _bleed_colour(rgba):
    """Copy edge colours outwards so filtered sampling never hits black."""
    rgb = rgba[..., :3].astype(np.float32)
    solid = rgba[..., 3] > 0
    for _ in range(BLEED):
        transparent = ~solid
        if not transparent.any():
            break
        total = np.zeros_like(rgb)
        count = np.zeros(solid.shape, dtype=np.float32)
        for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
            filled = np.roll(solid, shift, axis=axis)
            values = np.roll(rgb, shift, axis=axis)
            if axis == 0:
                filled[0 if shift > 0 else -1, :] = False
            else:
                filled[:, 0 if shift > 0 else -1] = False
            total += np.where(filled[..., None], values, 0)
            count += filled
        grow = transparent & (count > 0)
        rgb[grow] = total[grow] / count[grow][..., None]
        solid = solid | grow
    out = rgba.copy()
    out[..., :3] = np.rint(rgb).clip(0, 255).astype(np.uint8)
    return out


def pixel_icon(image, size):
    """Premultiplied box downsample with a hard alpha cut."""
    source = np.asarray(image.convert("RGBA"), dtype=np.float32)
    alpha = source[..., 3:4] / 255
    premultiplied = np.concatenate((source[..., :3] * alpha, source[..., 3:4]), axis=2)
    buffer = Image.fromarray(np.rint(premultiplied).clip(0, 255).astype(np.uint8), "RGBA")
    scaled = np.asarray(buffer.resize((size, size), Image.Resampling.BOX), dtype=np.float32)

    keep = scaled[..., 3] > COVERAGE * 255
    coverage = scaled[..., 3:4] / 255
    colour = np.divide(scaled[..., :3], coverage, out=np.zeros_like(scaled[..., :3]),
                       where=coverage > 0)
    result = np.zeros((size, size, 4), dtype=np.uint8)
    result[..., :3] = np.rint(colour).clip(0, 255).astype(np.uint8)
    result[..., 3] = np.where(keep, 255, 0)
    return Image.fromarray(_bleed_colour(result), "RGBA")


def save_pixel_icon(image, size, path):
    pixel_icon(image, size).save(path)
    return path
