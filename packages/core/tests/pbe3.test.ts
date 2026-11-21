import { describe, expect, it } from "vitest";
import {
    PERFORMANCE_MOTIONS,
    PERFORMANCE_PALETTES,
    PERFORMANCE_ZONES,
    Pbe3EventCursor,
    attachSongPerformance,
    buildPbe3SeekIndex,
    crc32,
    decodePbe3,
    encodePbe3,
    encodePbe3Events,
    parsePerformanceRgb,
    pbe3ToNoteEvents,
    readAllPbe3Notes,
    readPbe3Events,
    readPbe3Header,
    renamePbe3,
    resolvePerformanceColor,
    velocityBitsFor,
    type MidiSong,
    type PerformanceCue,
    type PerformanceMotion,
    type PerformancePalette,
    type PerformanceZone,
} from "../src/index.js";

function song(notes: number[], keyDurations?: number[], duration = 400): MidiSong {
    return {
        id: "pbe3test",
        name: "PBE3 测试",
        duration,
        tracks: [
            {
                instrument: { family: "", number: 0, name: "" },
                notes,
                keyDurations,
            },
        ],
    };
}

describe("PBE3 performance section", () => {
    const cues: PerformanceCue[] = [
        { tick: 0, effect: "starfield", color: PERFORMANCE_PALETTES.moon, level: 75, scale: 100, op: "set", fade: 80 },
        { tick: 155, effect: "shockwave", color: "#FFE29A", level: 100, scale: 140, op: "flash" },
    ];

    it.each([false, true])("preserves the original song payload, compressed=%s", compress => {
        const original = song([60, 0, 100, 100, 64, 40, 200, 90], [40, 100]);
        const legacy = encodePbe3(original, { compress });
        const performance = attachSongPerformance(legacy, cues);
        const plain = readPbe3Events(legacy);
        const show = readPbe3Events(performance);
        expect(legacy[4]).toBe(1);
        expect(plain.header.performance).toBeUndefined();
        expect(performance[4]).toBe(3);
        expect(show.header.performance).toEqual(cues);
        // 6B header + 符号表 (1 + (1+9) + (1+9) = 21B) + 颜色表 (1 + 2*3 = 7B) + cue1 (7B) + cue2 (7B) = 48B
        expect(show.header.performanceBytes).toBe(48);
        expect(show.events).toEqual(plain.events);
        expect(performance.subarray(show.header.eventOffset)).toEqual(legacy.subarray(plain.header.eventOffset));
        expect(attachSongPerformance(performance, [])).toEqual(legacy);
        expect(attachSongPerformance(performance, cues)).toEqual(performance);
        expect(encodePbe3(decodePbe3(performance), { compress })).toEqual(performance);
        expect(readPbe3Header(renamePbe3(performance, "新曲名")).performance).toEqual(cues);
    });

    it("deduplicates symbol strings, colors, variants, brushes and roundtrips arbitrary effect names", () => {
        expect(resolvePerformanceColor("moon")).toBe("#8EB8FF");
        expect(resolvePerformanceColor("sakura")).toBe("#FFB7D5");
        expect(resolvePerformanceColor("#a1b2c3")).toBe("#A1B2C3");
        expect(resolvePerformanceColor("68e4ff")).toBe("#68E4FF");
        expect(parsePerformanceRgb("gold")).toEqual([255, 226, 154]);

        const effects = [
            "starfield", "wing_ribbons", "key_style", "shockwave", "future_aurora_v2", "custom-ribbon_01",
        ];
        const brushes = [undefined, "mote", "star", "blossom", "future_brush"];
        const variants = [undefined, "stardust", "snow", "glimmer", "none", "cinema", "custom_variant"];
        const zones = Object.keys(PERFORMANCE_ZONES) as PerformanceZone[];
        const motions = Object.keys(PERFORMANCE_MOTIONS) as PerformanceMotion[];
        const palettes = Object.keys(PERFORMANCE_PALETTES) as PerformancePalette[];

        const allCues: PerformanceCue[] = Array.from({ length: 18 }, (_, index) => {
            const effect = effects[index % effects.length];
            const brush = brushes[index % brushes.length];
            const variant = variants[index % variants.length];
            const zone = zones[index % zones.length];
            const motion = motions[index % motions.length];
            const slot = index % 8;
            const color = resolvePerformanceColor(palettes[index % palettes.length]);
            const color2 = index % 2 === 0 ? resolvePerformanceColor(palettes[(index + 5) % palettes.length]) : undefined;
            const cue: PerformanceCue = {
                tick: index * 15,
                effect,
                color,
                level: 40 + (index % 7) * 10,
                scale: 70 + (index % 10) * 10,
                ...(index % 4 === 3 ? { op: "flash" as const } : { op: "set" as const, fade: 20 }),
            };
            if (slot !== 0) cue.slot = slot;
            if (color2 !== undefined) cue.color2 = color2;
            if (brush !== undefined) cue.brush = brush;
            if (variant !== undefined) cue.variant = variant;
            if (zone !== "stage") cue.zone = zone;
            if (motion !== "normal") cue.motion = motion;
            return cue;
        });

        const encoded = attachSongPerformance(encodePbe3(song([60, 0, 100, 100], undefined, 600)), allCues);
        const decoded = readPbe3Header(encoded).performance!;
        expect(decoded).toEqual(allCues);
    });

    it("rejects malformed, unordered, invalid color/symbol/slot/space and out-of-range cues", () => {
        const legacy = encodePbe3(song([60, 0, 100, 100]));
        expect(() => attachSongPerformance(legacy, [...cues].reverse())).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], tick: 401 }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], color: "invalid" }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], color2: "invalid" }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], effect: "" }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], effect: "BadCase" }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], effect: "a".repeat(33) }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], brush: "1bad" }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], variant: "bad space" }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], slot: 8 }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], zone: "unknown" as any }])).toThrow();
        expect(() => attachSongPerformance(legacy, [{ ...cues[0], motion: "unknown" as any }])).toThrow();
        const performance = attachSongPerformance(legacy, cues);
        const crop = readPbe3Header(performance).eventOffset - 1;
        expect(() => readPbe3Header(performance.slice(0, crop))).toThrow();
        performance[crop] ^= 1;
        expect(() => readPbe3Header(performance)).toThrow(/CRC32/);
    });

    it("rejects legacy v2 files and corrupted symbol/space bytes", () => {
        const legacy = encodePbe3(song([60, 0, 100, 100, 64, 40, 100, 90], undefined, 400));
        const header = readPbe3Header(legacy);
        const payload = legacy.subarray(header.eventOffset);
        const buildWithSection = (version: number, section: Uint8Array) => {
            const out = new Uint8Array(header.eventOffset + 6 + section.length + payload.length);
            out.set(legacy.subarray(0, header.eventOffset), 0);
            out[4] = version;
            out[header.eventOffset] = section.length & 0xff;
            out[header.eventOffset + 1] = (section.length >>> 8) & 0xff;
            const sum = crc32(section);
            out[header.eventOffset + 2] = sum & 0xff;
            out[header.eventOffset + 3] = (sum >>> 8) & 0xff;
            out[header.eventOffset + 4] = (sum >>> 16) & 0xff;
            out[header.eventOffset + 5] = (sum >>> 24) & 0xff;
            out.set(section, header.eventOffset + 6);
            out.set(payload, header.eventOffset + 6 + section.length);
            return out;
        };

        // v2 is no longer supported
        expect(() => readPbe3Header(buildWithSection(2, new Uint8Array([1])))).toThrow(/版本不兼容/);

        // Invalid symbol index in cue
        const badSymSection = new Uint8Array([
            1, 1, 97, // symbolCount=1, "a"
            1, 255, 255, 255, // colorCount=1, #FFFFFF
            0, 0x80, 1, 80, 100, 0, // effectSym=1 (out of range)
        ]);
        expect(() => readPbe3Header(buildWithSection(3, badSymSection))).toThrow(/索引无效/);

        // Non-zero reserved bits in space byte
        const badSpaceSection = new Uint8Array([
            1, 1, 97, // symbolCount=1, "a"
            1, 255, 255, 255, // colorCount=1, #FFFFFF
            0, 0x88, 0, 80, 100, 0, 0x10, // FLAG_SPACE set, reserved bit 4 non-zero
        ]);
        expect(() => readPbe3Header(buildWithSection(3, badSpaceSection))).toThrow(/保留位/);
    });
});

