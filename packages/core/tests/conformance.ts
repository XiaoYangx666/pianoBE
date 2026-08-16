import type { PlaylistPort, SongPort, PlaylistMeta, MidiSong } from "../src/index.js";

/**
 * 存储端口契约用例：任何驱动（内存/SQLite/游戏内动态属性）都必须通过。
 * 框架无关：返回 { name, fn } 用例列表，由 vitest / bun test 各自适配。
 * 覆盖：单记录原子语义、派生全扫、幂等删除、返回值副本语义、崩溃残留自愈。
 */

export interface ConformanceCase {
    name: string;
    fn: () => void;
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg}\n实际: ${a}\n期望: ${e}`);
}

export function songPortCases(make: () => SongPort): ConformanceCase[] {
    const song: MidiSong = {
        id: "aaa",
        name: "A",
        duration: 100,
        tracks: [{ instrument: { family: "piano", number: 0, name: "x" }, notes: [60, 0, 50, 100] }],
    };
    return [
        {
            name: "add + getMeta/getSong/has",
            fn() {
                const p = make();
                assert(p.has("aaa") === false, "初始不应存在");
                p.add(song);
                assert(p.has("aaa") === true, "add 后应存在");
                eq(p.getMeta("aaa"), { id: "aaa", name: "A", duration: 100 }, "getMeta 元信息");
                eq(p.getSong("aaa")?.tracks[0].notes, [60, 0, 50, 100], "getSong 音符数据");
            },
        },
        {
            name: "同 id 幂等写入（内容寻址：重复 add 不产生重复记录）",
            fn() {
                const p = make();
                p.add(song);
                p.add(song);
                eq(p.listMetas().length, 1, "重复 add 后仍只有一条");
            },
        },
        {
            name: "remove 后不可见",
            fn() {
                const p = make();
                p.add(song);
                p.remove("aaa");
                assert(p.has("aaa") === false, "remove 后 has=false");
                assert(p.getMeta("aaa") === undefined, "remove 后 getMeta=undefined");
                assert(p.getSong("aaa") === undefined, "remove 后 getSong=undefined");
                eq(p.listMetas().length, 0, "remove 后 list 为空");
            },
        },
    ];
}

export function playlistPortCases(make: () => PlaylistPort): ConformanceCase[] {
    function meta(id: number, owner = "o1"): PlaylistMeta {
        return { id, owner, name: `n${id}`, public: false, playCount: 0, createdAt: id, updatedAt: id };
    }
    return [
        {
            name: "setMeta/getMeta/listAllMetas 主记录读写（返回副本）",
            fn() {
                const p = make();
                p.setMeta(meta(1));
                eq(p.getMeta(1), meta(1), "getMeta 返回写入值");
                eq(p.listAllMetas(), [meta(1)], "listAllMetas 全扫");
                const got = p.getMeta(1)!;
                got.name = "changed";
                eq(p.getMeta(1)!.name, "n1", "外部变更不污染存储");
            },
        },
        {
            name: "setContent 整体替换（原子）；getContent 返回副本",
            fn() {
                const p = make();
                p.setMeta(meta(1));
                p.setContent(1, ["a", "b"]);
                const arr = p.getContent(1);
                arr.push("c");
                eq(p.getContent(1), ["a", "b"], "副本变更不落库");
                p.setContent(1, ["z"]);
                eq(p.getContent(1), ["z"], "整体替换生效");
            },
        },
        {
            name: "deletePlaylist 幂等，删除后 meta/content 均无残留",
            fn() {
                const p = make();
                p.setMeta(meta(5));
                p.setContent(5, ["a"]);
                p.deletePlaylist(5);
                p.deletePlaylist(5); // 再次删除不抛错
                assert(p.getMeta(5) === undefined, "meta 已删除");
                eq(p.getContent(5), [], "content 已删除");
                eq(p.listAllMetas().length, 0, "全扫为空");
            },
        },
        {
            name: "崩溃残留自愈：只有 content 没有 meta 时不可见，delete 幂等清理",
            fn() {
                const p = make();
                p.setContent(99, ["a"]); // 模拟 create 中途崩溃
                eq(p.listAllMetas(), [], "孤儿 content 不出现在全扫");
                p.deletePlaylist(99);
                eq(p.getContent(99), [], "幂等清理");
            },
        },
    ];
}