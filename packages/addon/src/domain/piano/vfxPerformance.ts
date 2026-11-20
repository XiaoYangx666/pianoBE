import {
    parsePerformanceRgb, TIME_SCALE,
    type PerformanceBrush, type PerformanceCue, type PerformanceMethod, type PerformanceMotion, type PerformanceZone,
} from "@piano/core";
import type { InstrumentDefinition } from "../instrument/definition";
import { deriveAccentHex, rgbToHex } from "./vfxDraw";
import { keyParticleOverrideFromCue, type PianoParticleOverride } from "./particleOverride";
import { clampUnit, mix, type MusicFeatures, type VfxKeyNote } from "./vfxMusic";
import { VFX_PAINTERS, type PainterContext, type PainterResult } from "./vfxPainters";
import type { VfxBatch } from "./vfxPreset";

export function emitPerformanceMethod(method: PerformanceMethod, context: PainterContext): PainterResult {
    return VFX_PAINTERS[method].emit(context);
}

interface ChannelState {
    intensity: number;
    scale: number;
    r: number;
    g: number;
    b: number;
    r2: number;
    g2: number;
    b2: number;
    brush: PerformanceBrush;
    zone: PerformanceZone;
    motion: PerformanceMotion;
}

interface Transition {
    tick: number;
    fade: number;
    from: ChannelState;
    to: ChannelState;
}

interface ChannelTrack {
    method: PerformanceMethod;
    slot: number;
    transitions: Transition[];
    nextTick: number;
    lastNoteTick: number;
    previousLength?: number;
    previousAmplitude?: number;
}

const DEFAULT_STATE: ChannelState = {
    intensity: 0,
    scale: 1,
    r: 255, g: 255, b: 255,
    r2: 255, g2: 255, b2: 255,
    brush: "default",
    zone: "stage",
    motion: "normal",
};

function sampleTrack(transitions: readonly Transition[], tick: number): ChannelState {
    let index = transitions.length - 1;
    while (index >= 0 && transitions[index].tick > tick) index--;
    const transition = transitions[index];
    if (!transition) return DEFAULT_STATE;
    const progress = transition.fade ? clampUnit((tick - transition.tick) / transition.fade) : 1;
    const smooth = progress * progress * (3 - 2 * progress);
    return {
        intensity: mix(transition.from.intensity, transition.to.intensity, smooth),
        scale: mix(transition.from.scale, transition.to.scale, smooth),
        r: mix(transition.from.r, transition.to.r, smooth),
        g: mix(transition.from.g, transition.to.g, smooth),
        b: mix(transition.from.b, transition.to.b, smooth),
        r2: mix(transition.from.r2, transition.to.r2, smooth),
        g2: mix(transition.from.g2, transition.to.g2, smooth),
        b2: mix(transition.from.b2, transition.to.b2, smooth),
        brush: transition.to.brush,
        zone: transition.to.zone,
        motion: transition.to.motion,
    };
}

/** Multi-slot cue player driving all 25 built-in methods; continuous tracks are pure functions of song time. */
export class VfxPerformancePlayer {
    private readonly tracks: ChannelTrack[] = [];
    private readonly flashes: PerformanceCue[] = [];
    private lastTick = -1;
    private flashIndex = 0;
    private soloStep = 0;

    constructor(
        cues: readonly PerformanceCue[],
        private readonly duration: number,
        private readonly definition?: InstrumentDefinition,
    ) {
        const byChannel = new Map<string, ChannelTrack>();
        for (const cue of cues) {
            const painter = VFX_PAINTERS[cue.method];
            if (!painter) continue;
            if (cue.op === "flash" || painter.instant) {
                this.flashes.push(cue);
                continue;
            }
            const slot = cue.slot ?? 0;
            const key = `${cue.method}:${slot}`;
            let track = byChannel.get(key);
            if (!track) {
                track = { method: cue.method, slot, transitions: [], nextTick: 0, lastNoteTick: -1 };
                byChannel.set(key, track);
                this.tracks.push(track);
            }
            const [r, g, b] = parsePerformanceRgb(cue.color);
            const resolvedColor2 = cue.color2 ?? deriveAccentHex(cue.color);
            const [r2, g2, b2] = parsePerformanceRgb(resolvedColor2);
            const target: ChannelState = {
                intensity: cue.level / 100,
                scale: cue.scale / 100,
                r, g, b,
                r2, g2, b2,
                brush: cue.brush ?? "default",
                zone: cue.zone ?? "stage",
                motion: cue.motion ?? "normal",
            };
            const prev = sampleTrack(track.transitions, cue.tick);
            const from: ChannelState = !track.transitions.length || prev.intensity <= 0.001
                ? { ...target, intensity: 0 }
                : prev;
            const to: ChannelState = cue.level === 0
                ? {
                    ...prev,
                    intensity: 0,
                    brush: cue.brush ?? prev.brush,
                    zone: cue.zone ?? prev.zone,
                    motion: cue.motion ?? prev.motion,
                }
                : target;
            track.transitions.push({ tick: cue.tick, fade: cue.fade, from, to });
        }
    }

    seek(seconds: number, resetEmitters = true) {
        this.lastTick = seconds * TIME_SCALE;
        const gameTick = Math.floor(this.lastTick / 2);
        if (resetEmitters) {
            for (const track of this.tracks) {
                track.nextTick = gameTick;
                track.lastNoteTick = -1;
                track.previousLength = undefined;
                track.previousAmplitude = undefined;
            }
            this.soloStep = 0;
        }
        const next = this.flashes.findIndex((cue) => cue.tick > this.lastTick);
        this.flashIndex = next < 0 ? this.flashes.length : next;
    }

