import { describe, expect, test } from "vitest";
import {
    MusicCollection,
    attachSongPerformance,
    computeMusicFingerprint,
    encodeSong,
    mergeSongCatalog,
    normalizeMusicRef,
    rebuildContentIndex,
    reidentifySong,
    renameSong,
    sameMusicRef,
    type CatalogSongCandidate,
    type MidiSong,
    type MusicStorageKv,
    type PerformanceCue,
} from "../src/index.js";

function sampleSong(id: string, name: string, noteOffset = 0): MidiSong {
    return {
        id,
        name,
        duration: 160,
        tracks: [
            {
                instrument: { family: "piano", number: 0, name: "Acoustic Grand Piano" },
                notes: [
                    60 + noteOffset, 0, 50, 96,
                    64 + noteOffset, 20, 50, 88,
                    67 + noteOffset, 40, 50, 100,
                ],
            },
        ],
    };
}

const CUE_A: readonly PerformanceCue[] = [
    { tick: 0, op: "set", effect: "starfield", color: "#8EB8FF", level: 80, scale: 100, fade: 20 },
];

const CUE_B: readonly PerformanceCue[] = [
    { tick: 0, op: "set", effect: "chinese_mist", color: "#6FF2C7", level: 90, scale: 110, fade: 20 },
];

const CUE_B_UPDATED: readonly PerformanceCue[] = [
    { tick: 0, op: "set", effect: "chinese_mist", color: "#68E4FF", level: 95, scale: 115, fade: 24 },
];

class MemoryKv implements MusicStorageKv {
    private readonly map = new Map<string, string>();
    keys(): string[] { return [...this.map.keys()]; }
    get(key: string): string | undefined { return this.map.get(key); }
    set(key: string, value: string): void { this.map.set(key, value); }
    delete(key: string): void { this.map.delete(key); }
}

