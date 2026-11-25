import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const ITEMS = new URL("../rp/textures/items/", import.meta.url);

function paeth(left: number, up: number, upLeft: number): number {
    const estimate = left + up - upLeft;
    const toLeft = Math.abs(estimate - left);
    const toUp = Math.abs(estimate - up);
    const toUpLeft = Math.abs(estimate - upLeft);
    if (toLeft <= toUp && toLeft <= toUpLeft) return left;
    return toUp <= toUpLeft ? up : upLeft;
}

/** Minimal decoder for the 8-bit RGBA, non-interlaced PNGs the icon scripts write. */
function decodePng(source: Buffer) {
    if (source.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error("not a PNG");
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let depth = 0;
    let colourType = 0;
    let interlace = 0;
    const chunks: Buffer[] = [];
    while (offset + 8 <= source.length) {
        const length = source.readUInt32BE(offset);
        const type = source.toString("ascii", offset + 4, offset + 8);
        const data = source.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            depth = data[8];
            colourType = data[9];
            interlace = data[12];
        } else if (type === "IDAT") {
            chunks.push(data);
        } else if (type === "IEND") {
            break;
        }
        offset += length + 12;
    }
    if (depth !== 8 || colourType !== 6 || interlace !== 0) {
        throw new Error(`unsupported PNG layout: depth=${depth} colour=${colourType} interlace=${interlace}`);
    }

    const raw = inflateSync(Buffer.concat(chunks));
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);
    let previous = Buffer.alloc(stride);
    for (let y = 0; y < height; y += 1) {
        const start = y * (stride + 1);
        const filter = raw[start];
        const line = raw.subarray(start + 1, start + 1 + stride);
        const row = pixels.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < stride; x += 1) {
            const left = x >= 4 ? row[x - 4] : 0;
            const up = previous[x];
            const upLeft = x >= 4 ? previous[x - 4] : 0;
            const predictor = filter === 0 ? 0
                : filter === 1 ? left
                    : filter === 2 ? up
                        : filter === 3 ? (left + up) >> 1
                            : filter === 4 ? paeth(left, up, upLeft)
                                : Number.NaN;
            if (Number.isNaN(predictor)) throw new Error(`unknown PNG filter ${filter}`);
            row[x] = (line[x] + predictor) & 0xff;
        }
        previous = row;
    }
    return { width, height, pixels };
}

function alphaValues(name: string): Set<number> {
    const png = decodePng(readFileSync(new URL(name, ITEMS)));
    const values = new Set<number>();
    for (let index = 3; index < png.pixels.length; index += 4) values.add(png.pixels[index]);
    return values;
}

// A半透明 edge composites over the slot background and reads as a thin outline
// around the sprite, so every icon must keep a hard 1-bit silhouette.
test("item icons use a hard alpha silhouette", () => {
    const icons = readdirSync(ITEMS).filter((name) => name.endsWith(".png"));
    expect(icons.length).toBeGreaterThan(0);
    for (const name of icons) {
        const translucent = [...alphaValues(name)].filter((alpha) => alpha !== 0 && alpha !== 255);
        expect({ name, translucent }).toEqual({ name, translucent: [] });
    }
});

/** Enclosed transparent pixels that are nowhere thicker than two pixels. */
function cracks(name: string): number {
    const { width, height, pixels } = decodePng(readFileSync(new URL(name, ITEMS)));
    const clear = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
        && pixels[(y * width + x) * 4 + 3] === 0;
    const outside = new Uint8Array(width * height);
    const stack: Array<[number, number]> = [];
    const seed = (x: number, y: number) => {
        if (clear(x, y) && !outside[y * width + x]) {
            outside[y * width + x] = 1;
            stack.push([x, y]);
        }
    };
    for (let x = 0; x < width; x += 1) { seed(x, 0); seed(x, height - 1); }
    for (let y = 0; y < height; y += 1) { seed(0, y); seed(width - 1, y); }
    while (stack.length) {
        const [x, y] = stack.pop()!;
        seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
    }

    const seen = new Uint8Array(width * height);
    let thin = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            if (!clear(x, y) || outside[index] || seen[index]) continue;
            const region: Array<[number, number]> = [[x, y]];
            seen[index] = 1;
            let thick = false;
            while (region.length) {
                const [cx, cy] = region.pop()!;
                if (clear(cx + 1, cy) && clear(cx - 1, cy) && clear(cx, cy + 1) && clear(cx, cy - 1)) {
                    thick = true;
                }
                const neighbours: Array<[number, number]> = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
                for (const [nx, ny] of neighbours) {
                    const next = ny * width + nx;
                    if (clear(nx, ny) && !outside[next] && !seen[next]) {
                        seen[next] = 1;
                        region.push([nx, ny]);
                    }
                }
            }
            if (!thick) thin += 1;
        }
    }
    return thin;
}

// Gaps the rasteriser leaves between hand-drawn facets sit inside the sprite and
// let the slot background show through the artwork.
test("item icons have no cracked interior", () => {
    for (const name of readdirSync(ITEMS).filter((entry) => entry.endsWith(".png"))) {
        expect({ name, cracks: cracks(name) }).toEqual({ name, cracks: 0 });
    }
});
