import type { InstrumentDefinition } from "@domain/instrument/definition";

/**
 * Positive model depth points away from the pianist. Assembly "forward"
 * points the other way, so the grand's tail extends in negative forward.
 */
export function vfxStageFrame(definition?: InstrumentDefinition) {
    let tail = 0;
    for (const part of definition?.parts ?? []) tail = Math.max(tail, -(part.forward ?? 0));
    const playerEdge = -1.4;
    const cabinetEdge = 0.45 + tail;
    return {
        centerZ: (playerEdge + cabinetEdge) / 2,
        depth: 1 + tail / 4.4,
    };
}
