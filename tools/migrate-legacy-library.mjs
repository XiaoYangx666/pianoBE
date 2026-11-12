// 一次性离线迁移：旧版曲库 v1 `.bin` → PBE2。
// 旧解码器只存在于这个迁移脚本中，不进入 @piano/core 或运行时包。
// 用法：node tools/migrate-legacy-library.mjs
import fs from "node:fs";
import path from "node:path";
import {
    collectNoteCount,
    encodePbe2,
    metasToAddonIndex,
    pbe2ToAddonModule,
} from "@piano/core";

const libDir = path.resolve("./midis/library");
const jsDir = path.resolve("./midis/js");
const indexPath = path.join(libDir, "index.json");

const textDecoder = new TextDecoder();

function decodeLegacyV1(buf) {
    let pos = 0;
    const readU8 = () => buf[pos++];
    const readU16 = () => {
        const v = buf[pos] | (buf[pos + 1] << 8);
        pos += 2;
        return v;
    };
    const readU32 = () => {
        const v =
            buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24);
        pos += 4;
        return v >>> 0;
    };
    const readStr = () => {
        const len = readU16();
        const s = textDecoder.decode(buf.subarray(pos, pos + len));
        pos += len;
        return s;
    };

    const version = readU8();
    if (version !== 1) throw new Error(`不支持的旧曲库版本 ${version}`);
    const id = readStr();
    const name = readStr();
    const duration = readU32();
    const trackCount = readU8();
    const tableLen = readU8();
    const table = [];
    for (let i = 0; i < tableLen; i++) table.push(readStr());

    const tracks = [];
    for (let t = 0; t < trackCount; t++) {
        const instrument = JSON.parse(table[readU8()]);
        const noteCount = readU32();
        const notes = new Array(noteCount * 4);
        for (let i = 0; i < noteCount; i++) {
            const off = pos + i * 6;
            notes[i * 4] = buf[off];
            notes[i * 4 + 1] = buf[off + 1] | (buf[off + 2] << 8);
            notes[i * 4 + 2] = buf[off + 3] | (buf[off + 4] << 8);
            notes[i * 4 + 3] = buf[off + 5];
        }
        pos += noteCount * 6;
        tracks.push({ instrument, notes });
    }
    return { id, name, duration, tracks };
}

if (!fs.existsSync(indexPath)) {
    console.error(`找不到曲库目录: ${indexPath}`);
    process.exit(1);
}
fs.mkdirSync(jsDir, { recursive: true });

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
let migrated = 0;
let skipped = 0;
for (const meta of index) {
    const binPath = path.join(libDir, `${meta.id}.bin`);
    if (!fs.existsSync(binPath)) {
        console.warn(`缺少曲目文件: ${binPath}`);
        continue;
    }
    const bytes = new Uint8Array(fs.readFileSync(binPath));
    let pbe2;
    if (bytes[0] === 0x50 && bytes[1] === 0x42 && bytes[2] === 0x45 && bytes[3] === 0x32) {
        pbe2 = bytes;
        skipped++;
    } else {
        const song = decodeLegacyV1(bytes);
        pbe2 = encodePbe2(song);
        fs.writeFileSync(binPath, pbe2);
        meta.noteCount = collectNoteCount(song);
        migrated++;
    }
    fs.writeFileSync(path.join(jsDir, `${meta.id}.js`), pbe2ToAddonModule(pbe2), "utf8");
}

index.sort((a, b) => a.name.localeCompare(b.name, "zh"));
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n", "utf8");
fs.writeFileSync(path.join(jsDir, "index.js"), metasToAddonIndex(index), "utf8");
console.log(`迁移完成：转换 ${migrated} 首，已是 PBE2 ${skipped} 首，共 ${index.length} 首`);
