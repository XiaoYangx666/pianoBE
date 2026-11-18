import { VFX_EMITTERS_PER_TICK, type VfxEmitter } from "./vfxLab";
import type { VfxBatch } from "./vfxPreset";

export const VFX_MAX_PIANOS = 4;
export const VFX_PARTICLES_PER_PIANO = 275;

/** A reservation covers the pending and live lifetime of a Bedrock emitter. */
export class VfxBudget {
    private readonly pending: (VfxBatch & { index: number })[] = [];
    private live: { expires: number; emitter: VfxEmitter }[] = [];
    reserved = 0;
    dropped = 0;

    get active() { return this.live.length; }

    expire(tick: number) {
        this.live = this.live.filter(({ expires, emitter }) => {
            if (expires > tick) return true;
            this.reserved -= emitter.particles;
            return false;
        });
    }

    clearPending() {
        for (const { emitters, index } of this.pending) {
            for (let i = index; i < emitters.length; i++) this.reserved -= emitters[i].particles;
        }
        this.pending.length = 0;
    }

    nextAvailableTick(tick: number) {
        return this.live.reduce((latest, { expires }) => Math.max(latest, expires), tick);
    }

    enqueue(candidates: readonly VfxBatch[]) {
        for (const candidate of candidates) {
            const cost = candidate.emitters.reduce((sum, emitter) => sum + emitter.particles, 0);
            if (!cost) continue;
            // Preserve in-progress batches so multi-column effects keep their composition.
            for (let i = this.pending.length - 1; i >= 0 && this.reserved + cost > VFX_PARTICLES_PER_PIANO; i--) {
                const pending = this.pending[i];
                if (pending.index || pending.priority >= candidate.priority) continue;
                this.pending.splice(i, 1);
                this.reserved -= pending.emitters.reduce((sum, emitter) => sum + emitter.particles, 0);
                this.dropped++;
            }
            if (this.reserved + cost > VFX_PARTICLES_PER_PIANO) { this.dropped++; continue; }
            this.reserved += cost;
            this.pending.push({ ...candidate, index: 0 });
        }
        if (candidates.length) this.pending.sort((a, b) => b.priority - a.priority);
    }

    dispatch(tick: number, spawn: (emitter: VfxEmitter) => void) {
        for (let count = 0; count < VFX_EMITTERS_PER_TICK && this.pending.length; count++) {
            const batch = this.pending[0];
            const emitter = batch.emitters[batch.index];
            spawn(emitter);
            batch.index++;
            if (batch.index === batch.emitters.length) this.pending.shift();
            this.live.push({ expires: tick + Math.ceil(emitter.lifetime * 20) + 2, emitter });
        }
    }

    reservations() {
        const totals = new Map<VfxEmitter["effect"], number>();
        const add = (emitter: VfxEmitter) => totals.set(emitter.effect, (totals.get(emitter.effect) ?? 0) + emitter.particles);
        this.live.forEach(({ emitter }) => add(emitter));
        for (const { emitters, index } of this.pending) emitters.slice(index).forEach(add);
        return totals;
    }
}
