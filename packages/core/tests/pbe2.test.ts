import { describe, expect, it } from "vitest";
import {
    EventCursor,
    ImportAssembler,
    PianoBinaryCodec,
    SongCache,
    buildSeekIndex,
    collectNoteCount,
    decodeBase64Url,
    decodeUtf8,
    encodeBase64Url,
    encodePbe2,
    encodeUtf8,
    parseImportChunk,
    planImportChunks,
    readAllPbe2Notes,
    readPbe2Events,
    readPbe2Header,
    type MidiSong,
} from "../src/index.js";

const song: MidiSong = {
    id: "abc12345",
    name: "测试曲目",
    duration: 40 * 30,
    tracks: [
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [60, 0, 100, 90, 64, 800, 100, 80, 67, 1600, 50, 70],
        },
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [48, 400, 120, 60, 72, 800, 100, 50],
        },
    ],
};

describe("PBE2 编解码", () => {
    it("按时间合并轨道、稳定排序，并可无损读取事件", () => {
        const pbe2 = encodePbe2(song);
        const header = readPbe2Header(pbe2);
        expect(header.id).toBe(song.id);
        expect(header.name).toBe(song.name);
        expect(header.duration).toBe(song.duration);
        expect(header.noteCount).toBe(collectNoteCount(song));

        const notes = readAllPbe2Notes(readPbe2Events(pbe2).events);
        expect(notes.map((note) => [note.midi, note.time, note.duration])).toEqual([
            [60, 0, 100],
            [48, 400, 120],
            [64, 800, 100],
            [72, 800, 100],
            [67, 1600, 50],
        ]);
    });

    it("体积较小时按 auto 策略保留未压缩事件流", () => {
        const pbe2 = encodePbe2(song);
        const header = readPbe2Header(pbe2);
        expect(header.compressed).toBe(false);
        expect(header.uncompressedLength).toBe(pbe2.length - header.eventOffset);
        expect(readPbe2Events(pbe2).events.length).toBe(header.uncompressedLength);
    });

    it("重复事件流会被 DEFLATE 压缩", () => {
        const large = encodePbe2({
            ...song,
            tracks: [{
                instrument: song.tracks[0].instrument,
                notes: Array.from({ length: 5000 }, (_, index) => [60, index * 2, 100, 90]).flat(),
            }],
        });
        expect(readPbe2Header(large).compressed).toBe(true);
    });

    it("校验和/长度被篡改时拒绝加载", () => {
        const pbe2 = encodePbe2(song, { compress: false });
        const header = readPbe2Header(pbe2);
        pbe2[header.eventOffset + 1] ^= 0xff;
        expect(() => readPbe2Events(pbe2)).toThrow(/校验失败/);
    });

    it("Base64URL 往返（含所有余数）", () => {
        for (let length = 0; length < 40; length++) {
            const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
            expect(Array.from(decodeBase64Url(encodeBase64Url(bytes)))).toEqual(Array.from(bytes));
        }
    });

    it("纯 JS UTF-8 往返（中文/emoji/孤立代理项）", () => {
        for (const text of ["测试曲目", "Beyond - 海阔天空", "🎹 Piano", "\ud800"]) {
            expect(decodeUtf8(encodeUtf8(text))).toBe(text === "\ud800" ? "\ufffd" : text);
        }
    });

    it("PianoBinaryCodec 对外入口保持一致", () => {
        const pbe2 = PianoBinaryCodec.encode(song);
        expect(PianoBinaryCodec.decode(pbe2).name).toBe(song.name);
    });
});

