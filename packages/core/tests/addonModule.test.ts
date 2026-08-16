import { describe, expect, it } from "vitest";
import { metasToAddonIndex, songToAddonModule } from "../src/index.js";
import type { MidiSong } from "../src/index.js";

const song: MidiSong = {
    id: "abc123",
    name: "测试曲",
    duration: 14007,
    tracks: [
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [60, 0, 50, 100, 61, 7, 120, 90],
        },
        {
            instrument: { family: "piano", number: 0, name: "acoustic grand piano" },
            notes: [],
        },
    ],
};

describe("addonModule", () => {
    it("单曲模块文本与历史格式一致", () => {
        expect(songToAddonModule(song)).toBe(
            'export default {id:"abc123",name:"测试曲",duration:14007,tracks:' +
                '[{instrument:{"family":"piano","number":0,"name":"acoustic grand piano"},notes:new Uint16Array([60,0,50,100,61,7,120,90])},' +
                '{instrument:{"family":"piano","number":0,"name":"acoustic grand piano"},notes:new Uint16Array([])}]};'
        );
    });

    it("空曲库 index 文本", () => {
        expect(metasToAddonIndex([])).toBe("export const midis=[];");
    });

    it("index 文本逐条匹配历史格式（懒加载 value）", () => {
        const text = metasToAddonIndex([
            { id: "aaa", name: "A", duration: 100 },
            { id: "bbb", name: "B", duration: 200 },
        ]);
        expect(text).toBe(
            'export const midis=[' +
                '{id:"aaa",name:"A",duration:100,value:async()=> (await import("./aaa.js")).default},' +
                '{id:"bbb",name:"B",duration:200,value:async()=> (await import("./bbb.js")).default},' +
                '];'
        );
    });
});