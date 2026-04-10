import { Vector3 } from "@minecraft/server";

export const RightOffsets: Record<Cardinal_Direction, Vector3> = {
    north: { x: -1, y: 0, z: 0 },
    south: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    west: { x: 0, y: 0, z: 1 },
};
export type Cardinal_Direction = "east" | "west" | "north" | "south";