describe("PBE3 力度调色板", () => {
    it("恒定力度使用 0 bit，不写索引位流", () => {
        const events = encodePbe3Events(song([60, 0, 100, 100, 64, 40, 100, 100]));
        expect(events.palette).toEqual([100]);
        expect(events.velocityBits).toBe(0);
        const decoded = decodePbe3(
            encodePbe3(song([60, 0, 100, 100, 64, 40, 100, 100]))
        );
        expect(decoded.tracks[0].notes).toEqual([60, 0, 100, 100, 64, 40, 100, 100]);
    });

    it("多个力度按升序去重，索引位数正确", () => {
        const events = encodePbe3Events(
            song([60, 0, 100, 30, 62, 40, 100, 90, 64, 80, 100, 30, 65, 120, 100, 60])
        );
        expect(events.palette).toEqual([30, 60, 90]);
        expect(events.velocityBits).toBe(2);
        expect(velocityBitsFor(1)).toBe(0);
        expect(velocityBitsFor(2)).toBe(1);
        expect(velocityBitsFor(3)).toBe(2);
        expect(velocityBitsFor(4)).toBe(2);
        expect(velocityBitsFor(5)).toBe(3);
        expect(velocityBitsFor(8)).toBe(3);
        expect(velocityBitsFor(9)).toBe(4);
        expect(velocityBitsFor(128)).toBe(7);

        const decoded = decodePbe3(encodePbe3(song(
            [60, 0, 100, 30, 62, 40, 100, 90, 64, 80, 100, 30, 65, 120, 100, 60]
        )));
        expect(decoded.tracks[0].notes.filter((_, i) => i % 4 === 3)).toEqual([30, 90, 30, 60]);
    });

    it("超过 8 个不同力度时收敛到 8 级", () => {
        const notes: number[] = [];
        for (let i = 0; i < 32; i++) notes.push(60, i * 40, 100, i * 4);
        const events = encodePbe3Events(song(notes));
        expect(events.palette).toHaveLength(8);
        expect(events.velocityBits).toBe(3);
        const decoded = decodePbe3(encodePbe3(song(notes)));
        const velocities = decoded.tracks[0].notes.filter((_, i) => i % 4 === 3);
        expect(new Set(velocities).size).toBeLessThanOrEqual(8);
    });

    it("头部保存调色板、位数和校验信息", () => {
        const data = encodePbe3(song([60, 0, 100, 30, 62, 40, 100, 90]), { compress: true });
        const header = readPbe3Header(data);
        expect(header.id).toBe("pbe3test");
        expect(header.name).toBe("PBE3 测试");
        expect(header.noteCount).toBe(2);
        expect(header.palette).toEqual([30, 90]);
        expect(header.velocityBits).toBe(1);
        expect(header.compressed).toBe(true);
        expect(header.byteLength).toBe(data.length);
        expect(readPbe3Events(data).events.length).toBe(header.uncompressedLength);
    });
});

