import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compilePerformanceSource, readSongHeader, setDiagnosticSink, toMusicSelection, type MidiSongMeta } from "@piano/core";
import { MidiManager } from "../src/domain/playback/midiManager";
import { MidiPlayer } from "../src/domain/playback/player";
import { PLAYBACK_BUDGET_BYTES } from "../src/domain/playback/playbackBudget";
import { PlaybackStore } from "../src/platform/storage/playbackStore";
import { storageRef } from "../src/domain/music/storage";

mock.module("@minecraft/server", () => ({
    system: { currentTick: 0 },
    MolangVariableMap: class {
        setVector3() {}
        setFloat() {}
    },
    TextPrimitive: class {
    },
    BlockPermutation: { resolve: (typeId: string, states: Record<string, string>) => ({ type: { id: typeId }, getState: (key: string) => states[key] }) },
    ItemStack: class { constructor(public typeId: string) {} },
    EntityComponentTypes: { Inventory: "minecraft:inventory", Equippable: "minecraft:equippable" },
    EquipmentSlot: { Mainhand: "Mainhand" },
}));

const { SCORE_STAND_ENTITY, SCORE_MOUNTED, SCORE_SPREAD, PianoDisplay, PIANO_DISPLAY, pianoDisplayType,
    recoverScoreStand, removeScoreStand, removeDormantDisplay } = await import("../src/platform/display");
const { grandDefinition } = await import("../src/domain/instrument/definition");
let libraryManager: MidiManager;
mock.module("@app/midi", () => ({
    midiManager: { page: (...args: Parameters<MidiManager["page"]>) => libraryManager.page(...args) },
}));
const { listTab } = await import("../src/app/ui/midi/shared");

const ANCHOR = "pbe:anchor";
const PLAYBACK = "pbe:playback";
const SETTINGS = "pbe:settings_v1";

class FakeEntity {
    id: string;
    typeId = PIANO_DISPLAY;
    isValid = true;
    removed = false;
    location = { x: 0, y: 0, z: 0 };
    rotation = { x: 0, y: 180 };
    properties = new Map<string, number | boolean>();
    dynamicProperties = new Map<string, unknown>();
    constructor(id: string) { this.id = id; }

    getDynamicProperty(key: string) { return this.dynamicProperties.get(key); }
    getDynamicPropertyIds() { return [...this.dynamicProperties.keys()]; }
    setDynamicProperty(key: string, value: unknown) {
        if (typeof value === "string" && Buffer.byteLength(value) > 32_767) {
            throw new RangeError("dynamic property exceeds 32767 bytes");
        }
        if (value === undefined) this.dynamicProperties.delete(key);
        else this.dynamicProperties.set(key, value);
    }
    setProperty(key: string, value: number | boolean) { this.properties.set(key, value); }
    getProperty(key: string) { return this.properties.get(key); }
    getRotation() { return this.rotation; }
    remove() { this.removed = true; this.isValid = false; }
    teleport(point: { x: number; y: number; z: number }) { this.location = point; }
    setRotation(value: { x: number; y: number }) { this.rotation = value; }
}

function fixture() {
    const entities: FakeEntity[] = [];
    const dimension = {
        id: "test",
        isChunkLoaded: () => true,
        getEntities: ({ type }: { type: string }) => entities.filter(entity => entity.isValid && entity.typeId === type),
        spawnEntity: (type: string, point: { x: number; y: number; z: number }, options: { initialRotation: number }) => {
            const entity = new FakeEntity(`e${entities.length + 1}`);
            entity.typeId = type;
            entity.location = point;
            entity.rotation = { x: 0, y: options.initialRotation };
            entities.push(entity);
            return entity;
        },
    };
    const location = {
        dimension,
        pos: { x: 0, y: 0, z: 0 },
        direction: "north" as const,
    };
    return { entities, dimension, location, point: { x: 0, y: 0, z: 0 } };
}

