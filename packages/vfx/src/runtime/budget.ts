import { hostTickAt, type HostTick } from "./time";
import type { VfxBatch, VfxEmitter } from "../types";

export const VFX_MAX_PIANOS = 4;
export const VFX_PARTICLES_PER_PIANO = 275;
export const VFX_EMITTERS_PER_TICK = 6;

/** 预算只使用宿主时间，覆盖每个 Bedrock 发射器从排队到自然消亡的完整生命周期。 */
export class VfxBudget {
    private readonly pending: (VfxBatch & { index: number })[] = [];
    private live: { expires: HostTick; emitter: VfxEmitter }[] = [];
    reserved = 0;
    dropped = 0;

    get active() { return this.live.length; }

    expire(hostTick: HostTick) {
        this.live = this.live.filter(({ expires, emitter }) => {
            if (expires > hostTick) return true;
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

    nextAvailableTick(hostTick: HostTick): HostTick {
        return this.live.reduce((latest, { expires }) => expires > latest ? expires : latest, hostTick);
    }

    enqueue(candidates: readonly VfxBatch[]) {
        for (const candidate of candidates) {
            const cost = candidate.emitters.reduce((sum, emitter) => sum + emitter.particles, 0);
            if (!cost) continue;
            // 保留已经开始发射的批次，避免分段效果只发出半段。
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

    dispatch(hostTick: HostTick, spawn: (emitter: VfxEmitter) => void) {
        for (let count = 0; count < VFX_EMITTERS_PER_TICK && this.pending.length; count++) {
            const batch = this.pending[0];
            const emitter = batch.emitters[batch.index];
            spawn(emitter);
            batch.index++;
            if (batch.index === batch.emitters.length) this.pending.shift();
            this.live.push({
                expires: hostTickAt(hostTick + Math.ceil(emitter.lifetime * 20) + 2),
                emitter,
            });
        }
    }

    reservations() {
        const totals = new Map<string, number>();
        const add = (emitter: VfxEmitter) => totals.set(emitter.group, (totals.get(emitter.group) ?? 0) + emitter.particles);
        this.live.forEach(({ emitter }) => add(emitter));
        for (const { emitters, index } of this.pending) emitters.slice(index).forEach(add);
        return totals;
    }
}
