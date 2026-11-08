import type { Vector3 } from "@minecraft/server";
import { CASE_HITBOXES, KEYBOARD_HITBOX, KEY_HITBOXES, KEY_PRESS_DEGREES, MENU_HITBOX, MIDI_MENU_HITBOX } from "./hitboxes.generated";

type Vec = readonly [number, number, number];
type Box = readonly [number, number, number, number, number, number];
type KeyBox = typeof KEY_HITBOXES[number];
const AXES = [0, 1, 2] as const;
// Match Tabletop's playerViewRay eye-height correction.
const HEAD_TO_EYE_Y = .1;
const SIN = Math.sin(KEY_PRESS_DEGREES * Math.PI / 180);
const COS = Math.cos(KEY_PRESS_DEGREES * Math.PI / 180);
const FIRST_COLUMN = Math.floor(KEYBOARD_HITBOX[0]);
const LAST_COLUMN = Math.floor(KEYBOARD_HITBOX[3]);
const columns: KeyBox[][] = Array.from({ length: LAST_COLUMN - FIRST_COLUMN + 1 }, () => []);
for (const key of KEY_HITBOXES) {
    for (let x = Math.floor(key[1]); x <= Math.floor(key[4]); x++) {
        columns[x - FIRST_COLUMN].push(key);
    }
}

export interface PianoRay {
    origin: Vec;
    direction: Vec;
}

/** Model-space ray with t still measured in blocks. */
export function pianoRay(center: Vector3, right: Vector3, head: Vector3, view: Vector3): PianoRay {
    const toModel = (x: number, y: number, z: number): Vec =>
        [-16 * (right.x * x + right.z * z), 16 * y, 16 * (right.z * x - right.x * z)];
    return {
        origin: toModel(head.x - center.x, head.y + HEAD_TO_EYE_Y - center.y, head.z - center.z),
        direction: toModel(view.x, view.y, view.z),
    };
}

function inverseKeyPose(ray: PianoRay, box: KeyBox): PianoRay {
    const py = box[7], pz = box[8];
    const [x, y, z] = ray.origin;
    const [dx, dy, dz] = ray.direction;
    return {
        origin: [x, py + COS * (y - py) - SIN * (z - pz), pz + SIN * (y - py) + COS * (z - pz)],
        direction: [dx, COS * dy - SIN * dz, SIN * dy + COS * dz],
    };
}

function intersect(ray: PianoRay, bounds: Box | KeyBox, offset: 0 | 1, limit: number) {
    let enter = 0;
    let exit = limit;
    for (const axis of AXES) {
        const origin = ray.origin[axis];
        const velocity = ray.direction[axis];
        const min = bounds[axis + offset];
        const max = bounds[axis + offset + 3];
        if (Math.abs(velocity) < 1e-9) {
            if (origin < min || origin > max) return;
            continue;
        }
        const a = (min - origin) / velocity;
        const b = (max - origin) / velocity;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (enter > exit) return;
    }
    return { enter, exit };
}

export function pickPianoKey(ray: PianoRay, range = 4, isDown?: (midi: number) => boolean): number | undefined {
    const keyboard = intersect(ray, KEYBOARD_HITBOX, 0, range);
    if (!keyboard) return;
    const nearX = ray.origin[0] + ray.direction[0] * keyboard.enter;
    const farX = ray.origin[0] + ray.direction[0] * keyboard.exit;
    const first = Math.max(0, Math.floor(Math.min(nearX, farX)) - FIRST_COLUMN);
    const last = Math.min(columns.length - 1, Math.floor(Math.max(nearX, farX)) - FIRST_COLUMN);

    let distance = range;
    let midi: number | undefined;
    for (let i = first; i <= last; i++) {
        for (const box of columns[i]) {
            if (i > first && box[1] < i + FIRST_COLUMN) continue;
            const hit = intersect(isDown?.(box[0]) ? inverseKeyPose(ray, box) : ray, box, 1, distance);
            if (hit && hit.enter <= distance) {
                midi = box[0];
                distance = hit.enter;
            }
        }
    }
    if (midi === undefined) return;
    // The vanilla click already resolves world occlusion. Check the case itself
    // so a click on the back, ends or panel cannot play a hidden key.
    for (const box of CASE_HITBOXES) {
        const hit = intersect(ray, box, 0, distance);
        if (hit && hit.enter < distance - 1e-6) return;
    }
    return midi;
}

export function pickPianoMenu(ray: PianoRay, range = 4): "menu" | "midi" | undefined {
    let nearest: { kind: "menu" | "midi"; distance: number } | undefined;
    for (const [kind, box] of [["menu", MENU_HITBOX], ["midi", MIDI_MENU_HITBOX]] as const) {
        const hit = intersect(ray, box, 0, range);
        if (hit && (!nearest || hit.enter < nearest.distance)) nearest = { kind, distance: hit.enter };
    }
    if (!nearest || CASE_HITBOXES.some(box =>
        (intersect(ray, box, 0, nearest!.distance)?.enter ?? Infinity) < nearest!.distance - 1e-6)) return;
    return nearest.kind;
}

export function hitsPianoMenu(ray: PianoRay, range = 4): boolean {
    return pickPianoMenu(ray, range) === "menu";
}
