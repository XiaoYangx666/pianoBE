import type { Entity } from "@minecraft/server";
import { RightOffsets } from "@domain/geometry/offsets";
import { vfxInstrumentFor } from "@domain/instrument/definition";
import { hostTickAt, placeVfxStageProp, vfxStageFrame, type HostTick, type Vec3, type VfxStageProp } from "@piano/vfx";
import type { StagePropRegistration } from "@piano/vfx/package";
import { instrumentCenter } from "@platform/assembly";
import type { InstrumentLocation } from "@platform/instrumentLocation";

/** One transient native prop belongs to the current performance on an instrument. */
export class VfxPropRenderer {
    private entity?: Entity;
    private size?: number;
    private turn?: number;
    private position?: Vec3;
    private animation = 0;
    private retryAt = hostTickAt(0);
    private failedId?: string;

    constructor(
        private readonly location: InstrumentLocation,
        private readonly registrations: ReadonlyMap<string, StagePropRegistration>,
    ) {}

    render(prop: VfxStageProp | undefined, hostTick: HostTick): boolean {
        const registration = prop && this.registrations.get(prop.id);
        const animation = prop?.animation === undefined ? 0 : (registration?.animations.indexOf(prop.animation) ?? -1) + 1;
        if (!prop || !registration || (prop.animation !== undefined && animation === 0)
            || ![prop.offset?.x, prop.offset?.y, prop.offset?.z, prop.size, prop.turn].every(Number.isFinite)) {
            this.clear();
            return false;
        }
        if (registration.id === this.failedId && hostTick < this.retryAt) {
            this.clear();
            return false;
        }
        const { entityId } = registration;
        const { dimension, direction, definition, pos } = this.location;
        try {
            const { position, yaw } = placeVfxStageProp(
                instrumentCenter(this.location), RightOffsets[direction], vfxStageFrame(vfxInstrumentFor(definition)), prop,
            );
            if (!dimension.isChunkLoaded(pos) || !dimension.isChunkLoaded(position)) {
                this.clear();
                return false;
            }
            if (this.entity?.isValid && (this.entity.typeId !== entityId || this.animation !== animation)) this.clear();
            if (!this.entity?.isValid) {
                this.entity = dimension.spawnEntity(entityId, position, { initialRotation: yaw });
                this.size = undefined;
                this.turn = undefined;
                this.position = position;
                this.animation = animation;
                if (animation) this.entity.setProperty("pbe:vfx_animation", animation);
            } else if (this.position && Math.hypot(position.x - this.position.x, position.y - this.position.y,
                position.z - this.position.z) >= 0.006) {
                this.entity.teleport(position, { rotation: { x: 0, y: yaw } });
                this.position = position;
            }

            const size = Math.max(0.05, Math.min(2, Math.round(prop.size * 100) / 100));
            const turn = Math.max(-180, Math.min(180, Math.round(prop.turn)));
            if (size !== this.size) {
                this.entity.setProperty("pbe:vfx_size", size);
                this.size = size;
            }
            if (turn !== this.turn) {
                this.entity.setProperty("pbe:vfx_turn", turn);
                this.turn = turn;
            }
            return true;
        } catch {
            // Old templates and unloaded chunks can still render the particle version.
            this.clear();
            this.failedId = registration.id;
            this.retryAt = hostTickAt(hostTick + 40);
            return false;
        }
    }

    clear() {
        try {
            if (this.entity?.isValid) this.entity.remove();
        } catch {
            // A transient prop is discarded by Bedrock when its chunk unloads.
        } finally {
            this.entity = undefined;
        }
    }
}
