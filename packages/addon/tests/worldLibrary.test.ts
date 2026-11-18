import { beforeEach, describe, expect, mock, test } from "bun:test";
import { encodePbe3, worldPublicId } from "@piano/core";

const properties = new Map<string, string>();
const stats = { ids: 0, get: 0, set: 0 };

mock.module("@minecraft/server", () => ({
    world: {
        getDynamicPropertyIds: () => {
            stats.ids++;
            return [...properties.keys()];
        },
        getDynamicProperty: (key: string) => {
            stats.get++;
            return properties.get(key);
        },
        setDynamicProperty: (key: string, value?: string) => {
            stats.set++;
            if (value === undefined) properties.delete(key);
            else properties.set(key, value);
        },
    },
}));

const { WorldMusicLibrary } = await import("../src/platform/storage/worldLibrary");

function music(id: string, name: string, note = 60): Uint8Array {
    return encodePbe3({
        id,
        name,
        duration: 40,
        tracks: [{ instrument: { family: "", number: 0, name: "" }, notes: [note, 0, 20, 90] }],
    });
}

beforeEach(() => {
    properties.clear();
    stats.ids = 0;
    stats.get = 0;
    stats.set = 0;
});

describe("世界全局曲库", () => {
    test("导入后可查询/分页/读取，重新加载后仍存在", async () => {
        const library = new WorldMusicLibrary();
        library.reload();
        library.save(music("g1", "晴天"));
        library.save(music("g2", "夜曲"));
        library.save(music("g3", "稻香"));

        const firstPage = library.pageSync(1, 2);
        const secondPage = library.pageSync(2, 2);
        expect(firstPage.total).toBe(3);
        expect(firstPage.items).toHaveLength(2);
        expect(secondPage.items).toHaveLength(1);
        expect([...firstPage.items, ...secondPage.items].map(meta => meta.id).sort())
            .toEqual(["g1", "g2", "g3"]);
        expect(library.pageSync(1, 5, "晴").items.map(meta => meta.name)).toEqual(["晴天"]);
        expect(library.entry("g1")?.name).toBe("晴天");
        expect(await library.get("g2")).toEqual(music("g2", "夜曲"));

        const restarted = new WorldMusicLibrary();
        restarted.reload();
        expect(restarted.list().map(meta => meta.id).sort()).toEqual(["g1", "g2", "g3"]);
        expect(await restarted.get("g3")).toEqual(music("g3", "稻香"));
    });

    test("搜索/分页/按 ID 查询只使用内存索引，不扫描动态属性", () => {
        const library = new WorldMusicLibrary();
        library.reload();
        library.save(music("g1", "晴天"));
        library.save(music("g2", "夜曲"));

        stats.ids = 0;
        library.pageSync(1, 5, "晴");
        library.metaAllSync("夜");
        library.entry("g1");
        library.has("g2");
        library.usage();
        expect(stats.ids).toBe(0);
    });

    test("非法 PBE2 被拒绝，不留下目录记录", () => {
        const library = new WorldMusicLibrary();
        library.reload();
        expect(() => library.save(new Uint8Array([1, 2, 3]))).toThrow();
        expect(library.list()).toHaveLength(0);
    });

    test("同 id 同内容幂等，同 id 不同内容拒绝覆盖", () => {
        const library = new WorldMusicLibrary();
        library.reload();
        const first = library.save(music("same", "第一版", 60));
        expect(library.save(music("same", "第一版", 60)).checksum).toBe(first.checksum);
        expect(library.list()).toHaveLength(1);

        expect(() => library.save(music("same", "第二版", 64))).toThrow(/ID 冲突/);
        expect(library.entry("same")?.name).toBe("第一版");
        expect(library.list()).toHaveLength(1);
    });

    test("删除后索引与持久化目录同步，孤儿分片被清理", () => {
        const library = new WorldMusicLibrary();
        library.reload();
        library.save(music("g1", "晴天"));
        expect(library.remove("g1")).toBe(true);
        expect(library.list()).toHaveLength(0);
        expect(properties.size).toBe(0);

        library.reload();
        expect(library.list()).toHaveLength(0);
        expect(library.remove("missing")).toBe(false);
    });

    test("公开索引使用世界命名空间，但管理员管理仍使用原始 ID", async () => {
        const library = new WorldMusicLibrary();
        library.reload();
        library.save(music("same", "世界曲目"));
        const publicId = worldPublicId("same");
        expect(library.entry("same")?.id).toBe("same");
        expect(library.publicSource.list().map(meta => meta.id)).toEqual([publicId]);
        expect((await library.publicSource.page(1, 5)).items[0].id).toBe(publicId);
        expect((await library.publicSource.metaAll())[0].id).toBe(publicId);
        expect(await library.publicSource.get(publicId)).toEqual(music("same", "世界曲目"));
        expect(await library.publicSource.get("same")).toBeUndefined();
    });
});
