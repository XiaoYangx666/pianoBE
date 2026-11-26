import { TIME_SCALE, reportDiagnostic } from "@piano/core";
import { resolveEffectCustomParams } from "../domain/effects";
import { quietFeatures, type MusicFeatures, type VfxKeyNote } from "./music";
import { addTimelineTicks, timelineTickAt, type TimelineTick } from "./time";
import type { VfxProgram } from "./programs";
import type { VfxInstrument } from "../spatial/instrument";
import { vfxRegistry, type VfxRegistry } from "../plugin/registry";
import { stagePropId } from "../plugin/plugin";
import type { PianoParticleOverride, VfxBatch, VfxEffectDefinition, VfxEffectParams, VfxStageProp } from "../types";

interface ChannelRuntime {
    nextTick: TimelineTick;
    lastNoteSequence: number;
    soloStep: number;
    effectState: unknown;
}

export interface VfxEngineUpdateOptions {
    emitFlashes?: boolean;
    solo?: boolean;
    nativeStageProp?: boolean | string;
}

export interface ResolvedVfxStageProp extends VfxStageProp {
    channelKey: string;
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
    private readonly yieldUntilByTag = new Map<string, TimelineTick>();
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
                reportDiagnostic("error", "vfx", "插件连续出错，已自动禁用", error, {
                    plugin: owner,
                    effect: def.id,
                    phase,
                });
            }
        } else {
            reportDiagnostic("warn", "vfx", "特效执行异常", error, {
                effect: def.id,
                phase,
            });
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

    reset(positionSeconds = 0) {
        this.runtimes.clear();
        this.yieldUntilByTag.clear();
        this.lastTimeSeconds = -Infinity;
        this.lastTick40 = -1;
        this.flashIndex = 0;
        this.manualFlashPending = false;
        if (positionSeconds > 0) {
            this.initializeRuntimes(timelineTickAt(positionSeconds));
            this.lastTick40 = positionSeconds * TIME_SCALE;
            const next = this.program.flashes.findIndex(cue => cue.tick40 > this.lastTick40);
            this.flashIndex = next < 0 ? this.program.flashes.length : next;
        }
    }

    seek(positionSeconds: number, resetEmitters = true) {
        this.lastTimeSeconds = positionSeconds;
        this.lastTick40 = positionSeconds * TIME_SCALE;
        if (resetEmitters) {
            this.runtimes.clear();
            this.yieldUntilByTag.clear();
            this.initializeRuntimes(timelineTickAt(positionSeconds));
        }
        const next = this.program.flashes.findIndex(cue => cue.tick40 > this.lastTick40);
        this.flashIndex = next < 0 ? this.program.flashes.length : next;
    }

    private initializeRuntimes(timelineTick: TimelineTick) {
        for (const channel of this.program.channels) {
            const def = this.getActiveEffect(channel.effect);
            this.runtimes.set(channel.key, {
                nextTick: timelineTick,
                lastNoteSequence: 0,
                soloStep: 0,
                effectState: this.safeCreateState(def),
            });
        }
    }

    triggerFlash() {
        this.manualFlashPending = true;
    }

    activeSummary(positionSeconds: number, music: Readonly<MusicFeatures> = quietFeatures, solo = false): ActiveChannelSummary[] {
        if (positionSeconds >= this.program.durationSeconds) return [];
        const timelineTick = timelineTickAt(positionSeconds);
        const summary: ActiveChannelSummary[] = [];
        for (const channel of this.program.channels) {
            const def = this.getActiveEffect(channel.effect);
            if (!def || def.trigger === "control") continue;
            const sample = channel.sample(positionSeconds, timelineTick, music, solo);
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

    keyParticleOverride(positionSeconds = 0, music: Readonly<MusicFeatures> = quietFeatures, solo = false): PianoParticleOverride | undefined {
        if (positionSeconds < 0 || positionSeconds >= this.program.durationSeconds) return undefined;
        const timelineTick = timelineTickAt(positionSeconds);
        let matchedSlot = -1;
        let matched: PianoParticleOverride | undefined;
        for (const channel of this.program.channels) {
            const def = this.getActiveEffect(channel.effect);
            if (!def || def.trigger !== "control" || !def.resolveKeyParticle) continue;
            const sample = channel.sample(positionSeconds, timelineTick, music, solo);
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

    stageProp(positionSeconds: number, music: Readonly<MusicFeatures>, solo = false): ResolvedVfxStageProp | undefined {
        if (positionSeconds < 0 || positionSeconds >= this.program.durationSeconds) return undefined;
        const tick = timelineTickAt(positionSeconds);
        for (const channel of this.program.channels) {
            const def = this.getActiveEffect(channel.effect);
            if (!def?.resolveStageProp) continue;
            const sample = channel.sample(positionSeconds, tick, solo ? quietFeatures : music, solo);
            if (!sample || sample.params.intensity < 0.005) continue;
            try {
                const prop = def.resolveStageProp(this.resolvedParams(def, sample.params), this.instrument);
                this.reportSuccess(def);
                if (!prop) continue;
                const owner = this.registry.getEffectOwner(def.id);
                const plugin = owner && this.registry.getPlugin(owner);
                if (!plugin || ![plugin.manifest.id, ...(plugin.manifest.dependencies ?? [])].some(id =>
                    !this.registry.isPluginDisabled(id) && this.registry.getPlugin(id)?.manifest.stageProps?.some(
                        item => stagePropId(id, item.id) === prop.id,
                    ))) continue;
                if (![prop.offset?.x, prop.offset?.y, prop.offset?.z, prop.size, prop.turn].every(Number.isFinite)) continue;
                if (prop.animation !== undefined && typeof prop.animation !== "string") continue;
                return { ...prop, channelKey: channel.key };
            } catch (error) {
                this.reportFailure(def, "resolveStageProp", error);
            }
        }
        return undefined;
    }

    private runtimeFor(key: string, def: VfxEffectDefinition): ChannelRuntime {
        let runtime = this.runtimes.get(key);
        if (!runtime) {
            runtime = {
                nextTick: timelineTickAt(0),
                lastNoteSequence: 0,
                soloStep: 0,
                effectState: this.safeCreateState(def),
            };
            this.runtimes.set(key, runtime);
        }
        return runtime;
    }

    private recordYield(def: VfxEffectDefinition, timelineTick: TimelineTick) {
        if (!def.yields) return;
        const until = addTimelineTicks(timelineTick, def.yields.ticks);
        const prev = this.yieldUntilByTag.get(def.yields.tag);
        this.yieldUntilByTag.set(def.yields.tag, prev !== undefined && prev > until ? prev : until);
    }

    private isYielding(def: VfxEffectDefinition, timelineTick: TimelineTick): boolean {
        return Boolean(def.tags?.some(tag => timelineTick < (this.yieldUntilByTag.get(tag) ?? -Infinity)));
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
        lastNoteSequence: number,
        phase: number,
        solo: boolean,
        state: unknown,
        nativeStageProp = false,
    ): VfxBatch | null {
        if (!def.emit) return null;
        try {
            const batch = def.emit({
                params: this.resolvedParams(def, params),
                music,
                recentNotes,
                lastNoteSequence,
                instrument: this.instrument,
                phase,
                solo,
                state,
                nativeStageProp,
            });
            this.reportSuccess(def);
            return batch;
        } catch (error) {
            this.reportFailure(def, "emit", error);
            return null;
        }
    }

    update(
        positionSeconds: number,
        music: Readonly<MusicFeatures>,
        recentNotes: readonly VfxKeyNote[] = [],
        options: VfxEngineUpdateOptions = {},
    ): VfxBatch[] {
        const emitFlashes = options.emitFlashes ?? true;
        const solo = options.solo ?? false;

        if (positionSeconds < this.lastTimeSeconds) {
            throw new Error("VFX engine timeline moved backwards; seek must reset the whole performance session");
        }
        const timelineTick = timelineTickAt(positionSeconds);
        const tick40 = positionSeconds * TIME_SCALE;
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
                0,
                (cue.tick40 * 17) % 360,
                solo,
                this.safeCreateState(def),
            );
            if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
            this.recordYield(def, timelineTick);
        }

        if (positionSeconds < this.program.durationSeconds) {
            for (const channel of this.program.channels) {
                const def = this.getActiveEffect(channel.effect);
                if (!def || def.trigger === "control") continue;
                const runtime = this.runtimeFor(channel.key, def);

                if (def.trigger === "instant") {
                    const sample = channel.sample(positionSeconds, timelineTick, solo ? quietFeatures : music, solo);
                    if (!sample || sample.params.intensity < 0.005) continue;
                    const manual = this.manualFlashPending;
                    const gatedPulse = !manual && timelineTick >= runtime.nextTick && Boolean(sample.gated);
                    if (!manual && !gatedPulse) continue;
                    if (manual) this.manualFlashPending = false;
                    const batch = this.emitChannel(
                        def,
                        sample.params,
                        solo ? quietFeatures : music,
                        recentNotes,
                        runtime.lastNoteSequence,
                        (timelineTick * 17 + channel.slot * 41) % 360,
                        solo,
                        runtime.effectState,
                    );
                    if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
                    this.recordYield(def, timelineTick);
                    runtime.nextTick = addTimelineTicks(timelineTick, Math.max(1, sample.cooldownTicks ?? 45));
                    continue;
                }

                if (this.isYielding(def, timelineTick)) continue;
                if (timelineTick < runtime.nextTick) continue;

                const effectiveMusic = solo ? quietFeatures : music;
                const sample = channel.sample(positionSeconds, timelineTick, effectiveMusic, solo);
                if (!sample || sample.params.intensity < 0.005) continue;

                if (def.trigger === "note") {
                    const hasFresh = recentNotes.some(note => note.sequence > runtime.lastNoteSequence);
                    if (!hasFresh && !solo) continue;
                    const phase = hasFresh ? (timelineTick * 9 + channel.slot * 41) % 360 : runtime.soloStep;
                    const batch = this.emitChannel(
                        def,
                        sample.params,
                        effectiveMusic,
                        recentNotes,
                        runtime.lastNoteSequence,
                        phase,
                        solo,
                        runtime.effectState,
                    );
                    if (hasFresh) {
                        for (const note of recentNotes) {
                            if (note.sequence > runtime.lastNoteSequence) runtime.lastNoteSequence = note.sequence;
                        }
                        runtime.nextTick = addTimelineTicks(timelineTick, Math.max(1, def.interval));
                    } else {
                        runtime.nextTick = addTimelineTicks(timelineTick, 8);
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
                    runtime.lastNoteSequence,
                    (timelineTick * 9 + channel.slot * 41) % 360,
                    solo,
                    runtime.effectState,
                    options.nativeStageProp === true || options.nativeStageProp === channel.key,
                );
                const interval = this.safeNextInterval(def, sample.params, runtime.effectState);
                runtime.nextTick = addTimelineTicks(timelineTick, Math.max(1, interval));
                this.recordYield(def, timelineTick);
                if (batch && Array.isArray(batch.emitters) && batch.emitters.length) batches.push(batch);
            }
        }

        this.lastTimeSeconds = positionSeconds;
        this.lastTick40 = tick40;
        return batches.sort((a, b) => b.priority - a.priority);
    }
}