describe("PianoDisplay lifecycle", () => {
    test("checks UTF-8 budget, keeps the last checkpoint and warns once as playback advances", () => {
        const { entities, location, point } = fixture();
        const display = PianoDisplay.recover(location, point);
        const song = { id: "short", name: "曲目", duration: 90, source: "library" as const, performanceId: "default" };
        const first = { songs: [song], index: 0, mode: "sequence", state: "playing", seconds: 0 } as const;
        display.checkpoint(first);
        const value = entities[0].getDynamicProperty(PLAYBACK);
        const huge = { ...first, songs: [{ ...song, name: "字".repeat(9_000) }] };
        expect(JSON.stringify(huge).length).toBeLessThan(PLAYBACK_BUDGET_BYTES);
        expect(Buffer.byteLength(JSON.stringify(huge))).toBeGreaterThan(PLAYBACK_BUDGET_BYTES);

        const warn = mock(() => {});
        setDiagnosticSink(warn);
        try {
            for (let seconds = 0; seconds < 11; seconds++) display.checkpoint({ ...huge, seconds });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(entities[0].getDynamicProperty(PLAYBACK)).toBe(value);
            expect(PianoDisplay.recover(location, point).playback).toEqual(first);
            display.checkpoint({ ...first, seconds: 2 });
            expect(PianoDisplay.recover(location, point).playback?.seconds).toBe(2);
            expect(entities[0].getDynamicPropertyIds().filter(key => key.startsWith("pbe:playback"))).toEqual([PLAYBACK]);
        } finally {
            setDiagnosticSink(undefined);
        }
    });

    test("a failed engine write keeps the last checkpoint and retries after a delay", () => {
        const { entities, location, point } = fixture();
        PianoDisplay.recover(location, point);
        const entity = entities[0];
        const store = new PlaybackStore(entity as never, []);
        const first = { songs: [], index: -1, mode: "sequence", state: "idle", seconds: 0 } as const;
        const next = { ...first, mode: "loop" as const };
        store.checkpoint(first, 0);
        const write = entity.setDynamicProperty.bind(entity);
        const fail = mock(() => { throw new Error("write interrupted"); });
        const warn = mock(() => {});
        entity.setDynamicProperty = fail;
        setDiagnosticSink(warn);
        try {
            store.checkpoint(next, 20);
            store.checkpoint(next, 40);
            expect(fail).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(PianoDisplay.recover(location, point).playback).toEqual(first);
            entity.setDynamicProperty = write;
            store.checkpoint(next, 620);
            expect(PianoDisplay.recover(location, point).playback).toEqual(next);
        } finally {
            setDiagnosticSink(undefined);
        }
    });

    test("runtime release keeps the persistent display entity", () => {
        const { location, point } = fixture();
        const display = PianoDisplay.recover(location, point);
        display.dispose(false);
        expect(display.entity.removed).toBe(false);
        expect(display.entity.isValid).toBe(true);
    });

    test("true dismantle removes the display entity", () => {
        const { location, point } = fixture();
        const display = PianoDisplay.recover(location, point);
        display.dispose(true);
        expect(display.entity.removed).toBe(true);
    });

    test("recovery reuses the owned display and removes duplicates", () => {
        const { entities, location, point } = fixture();
        const keep = new FakeEntity("keep");
        const duplicate = new FakeEntity("duplicate");
        for (const entity of [keep, duplicate]) {
            entity.dynamicProperties.set(ANCHOR, { x: 0, y: 0, z: 0 });
            entities.push(entity);
        }

        const display = PianoDisplay.recover(location, point);
        expect(display.entity.id).toBe("keep");
        expect(duplicate.removed).toBe(true);
        expect(entities.filter(entity => entity.isValid).length).toBe(1);
    });

    test("recovery restores persisted settings and playback", () => {
        const { entities, location, point } = fixture();
        const entity = new FakeEntity("persisted");
        entity.dynamicProperties.set(ANCHOR, { x: 0, y: 0, z: 0 });
        entity.dynamicProperties.set(SETTINGS, JSON.stringify({ volume: 42 }));
        entity.dynamicProperties.set(PLAYBACK, JSON.stringify({ v: 1, songs: [], index: -1, mode: "sequence", state: "idle", seconds: 0 }));
        entities.push(entity);

        const display = PianoDisplay.recover(location, point);
        expect(display.settings.volume).toBe(42);
        expect(display.playback?.state).toBe("idle");
    });

    test("deletes the legacy playback keys without reading their values", () => {
        const { entities, location, point } = fixture();
        const entity = new FakeEntity("legacy");
        const keys = ["pbe:playback_v1", "pbe:playback_v1:0:0", "pbe:playback_v1:1:42"];
        entity.dynamicProperties.set(ANCHOR, location.pos);
        for (const key of keys) entity.dynamicProperties.set(key, "broken legacy value");
        entity.dynamicProperties.set("pbe:playback_v10", "unrelated");
        const read = entity.getDynamicProperty.bind(entity);
        entity.getDynamicProperty = key => {
            if (keys.includes(key)) throw new Error("legacy property was read");
            return read(key);
        };
        entities.push(entity);

        expect(PianoDisplay.recover(location, point).playback).toBeUndefined();
        expect(entity.getDynamicPropertyIds()).toEqual([ANCHOR, "pbe:playback_v10"]);
    });

    test("removes malformed playback and recovers the display even if one legacy key cannot be removed", () => {
        const { entities, location, point } = fixture();
        const entity = new FakeEntity("invalid");
        const blocked = "pbe:playback_v1:0:0";
        const removable = "pbe:playback_v1:0:1";
        entity.dynamicProperties.set(ANCHOR, location.pos);
        entity.dynamicProperties.set(SETTINGS, JSON.stringify({ volume: 42 }));
        entity.dynamicProperties.set(PLAYBACK, "{");
        entity.dynamicProperties.set(blocked, "legacy");
        entity.dynamicProperties.set(removable, "legacy");
        const write = entity.setDynamicProperty.bind(entity);
        entity.setDynamicProperty = (key, value) => {
            if (key === blocked) throw new Error("legacy cleanup failed");
            write(key, value);
        };
        entities.push(entity);

        const warn = mock(() => {});
        setDiagnosticSink(warn);
        try {
            const display = PianoDisplay.recover(location, point);
            expect(display.playback).toBeUndefined();
            expect(display.settings.volume).toBe(42);
            expect(entity.getDynamicPropertyIds()).toEqual([ANCHOR, SETTINGS, blocked]);
            expect(warn).toHaveBeenCalledTimes(2);

            entity.setDynamicProperty = write;
            expect(PianoDisplay.recover(location, point).playback).toBeUndefined();
            expect(entity.getDynamicPropertyIds()).toEqual([ANCHOR, SETTINGS]);
            expect(warn).toHaveBeenCalledTimes(2);
        } finally {
            setDiagnosticSink(undefined);
        }
    });

    test("display type follows the instrument definition", () => {
        expect(pianoDisplayType({ definition: { displayId: "pbe:grand_display" } } as never))
            .toBe("pbe:grand_display");
        expect(pianoDisplayType({ definition: undefined } as never)).toBe(PIANO_DISPLAY);
    });
});

