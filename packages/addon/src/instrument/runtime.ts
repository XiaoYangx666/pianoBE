import { Block, BlockPermutation, Dimension, ItemStack, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@types";
import { RightOffsets } from "@utils/block";
import { Signal } from "@utils/signal";
import { GRAND_PARTS } from "./grand.generated";

/** Definitions describe an assembly relative to its anchor; positions are world-specific. */
export interface InstrumentDefinition {
    readonly parts: readonly { typeId: string; right: number; forward?: number; up?: number }[];
    readonly itemId: string;
    readonly displayId?: string;
}
export const pianoDefinition: InstrumentDefinition = {
    parts: [{ typeId: "xypiano:piano_left", right: 0 }, { typeId: "xypiano:piano_right", right: 1 }],
    itemId: "xypiano:piano_item",
};
export const grandDefinition: InstrumentDefinition = {
    parts: GRAND_PARTS,
    itemId: "xypiano:grand_piano_item",
    displayId: "xypiano:grand_display",
};
const definitionsByPart = new Map(
    [pianoDefinition, grandDefinition].flatMap(definition =>
        definition.parts.map(part => [part.typeId, definition] as const)),
);
export const instrumentBlockTypes = [...definitionsByPart.keys()];
export interface InstrumentLocation {
    dimension: Dimension;
    pos: Vector3;
    direction: Cardinal_Direction;
    definition?: InstrumentDefinition;
}
export const instrumentPlaced = new Signal<InstrumentLocation>();
export const instrumentDestroyed = new Signal<InstrumentLocation>();

export function instrumentKey(dimension: Dimension, pos: Vector3): string {
    return `${dimension.id}:${pos.x},${pos.y},${pos.z}`;
}

export function resolveInstrument(block: Block, definition?: InstrumentDefinition): InstrumentLocation | undefined {
    try { return resolveInstrumentSnapshot(block.dimension, block.location, block.permutation, definition); }
    catch { return undefined; }
}
export function resolveInstrumentSnapshot(dimension: Dimension, pos: Vector3, permutation: BlockPermutation,
    definition = definitionsByPart.get(permutation.type.id)): InstrumentLocation | undefined {
    const part = definition?.parts.find(p => p.typeId === permutation.type.id);
    if (!part) return;
    const direction = permutation.getState("minecraft:cardinal_direction") as Cardinal_Direction;
    const right = RightOffsets[direction];
    if (!right) return;
    const forward = { x: -right.z, z: right.x };
    return { dimension, pos: { x: pos.x - right.x * part.right - forward.x * (part.forward ?? 0), y: pos.y - (part.up ?? 0), z: pos.z - right.z * part.right - forward.z * (part.forward ?? 0) }, direction, definition };
}
function partPosition(location: InstrumentLocation, part: InstrumentDefinition["parts"][number]): Vector3 {
    const right = RightOffsets[location.direction];
    const forward = { x: -right.z, z: right.x };
    return { x: location.pos.x + right.x * part.right + forward.x * (part.forward ?? 0), y: location.pos.y + (part.up ?? 0), z: location.pos.z + right.z * part.right + forward.z * (part.forward ?? 0) };
}
function readPart(location: InstrumentLocation, part: InstrumentDefinition["parts"][number]): Block | undefined {
    const pos = partPosition(location, part);
    try {
        if (!location.dimension.isChunkLoaded(pos)) return undefined;
        const block = location.dimension.getBlock(pos);
        return block?.isValid ? block : undefined;
    } catch { return undefined; }
}
export function inspectInstrument(location: InstrumentLocation, definition = location.definition ?? pianoDefinition): "complete" | "incomplete" | "unloaded" {
    let incomplete = false;
    for (const part of definition.parts) {
        const block = readPart(location, part);
        if (!block) return "unloaded";
        try {
            if (block.typeId !== part.typeId || block.permutation.getState("minecraft:cardinal_direction") !== location.direction) incomplete = true;
        } catch { return "unloaded"; }
    }
    return incomplete ? "incomplete" : "complete";
}
export function placeInstrument(location: InstrumentLocation, definition = location.definition ?? pianoDefinition): boolean {
    const blocks = definition.parts.map(part => readPart(location, part));
    if (blocks.some(block => !block?.isValid || (!block.isAir && !block.isLiquid))) return false;
    const permutations = definition.parts.map(part => BlockPermutation.resolve(part.typeId, { "minecraft:cardinal_direction": location.direction }));
    // Prepare before mutating and restore on a failed write, avoiding partial assemblies.
    const previous = blocks.map(block => block!.permutation);
    try {
        blocks.forEach((block, i) => block!.setPermutation(permutations[i]));
    } catch (error) {
        blocks.forEach((block, i) => { try { block!.setPermutation(previous[i]); } catch {} });
        console.warn("[piano] placement failed", error);
        return false;
    }
    instrumentPlaced.publish({ ...location, definition });
    return true;
}
/** Only clear matching parts, never unrelated or differently oriented neighbors. */
export function destroyInstrument(location: InstrumentLocation, drop: boolean, definition = location.definition ?? pianoDefinition): boolean {
    if (inspectInstrument(location, definition) === "unloaded") return false;
    let removed = false;
    for (const part of definition.parts) {
        const block = readPart(location, part);
        if (block?.typeId === part.typeId && block.permutation.getState("minecraft:cardinal_direction") === location.direction) {
            block.setType("minecraft:air");
            removed = true;
        }
    }
    if (!removed) return false;
    instrumentDestroyed.publish({ ...location, definition });
    if (drop) location.dimension.spawnItem(new ItemStack(definition.itemId), { x: location.pos.x + .5, y: location.pos.y + .5, z: location.pos.z + .5 });
    return true;
}
