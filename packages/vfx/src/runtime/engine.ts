import { TIME_SCALE } from "@piano/core";
import { resolveEffectCustomParams } from "../domain/effects";
import { quietFeatures, type MusicFeatures, type VfxKeyNote } from "./music";
import type { VfxProgram } from "./programs";
import type { VfxInstrument } from "../spatial/instrument";
import { vfxRegistry, type VfxRegistry } from "../plugin/registry";
import type { PianoParticleOverride, VfxBatch, VfxEffectDefinition, VfxEffectParams } from "../types";

interface ChannelRuntime {
    nextTick: number;
    lastNoteTick: number;
    soloStep: number;
    effectState: unknown;
}

export interface VfxEngineUpdateOptions {
    emitFlashes?: boolean;
    solo?: boolean;
}

export interface ActiveChannelSummary {
    effect: string;
    label: string;
    slot: number;
    level: number;
}

/**
 * 统一的 VFX 执行引擎：驱动曲目编排、音乐响应主题与单特效预览。
 * 控制参数完全由 `VfxProgram` 提供，特效自身行为与跨帧状态由注册定义管理。
 */
export class VfxEngine {
    private readonly runtimes = new Map<string, ChannelRuntime>();
    private readonly yieldUntilByTag = new Map<string, number>();
    private lastTimeSeconds = -Infinity;
    private lastTick40 = -1;
    private flashIndex = 0;
    private manualFlashPending = false;

    constructor(
        private program: VfxProgram,
        private readonly instrument: VfxInstrument = "upright",
        private readonly registry: VfxRegistry = vfxRegistry,
    ) {}

    setProgram(program: VfxProgram, resetState = true) {
        this.program = program;
        if (resetState) this.reset(0);
    }

    private getActiveEffect(effectId: string): VfxEffectDefinition | undefined {
        const def = this.registry.getEffect(effectId);
        if (!def) return undefined;
        const owner = this.registry.getEffectOwner(effectId);
        if (owner && this.registry.isPluginDisabled(owner)) return undefined;
        return def;
    }

    private reportFailure(def: VfxEffectDefinition, phase: string, error: unknown) {
        const owner = this.registry.getEffectOwner(def.id);
        if (owner) {
            const disabled = this.registry.recordPluginError(owner, {
                effectId: def.id,
                phase,
                error,
            });
            if (disabled) {
                console.warn(`[piano-vfx] 插件 ${owner} 连续出错，已自动禁用`, error);
            }
        } else {
            console.warn(`[piano-vfx] 特效 ${def.id} (${phase}) 执行异常`, error);
        }
    }

    private reportSuccess(def: VfxEffectDefinition) {
        const owner = this.registry.getEffectOwner(def.id);
        if (owner) this.registry.recordPluginSuccess(owner);
    }

    private safeCreateState(def: VfxEffectDefinition | undefined): unknown {
        if (!def?.createState) return undefined;
        try {
            return def.createState();
        } catch (error) {
            this.reportFailure(def, "createState", error);
            return undefined;
        }
    }

    private safeNextInterval(def: VfxEffectDefinition, params: VfxEffectParams, state: unknown): number {
        if (!def.nextInterval) return def.interval;
        try {
            const next = def.nextInterval(this.resolvedParams(def, params), state);
            return Number.isFinite(next) ? next : def.interval;
        } catch (error) {
            this.reportFailure(def, "nextInterval", error);
            return def.interval;
        }
    }

    private safeResolveKeyParticle(def: VfxEffectDefinition, params: VfxEffectParams): PianoParticleOverride | undefined {
        if (!def.resolveKeyParticle) return undefined;
        try {
            const override = def.resolveKeyParticle(this.resolvedParams(def, params));
            this.reportSuccess(def);
            return override;
        } catch (error) {
            this.reportFailure(def, "resolveKeyParticle", error);
            return undefined;
        }
    }

    reset(gameTick = 0) {
        this.runtimes.clear();
        this.yieldUntilByTag.clear();
        this.lastTimeSeconds = -Infinity;
        this.lastTick40 = -1;
        this.flashIndex = 0;
        this.manualFlashPending = false;
        if (gameTick > 0) {
            for (const channel of this.program.channels) {
                const def = this.getActiveEffect(channel.effect);
                this.runtimes.set(channel.key, {
                    nextTick: gameTick,
                    lastNoteTick: -1,
                    soloStep: 0,
                    effectState: this.safeCreateState(def),
                });
            }
        }
    }