test("the real Water Dance, Flower Sea and Spark scores save as selections and restore the chosen cues", async () => {
    const ids = ["28a2cb50", "2f434124", "b0cae095"];
    const bytes = new Map<string, Uint8Array>();
    const metas: MidiSongMeta[] = ids.map(id => {
        const raw = new Uint8Array(readFileSync(new URL(`../../../midis/library/${id}.pbe3`, import.meta.url)));
        bytes.set(id, raw);
        const { name, duration, noteCount } = readSongHeader(raw);
        const source = JSON.parse(readFileSync(new URL(`../../../midis/performances/${id}.json`, import.meta.url), "utf8"));
        const cues = compilePerformanceSource(source, { expectedSongId: id });
        return {
            id, name, duration, noteCount, bytes: raw.length,
            performanceEntries: [{ id: `pianobe.pack.featured:${id}`, name: source.title, songId: id, cues }],
            performances: [cues],
        };
    });
    expect(Buffer.byteLength(JSON.stringify(metas))).toBeGreaterThan(32_767);
    const makeManager = () => new MidiManager({ list: () => metas, get: async id => bytes.get(id) });
    const makePlayer = (manager: MidiManager) => new MidiPlayer({
        acquire: ref => manager.acquire(ref.id),
        resolvePerformanceCues: (ref, id) => manager.resolvePerformanceCues(ref.id, id),
    }, { note() {}, playing() {}, stopNotes() {} });
    libraryManager = makeManager();
    const midi = makePlayer(libraryManager);
    const { refs } = await listTab({} as never, "library", 1, "");
    expect(refs.map(ref => ref.id)).toEqual(ids);
    for (const ref of refs) {
        expect(ref).not.toHaveProperty("performanceEntries");
        expect(ref).not.toHaveProperty("performances");
        const [performance] = libraryManager.performanceEntries(ref.id);
        midi.addToQueue(toMusicSelection(ref, performance.id));
    }
    const card = storageRef({
        v: 1, id: "card-song", name: "卡片歌曲", duration: 40, noteCount: 3,
        bytes: 123, checksum: "ab1234", shards: 1, gen: "1", createdAt: 1,
    }, "card-a");
    midi.addToQueue(card);
    const spark = midi.queue.getRefs()[2];
    await midi.playNow(spark);
    midi.pause();
    midi.seek(3);

    const { entities, location, point } = fixture();
    const display = PianoDisplay.recover(location, point);
    const checkpoint = midi.checkpoint();
    expect(checkpoint).toBeDefined();
    display.checkpoint(checkpoint!);
    const saved = entities[0].getDynamicProperty(PLAYBACK) as string;
    expect(JSON.parse(saved).v).toBe(1);
    expect(Buffer.byteLength(saved)).toBeLessThan(PLAYBACK_BUDGET_BYTES);
    expect(saved).not.toMatch(/"cues"|"performanceEntries"|"performances"/);
    midi.end();

    const restored = makePlayer(makeManager());
    const record = PianoDisplay.recover(location, point).playback;
    expect(record).toEqual(checkpoint);
    await restored.restore(record!);
    expect(restored.queue.getRefs().map(ref => ref.performanceId))
        .toEqual([...ids.map(id => `pianobe.pack.featured:${id}`), "default"]);
    expect(restored.queue.getRefs()[3]).toEqual(card);
    expect(restored.queue.current()?.id).toBe(ids[2]);
    expect(restored.position).toBe(3);
    expect(restored.performance?.cues).toEqual(metas[2].performanceEntries?.[0].cues);
    restored.end();
});

