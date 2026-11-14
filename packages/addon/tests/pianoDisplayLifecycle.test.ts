import { describe, expect, mock, test } from "bun:test";

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
    properties = new Map<string, number | boolean>();
    dynamicProperties = new Map<string, unknown>();
    constructor(id: string) { this.id = id; }

    getDynamicProperty(key: string) { return this.dynamicProperties.get(key); }
    setDynamicProperty(key: string, value: unknown) { this.dynamicProperties.set(key, value); }
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
    expect(recovered.getProperty("xypiano:score_grand")).toBe(true);
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
    expect(score.getProperty("xypiano:score_grand")).toBe(false);
    removeScoreStand(location, point);
    expect(score.isValid).toBe(false);
    expect(keys.entity.isValid).toBe(true);
    expect(recoverScoreStand(location, point).id).not.toBe(score.id);
});
