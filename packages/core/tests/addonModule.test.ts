import { describe, expect, it } from "vitest";
import {
    decodeBase64Url,
    encodePbe2,
    metasToAddonIndex,
    pbe2ToAddonModule,
    readPbe2Header,
    type MidiSong,
} from "../src/index.js";

const song: MidiSong = {
    id: "abc123",
    name: "测试曲目",
    duration: 14007,
    tracks: [
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [60, 0, 50, 100, 61, 7, 120, 90],
        },
    ],
};

describe("addonModule", () => {
    it("单曲模块只保存 PBE2 的 Base64URL 数据", () => {
        const pbe2 = encodePbe2(song);
        const text = pbe2ToAddonModule(pbe2);
        expect(text.startsWith('export default "')).toBe(true);
        const encoded = JSON.parse(text.slice("export default ".length).replace(/;$/, "")) as string;
        const decoded = decodeBase64Url(encoded);
        expect(readPbe2Header(decoded).id).toBe(song.id);
        expect(decoded.length).toBe(pbe2.length);
    });

    it("生成索引文本", () => {
        expect(metasToAddonIndex([])).toBe("export const midis=[];");
    });

    it("index 文本仍保持模块懒加载结构", () => {
        const text = metasToAddonIndex([
            { id: "aaa", name: "A", duration: 100 },
            { id: "bbb", name: "B", duration: 200 },
        ]);
        expect(text).toBe(
            "export const midis=[" +
                '{id:"aaa",name:"A",duration:100,value:async()=> (await import("./aaa.js")).default},' +
                '{id:"bbb",name:"B",duration:200,value:async()=> (await import("./bbb.js")).default},' +
                "];"
        );
    });
});