describe("PBE3 安全性", () => {
    function varint(value: number): number[] {
        const out: number[] = [];
        let v = value >>> 0;
        while (v >= 0x80) {
            out.push((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        out.push(v);
        return out;
    }

    it("最低力度不会量化成 0（0 会被播放器当成静音）", () => {
        const decoded = decodePbe3(encodePbe3(song([60, 0, 100, 1])));
        expect(decoded.tracks[0].notes[3]).toBe(1);
    });

    it("超大的事件组音符数在分配前被拒绝", () => {
        // timeDelta = 0, noteCount = 1,000,000，后面没有音符数据
        const events = new Uint8Array([0, ...varint(1_000_000)]);
        expect(() => readAllPbe3Notes(events, [100], 0)).toThrow(/事件组音符数/);
    });

    it("保留标志位非 0 时拒绝解析", () => {
        const data = encodePbe3(song([60, 0, 100, 100]));
        data[5] |= 0x02;
        expect(() => readPbe3Header(data)).toThrow(/保留标志位/);
    });
});

describe("PBE3 keyDuration", () => {
    it("keyDuration 与 soundDuration 不同时才写标志位", () => {
        const events = encodePbe3Events(song(
            [60, 0, 800, 100, 64, 40, 100, 100],
            [20, 100]
        ));
        expect(events.events.length).toBeGreaterThan(0);
        const decoded = decodePbe3(encodePbe3(song(
            [60, 0, 800, 100, 64, 40, 100, 100],
            [20, 100]
        )));
        expect(decoded.tracks[0].keyDurations).toEqual([20, 100]);
        expect(decoded.tracks[0].notes).toEqual([60, 0, 800, 100, 64, 40, 100, 100]);
    });

    it("没有 keyDurations 时默认等于 soundDuration", () => {
        const decoded = decodePbe3(encodePbe3(song([60, 0, 100, 100])));
        expect(decoded.tracks[0].keyDurations).toEqual([100]);
    });

    it("keyDuration 被钳制在 1..soundDuration", () => {
        const decoded = decodePbe3(encodePbe3(song(
            [60, 0, 100, 100, 62, 40, 100, 100],
            [0, 999]
        )));
        expect(decoded.tracks[0].keyDurations).toEqual([3, 100]);
    });

    it("keyDuration 按 25ms 量化", () => {
        const decoded = decodePbe3(encodePbe3(song(
            [60, 0, 100, 100, 62, 40, 100, 100],
            [11, 15]
        )));
        expect(decoded.tracks[0].keyDurations).toEqual([10, 15]);
    });

    it("秒制事件同时带 soundDuration 和 keyDuration", () => {
        const events = pbe3ToNoteEvents(encodePbe3(song(
            [60, 0, 800, 100],
            [20]
        )));
        expect(events).toHaveLength(1);
        expect(events[0].duration).toBeCloseTo(8, 6);
        expect(events[0].keyDuration).toBeCloseTo(0.2, 6);
        expect(events[0].velocity).toBeCloseTo(100 / 127, 6);
    });
});

describe("PBE3 跳转", () => {
    it("稀疏索引和光标能定位到目标时间", () => {
        const notes: number[] = [];
        for (let i = 0; i < 20; i++) {
            notes.push(60 + (i % 12), i * 40, 100, 100);
        }
        const data = encodePbe3(song(notes, undefined, 20 * 40));
        const { header, events } = readPbe3Events(data);
        const index = buildPbe3SeekIndex(events, header.velocityBits, 200);
        expect(index.length).toBeGreaterThan(1);

        const cursor = new Pbe3EventCursor(events, index, header.palette, header.velocityBits);
        cursor.seek(720);
        expect(cursor.peekTime()).toBe(720);
        const note = cursor.next();
        expect(note?.time).toBe(720);
        expect(note?.midi).toBe(60 + (18 % 12));
    });

    it("跳过索引间隔内的音符后继续正常读取", () => {
        const notes: number[] = [];
        for (let i = 0; i < 12; i++) notes.push(60, i * 40, 100, 100);
        const data = encodePbe3(song(notes, undefined, 12 * 40));
        const { header, events } = readPbe3Events(data);
        const index = buildPbe3SeekIndex(events, header.velocityBits, 120);
        const cursor = new Pbe3EventCursor(events, index, header.palette, header.velocityBits);
        cursor.seek(200);
        const times: number[] = [];
        while (!cursor.done) {
            const note = cursor.next();
            if (!note) break;
            times.push(note.time);
        }
        expect(times).toEqual([200, 240, 280, 320, 360, 400, 440]);
    });
});

describe("PBE3 重命名", () => {
    it("保持 id、音符和 keyDuration，只改名称", () => {
        const data = encodePbe3(song([60, 0, 800, 100], [20]));
        const renamed = renamePbe3(data, "新名字");
        const header = readPbe3Header(renamed);
        expect(header.id).toBe("pbe3test");
        expect(header.name).toBe("新名字");
        expect(decodePbe3(renamed).tracks[0].keyDurations).toEqual([20]);
    });
});
