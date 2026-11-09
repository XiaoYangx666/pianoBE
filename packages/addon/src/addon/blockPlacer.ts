import { Direction, EntityComponentTypes, EquipmentSlot, GameMode, ItemCustomComponent, Player, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@types";
import { grandDefinition, pianoDefinition, placeInstrument } from "@instrument/runtime";

const FaceOffsets: Record<Direction, Vector3> = {
    Up: { x: 0, y: 1, z: 0 }, Down: { x: 0, y: -1, z: 0 },
    North: { x: 0, y: 0, z: -1 }, South: { x: 0, y: 0, z: 1 },
    East: { x: 1, y: 0, z: 0 }, West: { x: -1, y: 0, z: 0 },
};
export const blockPlacerComponent: ItemCustomComponent = {
    onUseOn(e) {
        if (e.source?.typeId !== "minecraft:player") return;
        const player = e.source as Player;
        const block = e.block.offset(FaceOffsets[e.blockFace]);
        if (!block) return;
        const rot = player.getRotation().y;
        const direction: Cardinal_Direction = rot >= -45 && rot < 45 ? "north" : rot >= 45 && rot < 135 ? "east" : rot >= -135 && rot < -45 ? "west" : "south";
        // The same placer component is shared by both instruments; the held
        // item decides which assembly is built.
        const definition = e.itemStack?.typeId === grandDefinition.itemId ? grandDefinition : pianoDefinition;
        if (!placeInstrument({ dimension: block.dimension, pos: block.location, direction, definition })) return;
        if (player.getGameMode() === GameMode.Creative) return;
        const slot = player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
        if (!slot) return;
        const item = e.itemStack;
        if (item.amount <= 1) slot.setItem(undefined);
        else { item.amount--; slot.setItem(item); }
    },
};