    seek(timeSeconds: number, resetEmitters = true) {
        this.lastTimeSeconds = timeSeconds;
        this.lastTick40 = timeSeconds * TIME_SCALE;
        const gameTick = Math.floor(this.lastTick40 / 2);
        if (resetEmitters) {
            this.runtimes.clear();
            this.yieldUntilByTag.clear();
            for (const channel of this.program.channels) {
                const def = this.getActiveEffect(channel.effect);
                this.runtimes.set(channel.key, {
                    nextTick: gameTick,
                    lastNoteTick: -1,
                    soloStep: 0,
                    effectState: this.safeCreateState(def),
                });
            }
        }
        const next = this.program.flashes.findIndex(cue => cue.tick40 > this.lastTick40);
        this.flashIndex = next < 0 ? this.program.flashes.length : next;
    }

    triggerFlash() {
        this.manualFlashPending = true;
    }

    activeSummary(timeSeconds: number, music: Readonly<MusicFeatures> = quietFeatures, solo = false): ActiveChannelSummary[] {
        if (timeSeconds >= this.program.durationSeconds) return [];
        const gameTick = Math.floor(timeSeconds * 20 + 1e-6);
        const summary: ActiveChannelSummary[] = [];
        for (const channel of this.program.channels) {
            const def = this.getActiveEffect(channel.effect);
            if (!def || def.trigger === "control") continue;
            const sample = channel.sample(timeSeconds, gameTick, music, solo);
            if (!sample || sample.params.intensity < 0.005) continue;
            summary.push({
                effect: def.id,
                label: def.label,
                slot: channel.slot,
                level: Math.round(sample.params.intensity * 100),
            });
        }
        return summary;
    }

    keyParticleOverride(timeSeconds = 0, music: Readonly<MusicFeatures> = quietFeatures, solo = false): PianoParticleOverride | undefined {
        if (timeSeconds < 0 || timeSeconds >= this.program.durationSeconds) return undefined;
        const gameTick = Math.floor(timeSeconds * 20 + 1e-6);
        let matchedSlot = -1;
        let matched: PianoParticleOverride | undefined;
        for (const channel of this.program.channels) {
            const def = this.getActiveEffect(channel.effect);
            if (!def || def.trigger !== "control" || !def.resolveKeyParticle) continue;
            const sample = channel.sample(timeSeconds, gameTick, music, solo);
            if (!sample || sample.params.intensity < 0.005) continue;
            if (channel.slot >= matchedSlot) {
                const override = this.safeResolveKeyParticle(def, sample.params);
                if (override) {
                    matchedSlot = channel.slot;
                    matched = override;
                }
            }
        }
        return matched ?? this.program.staticKeyParticle;
    }

    private runtimeFor(key: string, def: VfxEffectDefinition): ChannelRuntime {
        let runtime = this.runtimes.get(key);
        if (!runtime) {
            runtime = {
                nextTick: 0,
                lastNoteTick: -1,
                soloStep: 0,
                effectState: this.safeCreateState(def),
            };
            this.runtimes.set(key, runtime);
        }
        return runtime;
    }

    private recordYield(def: VfxEffectDefinition, gameTick: number) {
        if (!def.yields) return;
        const prev = this.yieldUntilByTag.get(def.yields.tag) ?? -Infinity;
        this.yieldUntilByTag.set(def.yields.tag, Math.max(prev, gameTick + def.yields.ticks));
    }

    private isYielding(def: VfxEffectDefinition, gameTick: number): boolean {
        return Boolean(def.tags?.some(tag => gameTick < (this.yieldUntilByTag.get(tag) ?? -Infinity)));
    }

    private resolvedParams(def: VfxEffectDefinition, params: VfxEffectParams): VfxEffectParams {
        if (!def.parameters) return params;
        return { ...params, custom: resolveEffectCustomParams(def, params.custom, this.registry) };
    }

    private emitChannel(
        def: VfxEffectDefinition,
        params: VfxEffectParams,
        music: Readonly<MusicFeatures>,
        recentNotes: readonly VfxKeyNote[],
        lastNoteTick: number,
        phase: number,
        solo: boolean,
        state: unknown,
    ): VfxBatch | null {
        if (!def.emit) return null;
        try {
            const batch = def.emit({
                params: this.resolvedParams(def, params),
                music,
                recentNotes,
                lastNoteTick,
                instrument: this.instrument,
                phase,
                solo,
                state,
            });
            this.reportSuccess(def);
            return batch;
        } catch (error) {
            this.reportFailure(def, "emit", error);
            return null;
        }
    }

