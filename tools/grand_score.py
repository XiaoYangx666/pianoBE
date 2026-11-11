"""Publish local test score pages plus the empty score-stand atlas.

The shipped template contains no scores; players import real sheet-music
images/PDFs through the generator. For local testing, score entries live in
assets/scores/scores.json (git-ignored). This module only scales supplied
images into the stand atlas and DDUI page views; it never draws notation.
"""

import json
import struct
import zlib
from pathlib import Path
from shutil import rmtree

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SCORE_ASSETS = ROOT / "assets/scores"

STAND_TEXTURE_SIZE = 1024
STAND_PAGE_WIDTH = 352
STAND_PAGE_HEIGHT = 456
STAND_HARDWARE_TOP = 959
STAND_HARDWARE_ROWS = 26
STAND_HARDWARE_WIDTH = 26
STAND_HARDWARE_UV_SIZE = 24
UI_PAGE_WIDTH = 1280
# A4 竖版比例（1:1.414）。面板每次只显示一页；画布保持纸面比例，页面才能
# 用满面板宽度，而不是像横版跨页那样把整页缩到中间一小块。
UI_PAGE_HEIGHT = 1810
PAPER = (255, 251, 235)
BLANK_SCORE_ID = "blank"

# 正式模板不内置曲谱：玩家在生成器里导入自己的真实谱面。
# 本地测试曲谱放在 assets/scores/scores.json（整个目录已排除在 git 之外），
# 有配置时构建会临时把它们打进模板，方便进游戏验证。
LOCAL_SCORE_CONFIG = SCORE_ASSETS / "scores.json"


def _load_local_scores():
    if not LOCAL_SCORE_CONFIG.is_file():
        return ()
    try:
        records = json.loads(LOCAL_SCORE_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"[scores] 忽略本地测试曲谱配置：{error}")
        return ()
    scores = []
    for record in records if isinstance(records, list) else ():
        try:
            score_id = str(record["id"])
            title = str(record["title"])
            pages = tuple(str(page) for page in record["source_pages"])
        except (KeyError, TypeError):
            continue
        if score_id == BLANK_SCORE_ID or not pages:
            continue
        scores.append({"id": score_id, "title": title, "source_pages": pages})
    return tuple(scores)


SCORES = _load_local_scores()



def ui_pages(score):
    return tuple(
        f"textures/ui/piano_score/{score['id']}/page_{page + 1}.png"
        for page in range(len(score["source_pages"]))
    )


def stand_texture(score):
    return f"textures/entity/piano_score/{score['id']}"


def blank_texture():
    return f"textures/entity/piano_score/{BLANK_SCORE_ID}"


def paint_hardware(image):
    draw = ImageDraw.Draw(image)
    for u, bottom, top in ((0, (25, 28, 34), (49, 54, 60)), (64, (36, 38, 42), (60, 64, 69))):
        for row in range(STAND_HARDWARE_ROWS):
            color = tuple(round(a + (b - a) * row / (STAND_HARDWARE_ROWS - 1)) for a, b in zip(top, bottom))
            draw.line((u, STAND_HARDWARE_TOP + row, u + STAND_HARDWARE_WIDTH - 1,
                       STAND_HARDWARE_TOP + row), fill=color)


def _fit(page, width, height):
    fitted = ImageOps.contain(page, (width, height), Image.Resampling.LANCZOS)
    # 网络谱面常常只有 600px 宽，放大到 1280 后略作锐化，避免糊成一团。
    if fitted.width > page.width:
        fitted = fitted.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2))
    return fitted


GRAY_LEVELS = 16


def _png_chunk(kind, data):
    return (struct.pack(">I", len(data)) + kind + data +
            struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))


def _save_gray4(image, path):
    """16 级灰度、4 位调色板 PNG：保留抗锯齿，又只有 8 位灰度的一半数据量。

    必须用调色板（color type 3）而不是灰度（color type 0）：基岩版实体纹理
    会把灰度图当成亮度+透明度，黑色像素会直接渲染成透明。
    """
    gray = image.convert("L")
    width, height = gray.size
    level = bytearray(round(value / 255 * (GRAY_LEVELS - 1)) for value in gray.getdata())
    raw = bytearray()
    row_bytes = (width + 1) // 2
    for y in range(height):
        raw.append(0)  # filter: none
        row = bytearray(row_bytes)
        base = y * width
        for x in range(width):
            if x % 2 == 0:
                row[x // 2] |= level[base + x] << 4
            else:
                row[x // 2] |= level[base + x]
        raw += row
    palette = bytes(round(i * 255 / (GRAY_LEVELS - 1)) for i in range(GRAY_LEVELS) for _ in range(3))
    header = struct.pack(">IIBBBBB", width, height, 4, 3, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) +
                     _png_chunk(b"PLTE", palette) +
                     _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
                     _png_chunk(b"IEND", b""))


def _save_quantized(image, path):
    """谱面基本都是黑白：灰阶页转 16 级灰度，彩色页才保留少量颜色。"""
    saturation = image.convert("HSV").getchannel("S")
    histogram = saturation.histogram()
    colored = sum(histogram[29:])
    total = sum(histogram)
    if colored <= total * 0.02:
        _save_gray4(image, path)
    else:
        image.quantize(colors=32, method=Image.Quantize.MEDIANCUT,
                       dither=Image.Dither.NONE).save(path, optimize=True)


def _paste_centered(canvas, page, x, y, width, height):
    fitted = _fit(page, width, height)
    canvas.paste(fitted, (x + (width - fitted.width) // 2, y + (height - fitted.height) // 2))


def publish_score_assets(resource_pack):
    """Publish preset stand atlases and the single-page DDUI previews."""
    # 曲谱集合由 SCORES 决定；清掉旧目录，避免删除曲谱后遗留无用纹理。
    rmtree(resource_pack / "textures/entity/piano_score", ignore_errors=True)
    rmtree(resource_pack / "textures/ui/piano_score", ignore_errors=True)
    (resource_pack / "textures/entity/grand_score.png").unlink(missing_ok=True)

    for score in SCORES:
        pages = [Image.open(SCORE_ASSETS / relative).convert("RGB")
                 for relative in score["source_pages"]]

        stand = Image.new("RGB", (STAND_TEXTURE_SIZE, STAND_TEXTURE_SIZE), PAPER)
        paint_hardware(stand)
        for index, page in enumerate(pages[:4]):
            _paste_centered(stand, page, index % 2 * STAND_PAGE_WIDTH,
                            index // 2 * STAND_PAGE_HEIGHT, STAND_PAGE_WIDTH, STAND_PAGE_HEIGHT)
        path = resource_pack / f"{stand_texture(score)}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        _save_quantized(stand, path)

        for page, relative in zip(pages, ui_pages(score)):
            canvas = Image.new("RGB", (UI_PAGE_WIDTH, UI_PAGE_HEIGHT), PAPER)
            _paste_centered(canvas, page, 0, 0, UI_PAGE_WIDTH, UI_PAGE_HEIGHT)
            target = resource_pack / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            _save_quantized(canvas, target)

    if not SCORES:
        print("[scores] 未找到本地测试曲谱；模板将只发布空白谱架。")

    blank = Image.new("RGB", (STAND_TEXTURE_SIZE, STAND_TEXTURE_SIZE), PAPER)
    paint_hardware(blank)
    path = resource_pack / f"{blank_texture()}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    _save_quantized(blank, path)
