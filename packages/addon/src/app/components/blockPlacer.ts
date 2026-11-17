import { Direction, EntityComponentTypes, EquipmentSlot, GameMode, ItemCustomComponent, Player, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@domain/types";
import { grandDefinition, pianoDefinition } from "@domain/instrument/definition";
import { inspectInstrument, placeInstrument, resolveInstrument } from "@platform/assembly";
import { RightOffsets } from "@domain/geometry/offsets";
import { P88_BENCH_ITEM, placeP88Bench } from "@platform/p88Bench";
import { reportPianoError } from "@runtime/scope";
import type { Block } from "@minecraft/server";

const FaceOffsets: Record<Direction, Vector3> = {
    Up: { x: 0, y: 1, z: 0 }, Down: { x: 0, y: -1, z: 0 },
    North: { x: 0, y: 0, z: -1 }, South: { x: 0, y: 0, z: 1 },
    East: { x: 1, y: 0, z: 0 }, West: { x: -1, y: 0, z: 0 },
};

function p88BenchOrigin(block: Block, direction: Cardinal_Direction): Vector3 {
    const { dimension, location } = block;
    const right = RightOffsets[direction];
    const pianoCell = { x: location.x + right.z, y: location.y, z: location.z - right.x };
    if (!dimension.isChunkLoaded(pianoCell)) return location;
    const neighbor = dimension.getBlock(pianoCell);
    const piano = neighbor && resolveInstrument(neighbor, pianoDefinition);
    if (!piano || piano.direction !== direction || inspectInstrument(piano) !== "complete") return location;

    // The bench uses the same pair of columns as the P-88, one row toward the player.
    return { x: piano.pos.x - right.z, y: location.y, z: piano.pos.z + right.x };
}

export const blockPlacerComponent: ItemCustomComponent = {
    onUseOn(e) {
        if (e.source?.typeId !== "minecraft:player") return;
        const player = e.source as Player;
        const block = e.block.offset(FaceOffsets[e.blockFace]);
        if (!block) return;
        const rot = player.getRotation().y;
        const direction: Cardinal_Direction = rot >= -45 && rot < 45 ? "north" : rot >= 45 && rot < 135 ? "east" : rot >= -135 && rot < -45 ? "west" : "south";
        if (e.itemStack?.typeId === P88_BENCH_ITEM) {
            const creative = player.getGameMode() === GameMode.Creative;
            const slot = player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const held = slot?.getItem();
            if (!creative && (!slot || held?.typeId !== P88_BENCH_ITEM)) return;

            const origin = p88BenchOrigin(block, direction);
            const undo = placeP88Bench({ dimension: block.dimension, origin, direction });
            if (!undo || creative || !slot || !held) return;
            try {
                if (held.amount > 1) {
                    held.amount--;
                    slot.setItem(held);
                } else {
                    slot.setItem(undefined);
                }
            } catch (error) {
                undo();
                reportPianoError("p88Bench.consume", error);
            }
            return;
        }
        // The same placer component is shared by both instruments; the held
        // item decides which assembly is built.
        const definition = e.itemStack?.typeId === grandDefinition.itemId ? grandDefinition : pianoDefinition;
        const location = { dimension: block.dimension, pos: block.location, direction, definition };
        if (!placeInstrument(location)) return;

        if (player.getGameMode() === GameMode.Creative) return;
        const item = e.itemStack;
        const slot = player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
        if (!item || !slot) return;
        if (item.amount <= 1) {
            slot.setItem(undefined);
        } else {
            item.amount--;
            slot.setItem(item);
        }
    },
};
