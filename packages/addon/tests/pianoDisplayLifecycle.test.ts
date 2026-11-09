import { describe, expect, mock, test } from "bun:test";

mock.module("@minecraft/server", () => ({
    system: { currentTick: 0 },
    BlockPermutation: { resolve: (typeId: string, states: Record<string, string>) => ({ type: { id: typeId }, getState: (key: string) => states[key] }) },
    ItemStack: class { constructor(public typeId: string) {} },
}));

const { PianoDisplay, PIANO_DISPLAY, pianoDisplayType } = await import("../src/platform/display");

const ANCHOR = "xypiano:anchor";
const PLAYBACK = "xypiano:playback_v1";
const SETTINGS = "xypiano:settings_v1";

class FakeEntity {
    id: string;
    typeId = PIANO_DISPLAY;
    isValid = true;
    removed = false;
    location = { x: 0, y: 0, z: 0 };
    rotation = { x: 0, y: 180 };
    properties = new Map<string, number>();
    dynamicProperties = new Map<string, unknown>();
    constructor(id: string) { this.id = id; }

    getDynamicProperty(key: string) { return this.dynamicProperties.get(key); }
    setDynamicProperty(key: string, value: unknown) { this.dynamicProperties.set(key, value); }
    setProperty(key: string, value: number) { this.properties.set(key, value); }
    getRotation() { return this.rotation; }
    remove() { this.removed = true; this.isValid = false; }
    teleport() {}
    setRotation(value: { x: number; y: number }) { this.rotation = value; }
}

function fixture() {
    const entities: FakeEntity[] = [];
    const dimension = {
        id: "test",
        isChunkLoaded: () => true,
        getEntities: () => entities,
        spawnEntity: (_type: string, _point: unknown, options: { initialRotation: number }) => {
            const entity = new FakeEntity(`e${entities.length + 1}`);
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
        entity.dynamicProperties.set(PLAYBACK, JSON.stringify({ version: 1, songs: [], index: -1, mode: "sequence", state: "paused", seconds: 0 }));
        entities.push(entity);

        const display = PianoDisplay.recover(location, point);
        expect(display.settings.volume).toBe(42);
        expect(display.playback?.state).toBe("paused");
    });

    test("display type follows the instrument definition", () => {
        expect(pianoDisplayType({ definition: { displayId: "xypiano:grand_display" } } as never))
            .toBe("xypiano:grand_display");
        expect(pianoDisplayType({ definition: undefined } as never)).toBe(PIANO_DISPLAY);
    });
});
