import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { metasToAddonIndex, readSongHeader, songToAddonModule } from "@piano/core";

const output = resolve(process.argv[2]);
const library = new URL("../../midis/library/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", library), "utf8"));
const ids = new Set();
const songs = index.map(entry => {
    if (!/^[a-f0-9]{1,8}$/.test(entry.id) || ids.has(entry.id)) {
        throw new Error(`曲库含无效或重复 ID：${entry.id}`);
    }
    ids.add(entry.id);
    const data = readFileSync(new URL(`${entry.id}.pbe3`, library));
    if (readSongHeader(data).id !== entry.id) throw new Error(`曲库索引与 PBE3 ID 不匹配：${entry.id}`);
    return { meta: { ...entry, bytes: data.length }, data };
});

mkdirSync(output, { recursive: true });
for (const { meta, data } of songs) writeFileSync(join(output, `${meta.id}.js`), songToAddonModule(data));
writeFileSync(join(output, "index.js"), metasToAddonIndex(songs.map(({ meta }) => meta)));
console.log(`Embedded ${songs.length} public PBE3 songs`);
