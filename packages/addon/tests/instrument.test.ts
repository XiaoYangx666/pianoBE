import { describe, expect, mock, test } from "bun:test";
mock.module("@minecraft/server", () => ({
    system: { currentTick: 0 },
    BlockPermutation: { resolve: (typeId: string, states: Record<string, string>) => ({ type: { id: typeId }, getState: (key: string) => states[key] }) },
    ItemStack: class { constructor(public typeId: string) {} },
}));
const { grandDefinition, pianoDefinition } = await import("../src/domain/instrument/definition");
const { inspectInstrument, placeInstrument, destroyInstrument, resolveInstrument } = await import("../src/platform/assembly");

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
        expect(right.typeId).toBe("xypiano:piano_right");
        expect(dimension.spawnItem).toHaveBeenCalledTimes(1);
    });
    test("digital and grand instruments drop their own item", () => {
        expect(pianoDefinition.itemId).toBe("xypiano:piano_item");
        expect(grandDefinition.itemId).toBe("xypiano:grand_piano_item");
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
            expect(dimension.spawnItem.mock.calls[0][0].typeId).toBe("xypiano:grand_piano_item");
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
