/**
 * Flat native text (pitch 90) spins in the plane opposite to the entity/block
 * cardinal rotation. Reusing the entity yaw directly leaves east/west text
 * upside down, so mirror it back before applying the 180° reading offset.
 */
export function flatTextYaw(entityYaw: number) {
    return 180 - entityYaw;
}
