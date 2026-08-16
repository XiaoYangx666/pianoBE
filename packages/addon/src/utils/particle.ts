import { Dimension, MolangVariableMap, Vector3 } from "@minecraft/server";
import { Cardinal_Direction } from "@types";
import { RightOffsets } from "./block";
import { Vector3Utils } from "sapi-pro";

export const particleOffset: Record<
    Cardinal_Direction,
    { left: Vector3; right: Vector3 }
> = {
    north: { left: { x: 1, y: 1, z: 0.8 }, right: { x: 0, y: 1, z: 0.8 } },
    south: { left: { x: 0, y: 1, z: 0.2 }, right: { x: 1, y: 1, z: 0.2 } },
    east: { left: { x: 0.2, y: 1, z: 1 }, right: { x: 0.2, y: 1, z: 0 } },
    west: { left: { x: 0.8, y: 1, z: 0 }, right: { x: 0.8, y: 1, z: 1 } },
};

export function summonParticle(
    dim: Dimension,
    leftBlock: Vector3,
    dir: Cardinal_Direction,
    midi: number
) {
    const rightBlock = Vector3Utils.add(leftBlock, RightOffsets[dir]);
    const left = Vector3Utils.add(leftBlock, particleOffset[dir].left);
    const right = Vector3Utils.add(rightBlock, particleOffset[dir].right);
    // 🎯 可调范围（钢琴常用范围）
    const MIN = 21; // A0
    const MAX = 108; // C8

    // clamp
    const tRaw = (midi - MIN) / (MAX - MIN);
    const t = Math.max(0, Math.min(1, tRaw));

    // 📍 位置插值
    const pos = {
        x: left.x + (right.x - left.x) * t,
        y: left.y + (right.y - left.y) * t,
        z: left.z + (right.z - left.z) * t,
    };

    // 🎨 颜色映射（HSV → RGB）
    const hue = t * 360; // 0~360
    const { r, g, b } = hsvToRgb(hue, 1, 1);

    const molang = new MolangVariableMap();
    molang.setColorRGB("note_color", {
        red: r,
        green: g,
        blue: b,
    });

    dim.spawnParticle("minecraft:note_particle", pos, molang);
}

function hsvToRgb(h: number, s: number, v: number) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0,
        g = 0,
        b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return {
        r: r + m,
        g: g + m,
        b: b + m,
    };
}
