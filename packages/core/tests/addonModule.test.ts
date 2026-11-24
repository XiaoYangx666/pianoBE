import { describe, expect, it } from "vitest";
import {
    encodePbe3,
    metasToAddonIndex,
    pbe3ToAddonModule,
    readPbe3Header,
    type MidiSong,
} from "../src/index.js";
import { decodeBase64Url } from "../src/binary/base64url.js";

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
    it("单曲模块只保存 PBE3 的 Base64URL 数据", () => {
        const pbe3 = encodePbe3(song);
        const text = pbe3ToAddonModule(pbe3);
        expect(text.startsWith('export default "')).toBe(true);
        const encoded = JSON.parse(text.slice("export default ".length).replace(/;$/, "")) as string;
        const decoded = decodeBase64Url(encoded);
        expect(readPbe3Header(decoded).id).toBe(song.id);
        expect(decoded.length).toBe(pbe3.length);
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

    it("index 文本可携带歌曲详情元数据", () => {
        const text = metasToAddonIndex([
            { id: "ccc", name: "C", duration: 300, noteCount: 42, bytes: 1024 },
        ]);
        expect(text).toBe(
            "export const midis=[" +
                '{id:"ccc",name:"C",duration:300,noteCount:42,bytes:1024,value:async()=> (await import("./ccc.js")).default},' +
                "];"
        );
    });

    it("传入 libraries 时导出曲库列表，空数组时不额外输出", () => {
        expect(metasToAddonIndex([], [])).toBe("export const midis=[];");
        const withLibs = metasToAddonIndex(
            [{ id: "ccc", name: "C", duration: 300, libraries: ["lib_1"] }],
            [{ id: "lib_1", name: "精选曲库" }],
        );
        expect(withLibs).toContain('libraries:["lib_1"]');
        expect(withLibs).toContain('export const libraries=[{"id":"lib_1","name":"精选曲库"}];');
    });
});
