import type { Vec3 } from "./offsets";
import { GRAND_BUTTONS, GRAND_CASE_HITBOXES, GRAND_KEYBOARD_HITBOX, GRAND_KEY_HITBOXES, GRAND_PARTICLE_LINE } from "@data/grand.generated";
import { CASE_HITBOXES, KEYBOARD_HITBOX, KEY_HITBOXES, KEY_PRESS_DEGREES, MENU_HITBOX, MIDI_MENU_HITBOX, PIANO_PARTICLE_LINE, SETTINGS_HITBOX } from "@data/hitboxes.generated";

type Vec = readonly [number, number, number];
type Box = readonly [number, number, number, number, number, number];
type KeyBox = readonly [number, number, number, number, number, number, number, number, number];
type Button = readonly ["menu" | "midi" | "settings", Box];
const AXES = [0, 1, 2] as const;
// Match Tabletop's playerViewRay eye-height correction.
const HEAD_TO_EYE_Y = .1;
const SIN = Math.sin(KEY_PRESS_DEGREES * Math.PI / 180);
const COS = Math.cos(KEY_PRESS_DEGREES * Math.PI / 180);
function hitModel(keyboard: Box, keys: readonly KeyBox[], caseBoxes: readonly Box[],
    buttons: readonly Button[], particleLine: { y: number; z: number }) {
    const firstColumn = Math.floor(keyboard[0]);
    const lastColumn = Math.floor(keyboard[3]);
    const columns: KeyBox[][] = Array.from({ length: lastColumn - firstColumn + 1 }, () => []);
    const keyCenters = new Map<number, Vec>();
    for (const key of keys) {
        const [midi, x, , z, X, Y, Z] = key;
        // The first box is the front section of each white key.
        if (!keyCenters.has(midi)) keyCenters.set(midi, [(x + X) / 2, Y, (z + Z) / 2]);
        for (let column = Math.floor(x); column <= Math.floor(X); column++) {
            columns[column - firstColumn].push(key);
        }
    }
    // Only the body behind the keyboard opens the panel; the apron under the
    // keys and the cheeks beside them stay inert so playing cannot pop it open.
    const body = caseBoxes.filter(box => box[2] > keyboard[5]);
    return { keyboard, caseBoxes, buttons, particleLine, firstColumn, columns, keyCenters, body };
}

export const digitalPianoHitModel = hitModel(KEYBOARD_HITBOX, KEY_HITBOXES, CASE_HITBOXES,
    [["menu", MENU_HITBOX], ["midi", MIDI_MENU_HITBOX], ["settings", SETTINGS_HITBOX]], PIANO_PARTICLE_LINE);
export const grandPianoHitModel = hitModel(GRAND_KEYBOARD_HITBOX, GRAND_KEY_HITBOXES, GRAND_CASE_HITBOXES,
    GRAND_BUTTONS, { y: GRAND_PARTICLE_LINE[1], z: GRAND_PARTICLE_LINE[2] });

export interface PianoRay {
    origin: Vec;
    direction: Vec;
}

/** Model-space ray with t still measured in blocks. */
export function pianoRay(center: Vec3, right: Vec3, head: Vec3, view: Vec3): PianoRay {
    const toModel = (x: number, y: number, z: number): Vec =>
        [-16 * (right.x * x + right.z * z), 16 * y, 16 * (right.z * x - right.x * z)];
    return {
        origin: toModel(head.x - center.x, head.y + HEAD_TO_EYE_Y - center.y, head.z - center.z),
        direction: toModel(view.x, view.y, view.z),
    };
}

export function pianoModelOffset(right: Vec3, x: number, y: number, z: number): Vec3 {
    return {
        x: (-right.x * x + right.z * z) / 16,
        y: y / 16,
        z: (-right.z * x - right.x * z) / 16,
    };
}

export function pianoParticleOrigin(center: Vec3, right: Vec3, midi: number, onKey = false,
    model = digitalPianoHitModel): Vec3 | undefined {
    const key = model.keyCenters.get(midi);
    if (!key) return;
    const [x, y, z] = key;
    const offset = onKey
        ? pianoModelOffset(right, x, y + .4, z)
        : pianoModelOffset(right, x, model.particleLine.y, model.particleLine.z);
    return { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
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
    let face = -1;
    let sign = 0;
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
        const near = Math.min(a, b);
        if (near > enter) {
            enter = near;
            face = axis;
            sign = velocity > 0 ? -1 : 1;
        }
        exit = Math.min(exit, Math.max(a, b));
        if (enter > exit) return;
    }
    return { enter, exit, face, sign };
}

export function pickPianoKey(ray: PianoRay, range = 4, isDown?: (midi: number) => boolean,
    model = digitalPianoHitModel): number | undefined {
    const { columns, firstColumn } = model;
    const keyboard = intersect(ray, model.keyboard, 0, range);
    if (!keyboard) return;
    const nearX = ray.origin[0] + ray.direction[0] * keyboard.enter;
    const farX = ray.origin[0] + ray.direction[0] * keyboard.exit;
    const first = Math.max(0, Math.floor(Math.min(nearX, farX)) - firstColumn);
    const last = Math.min(columns.length - 1, Math.floor(Math.max(nearX, farX)) - firstColumn);

    let distance = range;
    let midi: number | undefined;
    for (let i = first; i <= last; i++) {
        for (const box of columns[i]) {
            if (i > first && box[1] < i + firstColumn) continue;
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
    for (const box of model.caseBoxes) {
        const hit = intersect(ray, box, 0, distance);
        if (hit && hit.enter < distance - 1e-6) return;
    }
    return midi;
}

export function pickPianoMenu(ray: PianoRay, range = 4, model = digitalPianoHitModel) {
    let nearest: { kind: Button[0]; distance: number } | undefined;
    for (const [kind, box] of model.buttons) {
        const hit = intersect(ray, box, 0, range);
        if (hit && (!nearest || hit.enter < nearest.distance)) nearest = { kind, distance: hit.enter };
    }
    if (!nearest || model.caseBoxes.some(box =>
        (intersect(ray, box, 0, nearest!.distance)?.enter ?? Infinity) < nearest!.distance - 1e-6)) return;
    return nearest.kind;
}

export function hitsPianoMenu(ray: PianoRay, range = 4): boolean {
    return pickPianoMenu(ray, range) === "menu";
}

/**
 * True when the click opens the panel: the top or the back of the piano body,
 * or a tap that misses every case box (touch players aim at the block, not at
 * the model). The apron under the keys, the side cheeks, the legs, the front
 * face and the sides stay inert so a missed key does not pop it open.
 */
export function pickPianoPanel(ray: PianoRay, range = 4, model = digitalPianoHitModel): boolean {
    let nearest: { distance: number; box: Box; face: number; sign: number } | undefined;
    for (const box of model.caseBoxes) {
        const hit = intersect(ray, box, 0, range);
        if (!hit || (nearest && hit.enter >= nearest.distance)) continue;
        nearest = { distance: hit.enter, box, face: hit.face, sign: hit.sign };
    }
    if (!nearest) return true;
    if (!model.body.includes(nearest.box)) return false;
    // Top (+Y) or back (+Z) of the body only.
    return nearest.sign > 0 && (nearest.face === 1 || nearest.face === 2);
}
