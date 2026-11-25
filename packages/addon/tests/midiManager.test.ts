import { describe, expect, test } from "bun:test";
import { encodePbe3, worldPublicId, type MidiSongMeta } from "@piano/core";
import { MidiManager, type MidiSourceLike } from "../src/domain/playback/midiManager";

const meta = (id: string, name = id): MidiSongMeta => ({ id, name, duration: 40 });

function source(items: MidiSongMeta[], paged = false): MidiSourceLike {
    return {
        list: () => items,
        async get(id) {
            return id ? new Uint8Array([1]) : undefined;
        },
        page: paged
            ? async (page, pageSize, q) => {
                const filtered = q ? items.filter(item => item.name.includes(q)) : items;
                const start = (page - 1) * pageSize;
                return { items: filtered.slice(start, start + pageSize), total: filtered.length };
            }
            : undefined,
    };
}

describe("MidiManager 公共附加来源", () => {
    test("分页结果按主来源在前、全局曲库在后合并", async () => {
        const manager = new MidiManager(source([meta("a"), meta("b")]));
        manager.addPublicSource(source([meta("g1", "晴天"), meta("g2", "夜曲")]));

        expect((await manager.page(1, 2)).items.map(item => item.id)).toEqual(["a", "b"]);
        expect((await manager.page(2, 2)).items.map(item => item.id)).toEqual(["g1", "g2"]);
        expect((await manager.page(1, 5, "夜")).items.map(item => item.id)).toEqual(["g2"]);
        expect((await manager.metaAll()).map(item => item.id)).toEqual(["a", "b", "g1", "g2"]);
        expect(manager.getInfo("g1")?.name).toBe("晴天");
    });

    test("远程分页主来源与本地全局曲库合并时分页边界正确", async () => {
        const remote = source([meta("r1"), meta("r2"), meta("r3")], true);
        const manager = new MidiManager(remote);
        manager.addPublicSource(source([meta("g1")]));

        expect((await manager.page(1, 2)).items.map(item => item.id)).toEqual(["r1", "r2"]);
        expect((await manager.page(2, 2)).items.map(item => item.id)).toEqual(["r3", "g1"]);
        expect((await manager.page(1, 10)).total).toBe(4);
    });

    test("全局曲库索引刷新后新歌可查、删除的歌不再登记", async () => {
        const extra = [meta("g1", "晴天")];
        const manager = new MidiManager(source([meta("a")]));
        manager.addPublicSource(source(extra));
        expect(manager.getInfo("g1")?.name).toBe("晴天");

        extra.length = 0;
        extra.push(meta("g2", "夜曲"));
        manager.refreshPublicIndex();
        expect(manager.getInfo("g1")).toBeUndefined();
        expect(manager.getInfo("g2")?.name).toBe("夜曲");
        expect((await manager.page(1, 10)).items.map(item => item.id)).toEqual(["a", "g2"]);
    });

    test("主曲库和世界曲库同 ID 时，播放数据与元信息分别对应", async () => {
        const encode = (name: string) => encodePbe3({
            id: "same", name, duration: 40,
            tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [60, 0, 20, 90] }],
        });
        const primaryBytes = encode("主来源");
        const worldBytes = encode("世界来源");
        const primary: MidiSourceLike = {
            list: () => [meta("same", "主来源")],
            get: async id => id === "same" ? primaryBytes : undefined,
        };
        const worldId = worldPublicId("same");
        const secondary: MidiSourceLike = {
            list: () => [meta(worldId, "世界来源")],
            get: async id => id === worldId ? worldBytes : undefined,
        };
        const manager = new MidiManager(primary);
        manager.addPublicSource(secondary);
        expect(manager.getInfo("same")?.name).toBe("主来源");
        expect(manager.getInfo(worldId)?.name).toBe("世界来源");
        expect((await manager.page(1, 5)).items.map(item => item.id)).toEqual(["same", worldId]);
        const a = await manager.acquire("same");
        const b = await manager.acquire(worldId);
        expect(a?.song.name).toBe("主来源");
        expect(b?.song.name).toBe("世界来源");
        a?.release();
        b?.release();
        expect(await manager.read(worldId)).toEqual(worldBytes);
    });

    test("远程分页结果登记演出摘要，详情页可读取附加演出", async () => {
        const entry = {
            id: "pianobe.pack.featured:r1",
            name: "精选演出",
            songId: "r1",
            requiredEffects: ["starfield"],
        };
        const item = { ...meta("r1", "雨过见青"), performanceEntries: [entry] };
        const manager = new MidiManager({
            list: () => [],
            async get() { return undefined; },
            async page() { return { items: [item], total: 1 }; },
        });

        // 远程来源 list() 为空，分页是唯一元信息来源。
        expect(manager.performanceEntries("r1")).toEqual([]);
        await manager.page(1, 10);

        expect(manager.getInfo("r1")?.performanceEntries).toEqual([entry]);
        expect(manager.performanceEntries("r1")).toEqual([entry]);
    });

    test("EmbeddedMidiSource 暴露内嵌曲库列表并支持按 libraryId 过滤", async () => {
        const { EmbeddedMidiSource } = await import("../src/data/midiSource/embedded");
        const src = new EmbeddedMidiSource(
            [
                { ...meta("s1", "曲1"), libraries: ["lib_a"], value: async () => "" },
                { ...meta("s2", "曲2"), libraries: ["lib_b"], value: async () => "" },
            ],
            [
                { id: "lib_a", name: "精选" },
                { id: "lib_b", name: "流行" },
            ],
        );
        const manager = new MidiManager(src);
        expect(manager.listLibrariesSync()).toEqual([
            { id: "lib_a", name: "精选" },
            { id: "lib_b", name: "流行" },
        ]);
        expect((await manager.page(1, 10, undefined, "lib_a")).items.map((i) => i.id)).toEqual(["s1"]);
    });
});
