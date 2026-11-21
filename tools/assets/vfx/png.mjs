import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const clamp = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => clamp(x) ** 2 * (3 - 2 * clamp(x));
export const gaussian = (x, sigma) => Math.exp(-0.5 * (x / sigma) ** 2);

export function createAtlasBuffers(width, height) {
    const pixels = Buffer.alloc((width * 4 + 1) * height);
    const merPixels = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) merPixels[y * (width * 3 + 1) + x * 3 + 3] = 255;
    }
    return { width, height, pixels, merPixels };
}

export function paintTile(buffers, [left, top, w, h], emissive, profile) {
    const { width, pixels, merPixels } = buffers;
    for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
            const u = ((x + 0.5) / w) * 2 - 1;
            const v = ((y + 0.5) / h) * 2 - 1;
            const [light, alpha] = profile(u, v);
            const index = (top + y) * (width * 4 + 1) + (left + x) * 4 + 1;
            const channels = Array.isArray(light) ? light : [light, light, light];
            for (const [channel, value] of channels.entries()) pixels[index + channel] = Math.round(clamp(value) * 255);
            pixels[index + 3] = Math.round(clamp(alpha) * 255);
            const green = (top + y) * (width * 3 + 1) + (left + x) * 3 + 2;
            merPixels[green] = Math.round(255 * emissive * clamp(alpha) * Math.max(...channels.map(clamp)));
        }
    }
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(~crc >>> 0);
    return Buffer.concat([size, body, checksum]);
}

export function encodePng(width, height, data, colorType) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(data)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

export function writeOrCheck(rootUrl, path, contents, check) {
    const file = fileURLToPath(new URL(path, rootUrl));
    if (check) {
        const matches = typeof contents === "string"
            ? readFileSync(file, "utf8").replaceAll("\r\n", "\n") === contents
            : readFileSync(file).equals(contents);
        if (!matches) throw new Error(`VFX asset differs: ${path}`);
    } else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
    }
}
