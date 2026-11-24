import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const readJson = (relative: string) =>
    JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

const songs = readJson("../../../midis/library/index.json") as Array<{ id: string; name: string }>;
const genres = readJson("../../../midis/library/genres.json") as Record<string, string>;
const idByName = new Map(songs.map((song) => [String(song.name), song.id]));
const GENRES = ["game", "anime-film", "jay-chou", "chinese-pop", "western", "classical"];

function genreOf(name: string): string | undefined {
    const id = idByName.get(name);
    return id ? genres[id] : undefined;
}

describe("官方曲库人工分类表", () => {
    test("覆盖所有曲目且没有多余条目", () => {
        const songIds = new Set(songs.map((song) => song.id));
        expect(songs.length).toBeGreaterThan(600);
        for (const song of songs) {
            expect(genres[song.id]).toBeDefined();
            expect(GENRES).toContain(genres[song.id]);
        }
        for (const id of Object.keys(genres)) {
            expect(songIds.has(id)).toBe(true);
        }
    });

    test("仙剑奇侠传及电视剧原声归入影视动漫", () => {
        expect(genreOf("阿桑 - 一直很安静")).toBe("anime-film");
        expect(genreOf("仙剑奇侠传 - 偏爱")).toBe("anime-film");
        expect(genreOf("仙剑奇侠传 杀破狼")).toBe("anime-film");
        expect(genreOf("麦振鸿 - 仙剑奇缘")).toBe("anime-film");
        expect(genreOf("胡歌 - 六月的雨")).toBe("anime-film");
        expect(genreOf("青鸟飞鱼 - 此生不换")).toBe("anime-film");
        expect(genreOf("张芸京 - 偏爱")).toBe("anime-film");
        expect(genreOf("吴雨霏 - 生生世世爱")).toBe("anime-film");
    });

    test("游戏主题曲归入游戏", () => {
        expect(genreOf("魔兽世界 - 主题曲")).toBe("game");
        expect(genreOf("文明6 - 主题曲")).toBe("game");
        expect(genreOf("巫师3 - 主题曲")).toBe("game");
        expect(genreOf("上古卷轴5 - Dragonborn")).toBe("game");
        expect(genreOf("女神异闻录5 Life Will Change")).toBe("game");
    });

    test("古典钢琴不会混进影视动漫", () => {
        expect(genreOf("肖邦 夜曲 Op.9 No.2")).toBe("classical");
        expect(genreOf("石进 - 夜的钢琴曲五")).toBe("classical");
        expect(genreOf("Yiruma River Flows in You")).toBe("classical");
    });

    test("英文歌不会被宽松规则误判", () => {
        expect(genreOf("Ed Sheeran Photograph")).toBe("western");
        expect(genreOf("Evanescence My Immortal")).toBe("western");
        expect(genreOf("Taylor Swift Cruel Summer")).toBe("western");
    });

    test("华语流行不会被单字标题抢走", () => {
        expect(genreOf("陈奕迅 - 孤勇者")).toBe("chinese-pop");
        expect(genreOf("大张伟 - 阳光彩虹小白马")).toBe("chinese-pop");
        expect(genreOf("李克勤 - 月半小夜曲")).toBe("chinese-pop");
        expect(genreOf("周杰伦 - 夜曲")).toBe("jay-chou");
        expect(genreOf("晴天 - 钢琴版2026")).toBe("jay-chou");
    });

    test("日系动画歌曲归入影视动漫", () => {
        expect(genreOf("Aimer - 残響散歌")).toBe("anime-film");
        expect(genreOf("米津玄师 - Lemon")).toBe("anime-film");
        expect(genreOf("宇多田光 First Love")).toBe("anime-film");
        expect(genreOf("YOASOBI - 群青")).toBe("anime-film");
    });
});
