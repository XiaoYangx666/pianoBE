import type { Entity } from "@minecraft/server";
import { RightOffsets } from "@domain/geometry/offsets";
import { vfxInstrumentFor } from "@domain/instrument/definition";
import { placeVfxStageProp, vfxStageFrame, type VfxStageProp } from "@piano/vfx";
import { instrumentCenter } from "@platform/assembly";
import type { InstrumentLocation } from "@platform/instrumentLocation";

const ENTITY_IDS = { porcelain_vase: "pbe:vfx_porcelain_vase" } as const;

/** One transient native prop belongs to the current performance on an instrument. */
export class VfxPropRenderer {
    private entity?: Entity;
    private size?: number;
    private turn?: number;
    private retryAt = 0;

    constructor(private readonly location: InstrumentLocation) {}

    render(prop: VfxStageProp | undefined, tick: number): boolean {
        if (!prop) {
            this.clear();
            return false;
        }
        if (tick < this.retryAt) return false;
        const { x, y, z } = prop.offset;
        if (![x, y, z, prop.size, prop.turn].every(Number.isFinite)) return false;
        const identifier = ENTITY_IDS[prop.model];
        if (!identifier) return false;
        try {
            if (!this.entity?.isValid) {
                const { dimension, direction, definition } = this.location;
                const { position, yaw } = placeVfxStageProp(
                    instrumentCenter(this.location), RightOffsets[direction], vfxStageFrame(vfxInstrumentFor(definition)), prop,
                );
                if (!dimension.isChunkLoaded(position)) return false;
                this.entity = dimension.spawnEntity(identifier, position, { initialRotation: yaw });
                this.size = undefined;
                this.turn = undefined;
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
            this.retryAt = tick + 40;
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