    /** Active continuous channels at `seconds` for `/scriptevent pbe:vfx status` and Web Lab UI. */
    activeSummary(seconds: number): { method: PerformanceMethod; label: string; slot: number; level: number }[] {
        if (seconds >= this.duration) return [];
        const tick = seconds * TIME_SCALE;
        const list: { method: PerformanceMethod; label: string; slot: number; level: number }[] = [];
        for (const track of this.tracks) {
            const state = sampleTrack(track.transitions, tick);
            if (state.intensity < 0.005) continue;
            list.push({
                method: track.method,
                label: VFX_PAINTERS[track.method].label,
                slot: track.slot,
                level: Math.round(state.intensity * 100),
            });
        }
        return list;
    }

    /** Active playing-particle override at `seconds` computed from `key_style` tracks. */
    keyParticleOverride(seconds: number): PianoParticleOverride | undefined {
        if (seconds < 0 || seconds >= this.duration) return undefined;
        const tick = seconds * TIME_SCALE;
        let matchedSlot = -1;
        let matchedState: ChannelState | undefined;
        for (const track of this.tracks) {
            if (track.method !== "key_style") continue;
            const state = sampleTrack(track.transitions, tick);
            if (state.intensity < 0.005) continue;
            if (track.slot >= matchedSlot) {
                matchedSlot = track.slot;
                matchedState = state;
            }
        }
        if (!matchedState) return undefined;
        return keyParticleOverrideFromCue({
            brush: matchedState.brush,
            motion: matchedState.motion,
            color: rgbToHex(matchedState.r, matchedState.g, matchedState.b),
            color2: rgbToHex(matchedState.r2, matchedState.g2, matchedState.b2),
            intensity: matchedState.intensity,
            scale: matchedState.scale,
        });
    }

    update(
        seconds: number,
        music: Readonly<MusicFeatures>,
        emitFlashes = true,
        recentNotes?: readonly VfxKeyNote[],
        solo = false,
    ): VfxBatch[] {
        const tick = seconds * TIME_SCALE;
        if (tick < this.lastTick) this.seek(seconds);
        const gameTick = Math.floor(tick / 2 + 1e-6);
        const batches: VfxBatch[] = [];

        while (this.flashIndex < this.flashes.length && this.flashes[this.flashIndex].tick <= tick) {
            const cue = this.flashes[this.flashIndex++];
            if (!emitFlashes || cue.tick <= this.lastTick) continue;
            const painter = VFX_PAINTERS[cue.method];
            if (!painter) continue;
            const color2 = cue.color2 ?? deriveAccentHex(cue.color);
            const result = painter.emit({
                color: cue.color,
                color2,
                intensity: cue.level / 100,
                scale: cue.scale / 100,
                brush: cue.brush,
                zone: cue.zone,
                motion: cue.motion,
                music,
                definition: this.definition,
                phase: (cue.tick * 17) % 360,
            });
            if (result.emitters.length) {
                batches.push({ priority: result.priority, emitters: result.emitters });
            }
            if (cue.method === "shockwave" || cue.method === "firework_bloom") {
                for (const track of this.tracks) {
                    if (track.method === "wing_ribbons") {
                        track.nextTick = Math.max(track.nextTick, gameTick + 12);
                    }
                }
            }
        }

        if (seconds < this.duration) {
            for (const track of this.tracks) {
                if (track.method === "key_style") continue;
                const painter = VFX_PAINTERS[track.method];
                if (!painter) continue;
                const state = sampleTrack(track.transitions, tick);
                if (state.intensity < 0.005) continue;
                if (gameTick < track.nextTick) continue;
                let hasFresh = false;
                if (painter.category === "keys") {
                    hasFresh = Boolean(recentNotes?.some((note) => note.tick > track.lastNoteTick));
                    if (!hasFresh && !solo) continue;
                }
                const result = painter.emit({
                    color: rgbToHex(state.r, state.g, state.b),
                    color2: rgbToHex(state.r2, state.g2, state.b2),
                    intensity: state.intensity,
                    scale: state.scale,
                    brush: state.brush,
                    zone: state.zone,
                    motion: state.motion,
                    music,
                    recentNotes,
                    lastNoteTick: track.lastNoteTick,
                    definition: this.definition,
                    previousLength: track.previousLength,
                    previousAmplitude: track.previousAmplitude,
                    phase: painter.category === "keys" ? this.soloStep : (gameTick * 9 + track.slot * 41) % 360,
                    solo,
                });
                if (painter.category === "keys") {
                    if (hasFresh) {
                        for (const note of recentNotes ?? []) {
                            if (note.tick > track.lastNoteTick) track.lastNoteTick = note.tick;
                        }
                        track.nextTick = gameTick + Math.max(1, painter.interval);
                    } else {
                        track.nextTick = gameTick + 8;
                        this.soloStep += 5;
                    }
                } else {
                    const interval = track.method === "wing_ribbons" && state.intensity > 0.70
                        ? 20
                        : painter.interval;
                    track.nextTick = gameTick + Math.max(1, interval);
                }
                if (result.nextLength !== undefined) track.previousLength = result.nextLength;
                if (result.nextAmplitude !== undefined) track.previousAmplitude = result.nextAmplitude;
                if (result.emitters.length) {
                    batches.push({ priority: result.priority, emitters: result.emitters });
                }
            }
        }

        this.lastTick = tick;
        return batches.sort((a, b) => b.priority - a.priority);
    }
}
