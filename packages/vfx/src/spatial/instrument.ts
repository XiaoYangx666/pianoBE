import type { Vec3 } from "../types";
import type { Point3 } from "./geometry";
import {
    GRAND_KEY_HITBOXES,
    GRAND_PARTICLE_LINE,
    GRAND_STAGE_TAIL,
    UPRIGHT_KEY_HITBOXES,
    UPRIGHT_PARTICLE_LINE,
    UPRIGHT_STAGE_TAIL,
} from "../data/keys.generated";

/** The two instrument models share every VFX stage, key origin and particle anchor. */
export type VfxInstrument = "upright" | "grand";

type KeyBox = readonly (readonly [number, number, number, number, number, number, number, number, number])[];

interface InstrumentLayout {
    readonly keys: KeyBox;
    readonly particleLine: { readonly y: number; readonly z: number };
    readonly tail: number;
}

const LAYOUTS: Readonly<Record<VfxInstrument, InstrumentLayout>> = {
    upright: { keys: UPRIGHT_KEY_HITBOXES, particleLine: UPRIGHT_PARTICLE_LINE, tail: UPRIGHT_STAGE_TAIL },
    grand: { keys: GRAND_KEY_HITBOXES, particleLine: GRAND_PARTICLE_LINE, tail: GRAND_STAGE_TAIL },
};

function buildKeyCenters(keys: KeyBox) {
    const centers = new Map<number, Point3>();
    for (const [midi, x, , z, X, y, Z] of keys) {
        if (!centers.has(midi)) centers.set(midi, [(x + X) / 2, y, (z + Z) / 2]);
    }
    return centers;
}

const KEY_CENTERS: Readonly<Record<VfxInstrument, ReadonlyMap<number, Point3>>> = {
    upright: buildKeyCenters(UPRIGHT_KEY_HITBOXES),
    grand: buildKeyCenters(GRAND_KEY_HITBOXES),
};

/** Stage frame in model space: +z points behind the instrument, toward the audience. */
export function vfxStageFrame(instrument: VfxInstrument = "upright") {
    const tail = LAYOUTS[instrument].tail;
    const playerEdge = -1.4;
    const cabinetEdge = 0.45 + tail;
    return {
        centerZ: (playerEdge + cabinetEdge) / 2,
        depth: 1 + tail / 4.4,
    };
}

/** Key origin used by VFX emitters, relative to the instrument center and stage frame. */
export function keyOriginFor(midi: number, instrument: VfxInstrument = "upright"): Point3 | undefined {
    const center = KEY_CENTERS[instrument].get(midi);
    if (!center) return undefined;
    const stage = vfxStageFrame(instrument);
    return [-center[0] / 16, center[1] / 16 + 0.012, center[2] / 16 - stage.centerZ];
}

/** Convert a Bedrock model-space offset into a world offset for the given facing. */
export function pianoModelOffset(right: Vec3, x: number, y: number, z: number): Vec3 {
    return {
        x: (-right.x * x + right.z * z) / 16,
        y: y / 16,
        z: (-right.z * x - right.x * z) / 16,
    };
}

/**
 * World-space anchor for note particles. `onKey` targets the key surface; otherwise
 * the shared emission line sits behind the fallboard so trails read above the keys.
 */
export function keyParticleOrigin(
    center: Vec3,
    right: Vec3,
    midi: number,
    onKey = false,
    instrument: VfxInstrument = "upright",
): Vec3 | undefined {
    const key = KEY_CENTERS[instrument].get(midi);
    if (!key) return undefined;
    const [x, y, z] = key;
    const line = onKey ? undefined : LAYOUTS[instrument].particleLine;
    const offset = pianoModelOffset(right, x, line?.y ?? y + 0.4, line?.z ?? z);
    return { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
}
