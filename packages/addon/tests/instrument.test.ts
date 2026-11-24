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
const { grandDefinition, pianoDefinition } = await import("../src/domain/instrument/definition");
const { inspectInstrument, placeInstrument, destroyInstrument, resolveInstrument } = await import("../src/platform/assembly");
const { VfxPropRenderer } = await import("../src/platform/vfxProp");

test("stage props move, restart on a seek, switch and clear without leaving an active entity", () => {
    const first = { id: "fixture.stage:lantern", entityId: "pbe:fixture_lantern", animations: ["flicker"] };
    const second = { id: "fixture.stage:arch", entityId: "pbe:fixture_arch", animations: [] };
    const registrations = new Map([first, second].map(prop => [prop.id, prop]));
    let loaded = true;
    let failSpawn = false;
    function entity(typeId: string, position: { x: number; y: number; z: number }) {
        const properties = new Map<string, number>();
        return {
            typeId, isValid: true, position, properties,
            teleport(next: typeof position) { this.position = next; },
            setProperty(name: string, value: number) { properties.set(name, value); },
            remove() { this.isValid = false; },
        };
    }
    const spawned: ReturnType<typeof entity>[] = [];
    const dimension = {
        isChunkLoaded: (position: { x: number }) => loaded && position.x < 16,
        spawnEntity(id: string, position: { x: number; y: number; z: number }) {
            if (failSpawn) throw new Error("fixture spawn failure");
            const next = entity(id, position);
            spawned.push(next);
            return next;
        },
    };
    const renderer = new VfxPropRenderer({
        dimension: dimension as unknown as Parameters<typeof inspectInstrument>[0]["dimension"],
        pos: { x: 0, y: 0, z: 0 }, direction: "south", definition: grandDefinition,
    }, registrations);
    const prop = { id: first.id, offset: { x: 0, y: 1, z: 1 }, size: 1.2, turn: 45, animation: "flicker" };
    expect(renderer.render(prop, 0)).toBe(true);
    expect(spawned[0].properties).toEqual(new Map([
        ["pbe:vfx_animation", 1], ["pbe:vfx_size", 1.2], ["pbe:vfx_turn", 45],
    ]));
    expect(renderer.render({ ...prop, offset: { x: 1, y: 2, z: 2 } }, 1)).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].position).toMatchObject({ x: 1.5, y: 2 });

    renderer.clear();
    expect(renderer.render(prop, 2)).toBe(true);
    expect(spawned[0].isValid).toBe(false);
    expect(spawned).toHaveLength(2);
    expect(renderer.render({ ...prop, id: second.id, animation: undefined }, 3)).toBe(true);
    expect(spawned[1].isValid).toBe(false);
    expect(spawned[2].typeId).toBe(second.entityId);
    expect(renderer.render({ ...prop, animation: "missing" }, 4)).toBe(false);
    expect(spawned[2].isValid).toBe(false);

    expect(renderer.render(prop, 5)).toBe(true);
    expect(renderer.render({ ...prop, offset: { ...prop.offset, x: 17 } }, 6)).toBe(false);
    expect(spawned[3].isValid).toBe(false);
    expect(renderer.render(prop, 7)).toBe(true);
    loaded = false;
    expect(renderer.render(prop, 8)).toBe(false);
    expect(spawned.every(item => !item.isValid)).toBe(true);
    loaded = true;
    expect(renderer.render(prop, 9)).toBe(true);
    expect(renderer.render(undefined, 10)).toBe(false);
    expect(spawned.every(item => !item.isValid)).toBe(true);

    failSpawn = true;
    expect(renderer.render(prop, 11)).toBe(false);
    failSpawn = false;
    expect(renderer.render({ ...prop, id: second.id, animation: undefined }, 12)).toBe(true);
    expect(renderer.render(prop, 13)).toBe(false);
    expect(spawned.every(item => !item.isValid)).toBe(true);
    expect(renderer.render(prop, 51)).toBe(true);
    renderer.clear();
});

