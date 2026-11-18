import { describe, expect, it } from "vitest";
import {
    ImportAssembler,
    encodePbe3,
    parseImportChunk,
    planImportChunks,
    type MidiSong,
} from "../src/index.js";

const song: MidiSong = {
    id: "abc12345",
    name: "测试曲目",
    duration: 40 * 30,
    tracks: [
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [60, 0, 100, 90],
        },
    ],
};

describe("DDUI 分段导入码", () => {
    it("分段长度受限，乱序/重复/缺段提示，完成后还原 PBE3", () => {
        const pbe3 = encodePbe3(
            {
                ...song,
                tracks: [
                    {
                        instrument: song.tracks[0].instrument,
                        notes: Array.from({ length: 6000 }, (_, index) => [60, index * 2, 10, 90]).flat(),
                    },
                ],
            },
            { compress: false }
        );
        const chunks = planImportChunks(pbe3, 4800);
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
        expect(Array.from(result.payload ?? [])).toEqual(Array.from(pbe3));
    });

    it("损坏的分段被拒绝，非本协议文本被忽略", () => {
        const chunks = planImportChunks(encodePbe3(song));
        const broken = chunks[0].slice(0, -4) + "AAAA";
        expect(parseImportChunk(broken)).toBeUndefined();
        const assembler = new ImportAssembler();
        expect(assembler.add("hello").status).toBe("ignored");
    });
});