describe("EventCursor 与稀疏索引", () => {
    it("顺序读取与 seek 后从目标时刻继续", () => {
        const pbe2 = encodePbe2({
            ...song,
            duration: 40 * 60,
            tracks: [{
                instrument: song.tracks[0].instrument,
                notes: Array.from({ length: 120 }, (_, index) => [
                    60 + (index % 12),
                    index * 40 * 2,
                    100,
                    90,
                ]).flat(),
            }],
        });
        const { header, events } = readPbe2Events(pbe2);
        const index = buildSeekIndex(events, header.hasVelocity);
        expect(index.length).toBeGreaterThan(3);

        const cursor = new EventCursor(events, index, header.hasVelocity);
        expect(cursor.peekTime()).toBe(0);
        expect(cursor.next()?.midi).toBe(60);

        cursor.seek(40 * 30);
        const next = cursor.next();
        expect(next?.time).toBe(40 * 30);
        expect(next?.midi).toBe(60 + (15 % 12));
        expect(cursor.noteIndex).toBe(16);
    });

    it("seek 到末尾后 done 为 true", () => {
        const pbe2 = encodePbe2(song);
        const { header, events } = readPbe2Events(pbe2);
        const cursor = new EventCursor(events, buildSeekIndex(events), header.hasVelocity);
        cursor.seek(10_000);
        while (!cursor.done) cursor.next();
        expect(cursor.done).toBe(true);
    });
});

describe("SongCache", () => {
    it("同一首歌只加载一次，并被多个句柄共享", async () => {
        const pbe2 = encodePbe2(song);
        let loads = 0;
        const cache = new SongCache(async () => {
            loads++;
            return pbe2;
        });
        const [a, b] = await Promise.all([cache.acquire(song.id), cache.acquire(song.id)]);
        expect(loads).toBe(1);
        expect(a?.song).toBe(b?.song);
        a?.release();
        b?.release();
        expect(cache.size).toBe(1);
    });

    it("LRU 只淘汰无活跃引用的曲目", async () => {
        const a = encodePbe2(song);
        const b = encodePbe2({ ...song, id: "bbb", name: "B", duration: 100 });
        const cache = new SongCache(async (id) => (id === song.id ? a : b), {
            maxBytes: a.length + b.length - 1,
            now: (() => {
                let tick = 0;
                return () => ++tick;
            })(),
        });
        const handle = await cache.acquire(song.id);
        await cache.acquire("bbb");
        expect(cache.size).toBe(2); // first still referenced
        handle?.release();
        expect(cache.size).toBe(1); // over budget, unused first evicted
    });

    it("加载失败不留下半成品，且返回 undefined", async () => {
        const cache = new SongCache(async () => new Uint8Array([1, 2, 3]));
        expect(await cache.acquire("bad")).toBeUndefined();
        expect(cache.size).toBe(0);
    });
});

describe("DDUI 分段导入码", () => {
    it("分段长度受限，乱序/重复/缺段提示，完成后还原 PBE2", () => {
        const pbe2 = encodePbe2({
            ...song,
            tracks: [{
                instrument: song.tracks[0].instrument,
                notes: Array.from({ length: 6000 }, (_, index) => [60, index * 2, 10, 90]).flat(),
            }],
        }, { compress: false });
        const chunks = planImportChunks(pbe2, 4800);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(4800);
        expect(parseImportChunk(chunks[0])?.index).toBe(1);

        const assembler = new ImportAssembler();
        const progress = assembler.add(chunks[1]);
        expect(progress.status).toBe("accepted");
        expect(progress.missing).toContain(1);
        expect(assembler.add(chunks[1]).status).toBe("duplicate");

        let result = assembler.add(chunks[0]);
        for (let i = 2; i < chunks.length - 1; i++) result = assembler.add(chunks[i]);
        result = assembler.add(chunks[chunks.length - 1]);
        expect(result.status).toBe("complete");
        expect(Array.from(result.payload ?? [])).toEqual(Array.from(pbe2));
    });

    it("损坏的分段被拒绝，非本协议文本被忽略", () => {
        const chunks = planImportChunks(encodePbe2(song));
        const broken = chunks[0].slice(0, -4) + "AAAA";
        expect(parseImportChunk(broken)).toBeUndefined();
        const assembler = new ImportAssembler();
        expect(assembler.add("hello").status).toBe("ignored");
    });
});
