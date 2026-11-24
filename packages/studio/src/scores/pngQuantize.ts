/**
 * 把画布编码成调色板 PNG。
 *
 * 曲谱基本都是黑白：灰阶页面保留 16 级灰度，输出 4 位 PNG，既能保留抗锯齿又
 * 比 8 位灰度小一半；彩色页面才退回 32 色自适应量化。
 */

const GRAY_THRESHOLD = 28;
const COLOR_BITS = 5;
const MAX_COLORS = 32;

interface Quantized {
    /** RGB 三元组，长度是 3 的倍数 */
    palette: Uint8Array;
    /** 每像素一个调色板下标 */
    indices: Uint8Array;
    /** 索引位深：1 / 2 / 4 / 8 */
    bitDepth: 1 | 2 | 4 | 8;
}

export async function canvasToQuantizedPng(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
): Promise<Uint8Array> {
    // 旧内核没有 CompressionStream，退回浏览器自带编码。
    if (typeof CompressionStream === "undefined") return canvasToPng(canvas);
    const width = canvas.width;
    const height = canvas.height;
    const { data } = ctx.getImageData(0, 0, width, height);
    const { palette, indices, bitDepth } = quantize(data);
    const raw = filterNone(indices, width, height, bitDepth);
    const compressed = await deflate(raw);
    return buildPng(width, height, palette, bitDepth, compressed);
}

function quantize(data: Uint8ClampedArray): Quantized {
    const pixels = data.length / 4;
    if (isGrayscale(data, pixels)) {
        // 谱面基本只有黑白：保留 16 级灰度，输出 4 位 PNG。
        const palette = new Uint8Array(16 * 3);
        for (let i = 0; i < 16; i++) {
            const value = Math.round(i * 255 / 15);
            palette[i * 3] = value;
            palette[i * 3 + 1] = value;
            palette[i * 3 + 2] = value;
        }
        const indices = new Uint8Array(pixels);
        for (let i = 0, offset = 0; i < pixels; i++, offset += 4) {
            indices[i] = Math.round(luma(data[offset], data[offset + 1], data[offset + 2]) / 17);
        }
        return { palette, indices, bitDepth: 4 };
    }
    return quantizeColor(data, pixels);
}

/** 抽样判断是不是真正需要保留彩色。 */
function isGrayscale(data: Uint8ClampedArray, pixels: number): boolean {
    const stride = 4 * Math.max(1, Math.floor(pixels / 20000));
    let samples = 0;
    let colored = 0;
    for (let offset = 0; offset + 2 < data.length; offset += stride) {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        samples++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > GRAY_THRESHOLD) colored++;
    }
    // 少量彩色水印/签名不影响整页按黑白处理。
    return colored <= samples * 0.02;
}

function luma(r: number, g: number, b: number): number {
    return Math.min(255, Math.max(0, Math.round(r * 0.299 + g * 0.587 + b * 0.114)));
}

function quantizeColor(data: Uint8ClampedArray, pixels: number): Quantized {
    const shift = 8 - COLOR_BITS;
    const bins = 1 << (COLOR_BITS * 3);
    const counts = new Uint32Array(bins);
    const sums = new Uint32Array(bins * 3);

    for (let offset = 0; offset < data.length; offset += 4) {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const bin = ((r >> shift) << (COLOR_BITS * 2)) |
            ((g >> shift) << COLOR_BITS) |
            (b >> shift);
        counts[bin]++;
        sums[bin * 3] += r;
        sums[bin * 3 + 1] += g;
        sums[bin * 3 + 2] += b;
    }

    const used: number[] = [];
    for (let bin = 0; bin < bins; bin++) {
        if (counts[bin] > 0) used.push(bin);
    }
    used.sort((a, b) => counts[b] - counts[a]);
    const chosen = used.slice(0, MAX_COLORS);

    const palette = new Uint8Array(chosen.length * 3);
    chosen.forEach((bin, index) => {
        const count = counts[bin];
        palette[index * 3] = Math.round(sums[bin * 3] / count);
        palette[index * 3 + 1] = Math.round(sums[bin * 3 + 1] / count);
        palette[index * 3 + 2] = Math.round(sums[bin * 3 + 2] / count);
    });

    // 每个直方图格都映射到最近的调色板颜色，避免逐像素做 256 次比较。
    const lookup = new Uint8Array(bins);
    for (const bin of used) {
        const r = sums[bin * 3] / counts[bin];
        const g = sums[bin * 3 + 1] / counts[bin];
        const b = sums[bin * 3 + 2] / counts[bin];
        let best = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < chosen.length; index++) {
            const dr = r - palette[index * 3];
            const dg = g - palette[index * 3 + 1];
            const db = b - palette[index * 3 + 2];
            const distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        }
        lookup[bin] = best;
    }

    const indices = new Uint8Array(pixels);
    for (let i = 0, offset = 0; i < pixels; i++, offset += 4) {
        const bin = ((data[offset] >> shift) << (COLOR_BITS * 2)) |
            ((data[offset + 1] >> shift) << COLOR_BITS) |
            (data[offset + 2] >> shift);
        indices[i] = lookup[bin];
    }
    return { palette, indices, bitDepth: paletteBitDepth(chosen.length) };
}

function paletteBitDepth(colors: number): 1 | 2 | 4 | 8 {
    if (colors <= 2) return 1;
    if (colors <= 4) return 2;
    if (colors <= 16) return 4;
    return 8;
}

function filterNone(
    indices: Uint8Array,
    width: number,
    height: number,
    bitDepth: 1 | 2 | 4 | 8
): Uint8Array {
    const stride = 1 + Math.ceil(width * bitDepth / 8);
    const raw = new Uint8Array(stride * height);
    const perByte = 8 / bitDepth;
    for (let y = 0; y < height; y++) {
        const row = y * stride;
        raw[row] = 0;
        if (bitDepth === 8) {
            raw.set(indices.subarray(y * width, (y + 1) * width), row + 1);
            continue;
        }
        for (let x = 0; x < width; x++) {
            const shift = 8 - bitDepth * (x % perByte + 1);
            raw[row + 1 + Math.floor(x / perByte)] |= indices[y * width + x] << shift;
        }
    }
    return raw;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    const stream = new Blob([copy]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function buildPng(
    width: number,
    height: number,
    palette: Uint8Array,
    bitDepth: 1 | 2 | 4 | 8,
    compressed: Uint8Array
): Uint8Array {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = bitDepth;
    ihdr[9] = 3; // indexed color
    // compression / filter / interlace 均为 0

    return concat([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("PLTE", palette),
        chunk("IDAT", compressed),
        chunk("IEND", new Uint8Array(0)),
    ]);
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** 不支持 CompressionStream 时的回退路径。 */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("曲谱图片编码失败"));
                return;
            }
            blob.arrayBuffer().then(
                (buffer) => resolve(new Uint8Array(buffer)),
                (error) => reject(error)
            );
        }, "image/png");
    });
}
