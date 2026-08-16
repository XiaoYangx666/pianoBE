import { describe, expect, it } from "vitest";
import { packNotes, unpackNotes } from "../src/index.js";

describe("midi encoding", () => {
    it("打包为 Uint16Array 且值不变", () => {
        const quads = [60, 0, 50, 100, 61, 7, 120, 90];
        const packed = packNotes(quads);
        expect(packed).toBeInstanceOf(Uint16Array);
        expect([...packed]).toEqual(quads);
    });

    it("解包还原为普通数组", () => {
        const packed = new Uint16Array([60, 0, 50, 100]);
        expect(unpackNotes(packed)).toEqual([60, 0, 50, 100]);
    });

    it("往返一致", () => {
        const quads = [41, 0, 293, 75, 82, 29, 73, 75];
        expect(unpackNotes(packNotes(quads))).toEqual(quads);
    });

    it("空轨道往返", () => {
        expect(unpackNotes(packNotes([]))).toEqual([]);
    });
});