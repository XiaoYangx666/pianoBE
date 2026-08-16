import fs from "node:fs";
import assert from "node:assert/strict";
import {
    crc32Hex,
    packNotes,
    unpackNotes,
    songToAddonModule,
    metasToAddonIndex,
    SongStore,
    PlaylistStore,
    MemorySongPort,
    MemoryPlaylistPort,
} from "@piano/core";

// 1. crc32 与历史 id 一致
const buf = fs.readFileSync("midis/files/Beyond - 海阔天空.mid");
assert.equal(crc32Hex(new Uint8Array(buf)), "4beea226", "crc32 id 不匹配历史产物");

// 2. 打包/解包往返
const quads = [41, 0, 293, 75, 82, 29, 73, 75];
const packed = packNotes(quads);
assert.ok(packed instanceof Uint16Array);
assert.deepEqual([...packed], quads);
assert.deepEqual(unpackNotes(packed), quads);

// 3. 端到端：真实 .mid 经 core 转换 → addon 模块文本，与现有产物逐字节一致
import { midiBufferToSong } from "@piano/core/convert";
{
    const existing = fs.readFileSync("midis/js/4beea226.js", "utf-8");
    const song = midiBufferToSong(
        new Uint8Array(fs.readFileSync("midis/files/Beyond - 海阔天空.mid")),
        "Beyond - 海阔天空"
    );
    assert.equal(songToAddonModule(song), existing);
}

// 4. 曲库：内容寻址幂等 + fromIds 过滤缺失
const songPort = new MemorySongPort();
const songStore = new SongStore(songPort);
songStore.add({ id: "aaa", name: "A", duration: 100, tracks: [] });
songStore.add({ id: "aaa", name: "A2", duration: 200, tracks: [] }); // 同 id 覆盖（幂等语义：内容寻址下同 id 应同内容）
assert.equal(songStore.getMeta("aaa")?.duration, 200);
assert.equal(songStore.has("bbb"), false);
assert.deepEqual(songStore.fromIds(["aaa", "missing"]).map((m) => m.id), ["aaa"]);

// 5. 播放列表：创建/视图/删除/播放计数
const plPort = new MemoryPlaylistPort();
const plStore = new PlaylistStore(plPort);

const l1 = plStore.create("player1", "我的歌单");
const l2 = plStore.create("player1", "第二歌单");
const l3 = plStore.create("player2", "别人的");
assert.equal(l1.id, 1);
assert.equal(l3.id, 3, "nextId 应基于现有 meta 恢复");

plStore.setContent(l1.id, ["aaa", "bbb"]);
assert.deepEqual(plStore.getContent(l1.id), ["aaa", "bbb"]);
assert.equal(plStore.getMetasByOwner("player1").length, 2);
assert.equal(plStore.getPublicMetas().length, 0);

plStore.updateMeta(l2.id, { public: true });
let pub = plStore.getPublicMetas(true);
assert.equal(pub.length, 1);
assert.equal(pub[0].id, l2.id);

// 播放计数去重
plStore.incPlayCount(l3.id, "player1");
plStore.incPlayCount(l3.id, "player1"); // 同日重复不计
assert.equal(plStore.getMeta(l3.id)?.playCount, 1);

// 6. 崩溃残留自愈：模拟 create 中途崩溃（content 写了但 meta 未写/丢失）
const orphanContent = { id: 99, items: ["aaa"] };
plPort.setContent(99, orphanContent.items); // 手动注入孤儿 content
assert.equal(plStore.getMeta(99), undefined, "孤儿 content 不应出现在任何视图");
assert.ok(!plStore.getMetasByOwner("player-any").some((m) => m.id === 99));
assert.ok(!plStore.getPublicMetas().some((m) => m.id === 99));
assert.equal(plPort.getContent(99).length, 1, "孤儿 content 仍在底层存储");
plStore.delete(99); // 删除幂等，不抛错
assert.equal(plPort.getContent(99).length, 0);

// 7. 删除后 nextId 可复用
plStore.delete(l3.id);
assert.equal(plStore.create("player2", "新的").id, 3, "删除后 max(id)+1 复用 id 属预期");

// 8. 索引文本
assert.ok(metasToAddonIndex([{ id: "aaa", name: "A", duration: 100 }]).startsWith("export const midis=["));

console.log("✅ core 冒烟验证全部通过（crc32/编码/模块文本/曲库/播放列表/崩溃自愈）");