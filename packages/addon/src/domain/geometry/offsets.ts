import type { Cardinal_Direction } from "@domain/types";

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export const RightOffsets: Record<Cardinal_Direction, Vec3> = {
    north: { x: -1, y: 0, z: 0 },
    south: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    west: { x: 0, y: 0, z: 1 },
};

export const PairOffsets: Record<
    Cardinal_Direction,
    { left: Vec3; right: Vec3 }
> = {
    north: {
        left: RightOffsets.north,
        right: { x: -RightOffsets.north.x, y: -RightOffsets.north.y, z: -RightOffsets.north.z },
    },
    south: {
        left: RightOffsets.south,
        right: { x: -RightOffsets.south.x, y: -RightOffsets.south.y, z: -RightOffsets.south.z },
    },
    west: {
        left: RightOffsets.west,
        right: { x: -RightOffsets.west.x, y: -RightOffsets.west.y, z: -RightOffsets.west.z },
    },
    east: {
        left: RightOffsets.east,
        right: { x: -RightOffsets.east.x, y: -RightOffsets.east.y, z: -RightOffsets.east.z },
    },
};