    update(
        timeSeconds: number,
        gameTick: number,
        music: Readonly<MusicFeatures>,
        recentNotes: readonly VfxKeyNote[] = [],
        options: VfxEngineUpdateOptions = {},
    ): VfxBatch[] {
        const emitFlashes = options.emitFlashes ?? true;
        const solo = options.solo ?? false;

        if (timeSeconds < this.lastTimeSeconds) {
            this.seek(timeSeconds, true);
        }

        const tick40 = timeSeconds * TIME_SCALE;
        const batches: VfxBatch[] = [];

        while (this.flashIndex < this.program.flashes.length && this.program.flashes[this.flashIndex].tick40 <= tick40) {
            const cue = this.program.flashes[this.flashIndex++];
            if (!emitFlashes || cue.tick40 <= this.lastTick40) continue;
            const def = this.getActiveEffect(cue.effect);
            if (!def || !def.emit) continue;
            const batch = this.emitChannel(
                def,
                cue.params,
                music,
                recentNotes,
                -1,
                (cue.tick40 * 17) % 360,
                solo,
                this.safeCreateState(def),
            );
            if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
            this.recordYield(def, gameTick);
        }

        if (timeSeconds < this.program.durationSeconds) {
            for (const channel of this.program.channels) {
                const def = this.getActiveEffect(channel.effect);
                if (!def || def.trigger === "control") continue;
                const runtime = this.runtimeFor(channel.key, def);

                if (def.trigger === "instant") {
                    const sample = channel.sample(timeSeconds, gameTick, solo ? quietFeatures : music, solo);
                    if (!sample || sample.params.intensity < 0.005) continue;
                    const manual = this.manualFlashPending;
                    const gatedPulse = !manual && gameTick >= runtime.nextTick && Boolean(sample.gated);
                    if (!manual && !gatedPulse) continue;
                    if (manual) this.manualFlashPending = false;
                    const batch = this.emitChannel(
                        def,
                        sample.params,
                        solo ? quietFeatures : music,
                        recentNotes,
                        runtime.lastNoteTick,
                        (gameTick * 17 + channel.slot * 41) % 360,
                        solo,
                        runtime.effectState,
                    );
                    if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
                    this.recordYield(def, gameTick);
                    runtime.nextTick = gameTick + Math.max(1, sample.cooldownTicks ?? 45);
                    continue;
                }

                if (this.isYielding(def, gameTick)) continue;
                if (gameTick < runtime.nextTick) continue;

                const effectiveMusic = solo ? quietFeatures : music;
                const sample = channel.sample(timeSeconds, gameTick, effectiveMusic, solo);
                if (!sample || sample.params.intensity < 0.005) continue;

                if (def.trigger === "note") {
                    const hasFresh = recentNotes.some(note => note.tick > runtime.lastNoteTick);
                    if (!hasFresh && !solo) continue;
                    const phase = hasFresh ? (gameTick * 9 + channel.slot * 41) % 360 : runtime.soloStep;
                    const batch = this.emitChannel(
                        def,
                        sample.params,
                        effectiveMusic,
                        recentNotes,
                        runtime.lastNoteTick,
                        phase,
                        solo,
                        runtime.effectState,
                    );
                    if (hasFresh) {
                        for (const note of recentNotes) {
                            if (note.tick > runtime.lastNoteTick) runtime.lastNoteTick = note.tick;
                        }
                        runtime.nextTick = gameTick + Math.max(1, def.interval);
                    } else {
                        runtime.nextTick = gameTick + 8;
                        runtime.soloStep += 5;
                    }
                    if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
                    continue;
                }

                // continuous
                const batch = this.emitChannel(
                    def,
                    sample.params,
                    effectiveMusic,
                    recentNotes,
                    runtime.lastNoteTick,
                    (gameTick * 9 + channel.slot * 41) % 360,
                    solo,
                    runtime.effectState,
                );
                const interval = this.safeNextInterval(def, sample.params, runtime.effectState);
                runtime.nextTick = gameTick + Math.max(1, interval);
                this.recordYield(def, gameTick);
                if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
            }
        }

        this.lastTimeSeconds = timeSeconds;
        this.lastTick40 = tick40;
        return batches.sort((a, b) => b.priority - a.priority);
    }
}
