"""Draw a large-print numbered score for the in-game music stand."""

from PIL import Image, ImageDraw, ImageFont


PAGE_WIDTH = 704
PAGE_HEIGHT = 912
PAPER = (255, 251, 235)
INK = (19, 21, 25)
ACCENT = (68, 45, 28)
# One character per beat in C major. A dash sustains the preceding note.
A = ("1155", "665-", "4433", "221-")
B = ("5544", "332-")
BARS = A + B + B + A
UI_SCORE_PATHS = tuple(f"textures/ui/piano_score/page_{page + 1}.png" for page in range(len(BARS) // 3))


def draw_bar(draw, bar, x, y, spacing, size, weight):
    for beat, digit in enumerate(bar):
        center = x + beat * spacing
        if digit == "-":
            half = round(size * .28)
            draw.rounded_rectangle((center - half, y - weight, center + half, y + weight), radius=weight, fill=INK)
        else:
            draw.text((center, y), digit, fill=INK, font=ImageFont.load_default(size=size),
                      anchor="mm", stroke_width=weight, stroke_fill=INK)


def engrave_page(image, u, v, page):
    draw = ImageDraw.Draw(image)
    # Fill beyond the UV inset so texture filtering cannot pull in a seam.
    draw.rectangle((u, v, u + PAGE_WIDTH - 1, v + PAGE_HEIGHT - 1), fill=PAPER)

    def label(x, y, value, size, color=INK, weight=0):
        draw.text((u + x, v + y), value, fill=color, font=ImageFont.load_default(size=size),
                  anchor="mm", stroke_width=weight, stroke_fill=color)

    label(352, 79, "TWINKLE", 63, weight=2)
    label(352, 155, "1 = C    4/4", 48, color=ACCENT, weight=1)
    for index, bar in enumerate(BARS[page * 3:page * 3 + 3]):
        y = 305 + index * 209
        draw_bar(draw, bar, u + 116, v + y, 145, 152, 5)
        draw.rectangle((u + 641, v + y - 45, u + 650, v + y + 45), fill=ACCENT)
        if page == 3 and index == 2:
            draw.rectangle((u + 658, v + y - 45, u + 673, v + y + 45), fill=ACCENT)
    label(352, 849, f"{page + 1} / 4", 52, color=ACCENT, weight=1)


def publish_ui_pages(resource_pack):
    for page, relative_path in enumerate(UI_SCORE_PATHS):
        image = Image.new("RGB", (768, 432), PAPER)
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=36)
        draw.text((56, 44), "1 = C     4/4", font=font, fill=ACCENT, anchor="lm")
        draw.text((712, 44), f"{page + 1} / {len(UI_SCORE_PATHS)}", font=font, fill=ACCENT, anchor="rm")
        draw.line((56, 79, 712, 79), fill=ACCENT, width=3)
        for index, bar in enumerate(BARS[page * 3:page * 3 + 3]):
            y = 143 + index * 105
            draw_bar(draw, bar, 117, y, 162, 91, 3)
            draw.rectangle((700, y - 27, 706, y + 27), fill=ACCENT)
            if page == len(UI_SCORE_PATHS) - 1 and index == 2:
                draw.rectangle((713, y - 27, 722, y + 27), fill=ACCENT)
        path = resource_pack / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