test("grand score keeps its own entity and page through recovery and is removed on dismantle", () => {
    const { location, point, dimension } = fixture();
    const grand = { ...location, definition: grandDefinition };
    const keys = PianoDisplay.recover(grand, point);
    expect(keys.settings.scoreMounted).toBe(false);
    const score = recoverScoreStand(grand, point);
    score.setProperty(SCORE_SPREAD, 1);
    const duplicate = dimension.spawnEntity(SCORE_STAND_ENTITY, point, { initialRotation: 180 });
    duplicate.setDynamicProperty(ANCHOR, location.pos);
    const other = dimension.spawnEntity(SCORE_STAND_ENTITY, point, { initialRotation: 180 });
    other.setDynamicProperty(ANCHOR, { x: 1, y: 0, z: 0 });

    keys.dispose(false);
    const recovered = recoverScoreStand({ ...grand, direction: "west" }, point);
    expect(recovered.id).toBe(score.id);
    expect(recovered.getRotation().y).toBe(90);
    expect(recovered.getProperty(SCORE_SPREAD)).toBe(1);
    expect(recovered.getProperty(SCORE_MOUNTED)).toBe(true);
    expect(recovered.getProperty("pbe:score_grand")).toBe(true);
    expect(keys.entity.getProperty(SCORE_SPREAD)).toBeUndefined();
    expect(duplicate.removed).toBe(true);

    removeDormantDisplay(grand, point);
    expect(keys.entity.isValid).toBe(false);
    expect(score.isValid).toBe(false);
    expect(other.isValid).toBe(true);
});

test("the digital stand mounts on its lower deck and can be removed independently", () => {
    const { location, point } = fixture();
    const keys = PianoDisplay.recover(location, point);
    const score = recoverScoreStand(location, point);
    expect(score.location.y).toBeCloseTo(16.83335 / 16);
    expect(score.getProperty("pbe:score_grand")).toBe(false);
    removeScoreStand(location, point);
    expect(score.isValid).toBe(false);
    expect(keys.entity.isValid).toBe(true);
    expect(recoverScoreStand(location, point).id).not.toBe(score.id);
});