function fixture() {
    const cells = new Map<string, any>();
    let loaded = true;
    const key = (p: any) => `${p.x},${p.y},${p.z}`;
    const dimension: any = {
        id: "test", isChunkLoaded: () => loaded,
        getBlock(pos: any) {
            const k = key(pos);
            if (!cells.has(k)) {
                const block: any = { dimension, location: { ...pos }, isValid: true, typeId: "minecraft:air", isAir: true, isLiquid: false,
                    permutation: { type: { id: "minecraft:air" }, getState: () => undefined },
                    setPermutation(value: any) { this.permutation = value; this.typeId = value.type.id; this.isAir = false; },
                    setType(value: string) { this.typeId = value; this.isAir = true; this.permutation = { type: { id: value }, getState: () => undefined }; },
                };
                cells.set(k, block);
            }
            return cells.get(k);
        }, spawnItem: mock(() => {}),
    };
    const location: any = { dimension, pos: { x: 0, y: 0, z: 0 }, direction: "north" };
    return { dimension, location, setLoaded: (value: boolean) => { loaded = value; } };
}
describe("instrument assemblies", () => {
    test("places both parts and resolves the right part in all directions", () => {
        for (const direction of ["north", "east", "south", "west"]) {
            const { dimension, location } = fixture(); location.direction = direction;
            expect(placeInstrument(location)).toBe(true);
            expect(inspectInstrument(location)).toBe("complete");
            const right = { north: [-1, 0], east: [0, -1], south: [1, 0], west: [0, 1] }[direction]!;
            expect(resolveInstrument(dimension.getBlock({ x: right[0], y: 0, z: right[1] }))?.pos).toEqual(location.pos);
        }
    });
    test("unloaded is distinct from incomplete and destruction waits", () => {
        const { dimension, location, setLoaded } = fixture();
        expect(placeInstrument(location)).toBe(true);
        setLoaded(false);
        expect(inspectInstrument(location)).toBe("unloaded");
        expect(destroyInstrument(location, true)).toBe(false);
        setLoaded(true);
        expect(inspectInstrument(location)).toBe("complete");
        dimension.getBlock({ x: -1, y: 0, z: 0 }).setType("minecraft:air");
        expect(inspectInstrument(location)).toBe("incomplete");
        expect(destroyInstrument(location, false)).toBe(true);
    });
    test("does not destroy a neighboring part with another orientation", () => {
        const { dimension, location } = fixture();
        expect(placeInstrument(location)).toBe(true);
        const right = dimension.getBlock({ x: -1, y: 0, z: 0 });
        right.permutation = { type: { id: right.typeId }, getState: () => "south" };
        expect(destroyInstrument(location, true)).toBe(true);
        expect(right.typeId).toBe("pbe:piano_right");
        expect(dimension.spawnItem).toHaveBeenCalledTimes(1);
    });
    test("digital and grand instruments drop their own item", () => {
        expect(pianoDefinition.itemId).toBe("pbe:piano_item");
        expect(grandDefinition.itemId).toBe("pbe:grand_piano_item");
    });
    test("places and resolves the full grand in every rotation, then drops its own item", () => {
        const transforms = {
            north: (x: number, z: number) => [x, z],
            east: (x: number, z: number) => [-z, x],
            south: (x: number, z: number) => [-x, -z],
            west: (x: number, z: number) => [z, -x],
        };
        for (const [direction, rotate] of Object.entries(transforms)) {
            const { dimension, location } = fixture();
            Object.assign(location, { direction, definition: grandDefinition, pos: { x: 10, y: 64, z: 20 } });
            expect(placeInstrument(location)).toBe(true);
            expect(inspectInstrument(location)).toBe("complete");
            const blocks = grandDefinition.parts.map(({ typeId }) => {
                const [y, z, x] = typeId.split("_").slice(-3).map(Number);
                const [dx, dz] = rotate(x - 1, z);
                const block = dimension.getBlock({ x: 10 + dx, y: 64 + y, z: 20 + dz });
                expect(block.typeId).toBe(typeId);
                const owner = resolveInstrument(block);
                expect(owner?.pos).toEqual(location.pos);
                expect(owner?.definition).toBe(grandDefinition);
                return block;
            });
            const owner = resolveInstrument(blocks.at(-1))!;
            blocks.at(-1).setType("minecraft:air");
            expect(destroyInstrument(owner, true)).toBe(true);
            expect(blocks.every(block => block.isAir)).toBe(true);
            expect(dimension.spawnItem).toHaveBeenCalledTimes(1);
            expect(dimension.spawnItem.mock.calls[0][0].typeId).toBe("pbe:grand_piano_item");
        }
    });
    test("an obstruction in the grand's tail leaves the anchor untouched", () => {
        const { dimension, location } = fixture();
        location.definition = grandDefinition;
        const tail = dimension.getBlock({ x: 0, y: 1, z: 4 });
        tail.isAir = false;
        tail.typeId = "minecraft:stone";
        expect(placeInstrument(location)).toBe(false);
        expect(dimension.getBlock(location.pos).typeId).toBe("minecraft:air");
        expect(tail.typeId).toBe("minecraft:stone");
    });
});