describe("核心领域模型：指纹、合并规则与稳定演出", () => {
    test("computeMusicFingerprint 不受歌名、ID、压缩和演出影响", () => {
        const raw = encodeSong(sampleSong("aaaa1111", "青花瓷"), { compress: true });
        const renamed = renameSong(raw, "青花瓷（重置版）");
        const reid = reidentifySong(renamed, "bbbb2222");
        const withPerf = attachSongPerformance(reid, CUE_A);
        const uncompressed = encodeSong(sampleSong("cccc3333", "另一个名字"), { compress: false });
        const different = encodeSong(sampleSong("aaaa1111", "青花瓷", 2));

        const fp = computeMusicFingerprint(raw);
        expect(fp).toMatch(/^[0-9a-f]{16}$/);
        expect(computeMusicFingerprint(renamed)).toBe(fp);
        expect(computeMusicFingerprint(reid)).toBe(fp);
        expect(computeMusicFingerprint(withPerf)).toBe(fp);
        expect(computeMusicFingerprint(uncompressed)).toBe(fp);
        expect(computeMusicFingerprint(different)).not.toBe(fp);
    });

    test("mergeSongCatalog 完整遵循 3.3 合并与冲突规则", () => {
        const baseBytes = encodeSong(sampleSong("f3b8fb2", "青花瓷"));
        const base: CatalogSongCandidate = {
            id: "f3b8fb2",
            name: "青花瓷",
            duration: 160,
            noteCount: 3,
            data: baseBytes,
            libraries: ["official"],
            origin: { kind: "official", id: "official", name: "官方曲库" },
        };

        // 1 & 2. 名称不同但音乐相同 -> 共用音乐本体，保留别名与来源
        const aliasBytes = renameSong(reidentifySong(baseBytes, "11112222"), "Blue and White Porcelain");
        const aliasSong: CatalogSongCandidate = {
            id: "11112222",
            name: "Blue and White Porcelain",
            duration: 160,
            noteCount: 3,
            data: aliasBytes,
            libraries: ["user-1"],
            origin: { kind: "user", id: "user-1", name: "我的曲库" },
        };
        const r1 = mergeSongCatalog([base], [aliasSong]);
        expect(r1.conflicts).toHaveLength(0);
        expect(r1.songs).toHaveLength(1);
        expect(r1.songs[0].id).toBe("f3b8fb2");
        expect(r1.songs[0].aliases).toContain("Blue and White Porcelain");
        expect(r1.songs[0].libraries).toEqual(["official", "user-1"]);

        // 3. 名称相同但音乐不同（且同 ID）-> 报告冲突，不静默覆盖
        const diffMusicSameId = encodeSong(sampleSong("f3b8fb2", "青花瓷", 3));
        const r2 = mergeSongCatalog(r1.songs, [{
            id: "f3b8fb2",
            name: "青花瓷",
            duration: 160,
            noteCount: 3,
            data: diffMusicSameId,
        }]);
        expect(r2.conflicts).toHaveLength(1);
        expect(r2.conflicts[0].kind).toBe("id_content_mismatch");
        expect(r2.songs).toHaveLength(1);

        // 3b. 名称相同、ID 不同、音乐不同 -> 作为不同版本保留
        const diffMusicDiffId = encodeSong(sampleSong("dddd4444", "青花瓷", 3));
        const r3 = mergeSongCatalog(r1.songs, [{
            id: "dddd4444",
            name: "青花瓷",
            duration: 160,
            noteCount: 3,
            data: diffMusicDiffId,
        }]);
        expect(r3.conflicts).toHaveLength(0);
        expect(r3.songs).toHaveLength(2);

        // 4, 5, 6, 7. 多演出合并、同编排去重、同插件更新、跨插件并存
        const perfChinese: CatalogSongCandidate = {
            id: "f3b8fb2",
            name: "青花瓷",
            duration: 160,
            noteCount: 3,
            data: baseBytes,
            origin: { kind: "plugin", id: "pianobe.chinese", name: "PianoBE 国风" },
            performanceEntries: [{
                id: "pianobe.chinese:rain_green",
                name: "雨过见青",
                cues: CUE_B,
                origin: { kind: "plugin", id: "pianobe.chinese" },
            }],
        };
        const perfThirdParty: CatalogSongCandidate = {
            id: "99998888",
            name: "青花瓷",
            duration: 160,
            noteCount: 3,
            data: reidentifySong(baseBytes, "99998888"),
            origin: { kind: "plugin", id: "third.starry", name: "星空演出" },
            performanceEntries: [{
                id: "third.starry:starry",
                name: "星空演出",
                cues: CUE_A,
                origin: { kind: "plugin", id: "third.starry" },
            }],
        };
        const perfDuplicate: CatalogSongCandidate = {
            id: "77776666",
            name: "青花瓷",
            duration: 160,
            noteCount: 3,
            data: reidentifySong(baseBytes, "77776666"),
            origin: { kind: "plugin", id: "other.dup" },
            performanceEntries: [{
                id: "other.dup:copy",
                name: "重复演出",
                cues: CUE_A,
                origin: { kind: "plugin", id: "other.dup" },
            }],
        };
        const r4 = mergeSongCatalog(r1.songs, [perfChinese, perfThirdParty, perfDuplicate]);
        expect(r4.songs[0].performanceEntries?.map((p) => p.id)).toEqual([
            "pianobe.chinese:rain_green",
            "third.starry:starry",
        ]);

        // 同插件按稳定 ID 更新已有演出
        const r5 = mergeSongCatalog(r4.songs, [{
            ...perfChinese,
            performanceEntries: [{
                id: "pianobe.chinese:rain_green",
                name: "雨过见青 v2",
                cues: CUE_B_UPDATED,
                origin: { kind: "plugin", id: "pianobe.chinese" },
            }],
        }]);
        const updatedPerf = r5.songs[0].performanceEntries?.find((p) => p.id === "pianobe.chinese:rain_green");
        expect(updatedPerf?.name).toBe("雨过见青 v2");
        expect(updatedPerf?.cues?.[0].color).toBe("#68E4FF");
    });

    test("rebuildContentIndex 模拟插件卸载后自动清理编排但保留仍在其他来源的歌曲", () => {
        const baseBytes = encodeSong(sampleSong("f3b8fb2", "青花瓷"));
        const official = {
            songs: [{
                id: "f3b8fb2",
                name: "青花瓷",
                duration: 160,
                noteCount: 3,
                data: baseBytes,
                origin: { kind: "official" as const, id: "official" },
            }],
            libraries: [{ id: "official", name: "官方曲库", kind: "official" as const, songIds: ["f3b8fb2"] }],
        };
        const chinese = {
            songs: [{
                id: "f3b8fb2",
                name: "青花瓷",
                duration: 160,
                noteCount: 3,
                data: baseBytes,
                origin: { kind: "plugin" as const, id: "pianobe.chinese" },
                performanceEntries: [{ id: "pianobe.chinese:rain_green", name: "雨过见青", cues: CUE_B }],
            }],
        };
        const starry = {
            songs: [{
                id: "f3b8fb2",
                name: "青花瓷",
                duration: 160,
                noteCount: 3,
                data: baseBytes,
                origin: { kind: "plugin" as const, id: "third.starry" },
                performanceEntries: [{ id: "third.starry:starry", name: "星空演出", cues: CUE_A }],
            }],
        };

        const full = rebuildContentIndex([official, chinese, starry]);
        expect(full.songs).toHaveLength(1);
        expect(full.songs[0].performanceEntries).toHaveLength(2);

        // 卸载 pianobe.chinese 后重建索引：歌曲保留，只剩 starry 演出
        const afterUninstall = rebuildContentIndex([official, starry]);
        expect(afterUninstall.songs).toHaveLength(1);
        expect(afterUninstall.songs[0].performanceEntries?.map((p) => p.id)).toEqual(["third.starry:starry"]);
    });

    test("MusicRef 兼容稳定 performanceId 与旧版数值索引", () => {
        const plainById = normalizeMusicRef({ source: "library", id: "abc", name: "test", duration: 100, performanceId: "plain" });
        const plainByNum = normalizeMusicRef({ source: "library", id: "abc", name: "test", duration: 100, performance: -1 });
        expect(plainById?.performanceId).toBe("plain");
        expect(sameMusicRef(plainById!, plainByNum!)).toBe(true);

        const p1 = normalizeMusicRef({ source: "library", id: "abc", name: "test", duration: 100, performanceId: "perf_a" });
        const p2 = normalizeMusicRef({ source: "library", id: "abc", name: "test", duration: 100, performanceId: "perf_b" });
        expect(sameMusicRef(p1!, p2!)).toBe(false);
    });

    test("MusicCollection 支持命名演出写入与读取", () => {
        const kv = new MemoryKv();
        const col = new MusicCollection(kv, "pb.test.", () => 64 * 1024);
        const base = encodeSong(sampleSong("f3b8fb2", "青花瓷"));
        const p1 = attachSongPerformance(base, CUE_A);
        const p2 = attachSongPerformance(base, CUE_B);

        col.save(p1, "青花瓷");
        col.save(p2, undefined, { id: "pianobe.chinese:rain_green", name: "雨过见青", author: "PianoBE" });

        const entries = col.getPerformanceEntries("f3b8fb2");
        expect(entries).toHaveLength(1);
        expect(entries[0].id).toBe("pianobe.chinese:rain_green");
        expect(entries[0].name).toBe("雨过见青");
        expect(entries[0].author).toBe("PianoBE");
        expect(col.getPerformances("f3b8fb2")).toHaveLength(1);
    });
});
