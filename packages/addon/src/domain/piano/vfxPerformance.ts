import { PERFORMANCE_LAYERS, TIME_SCALE, type PerformanceCue } from "@piano/core";
import { effectEmitters } from "./vfxLab";
import { clampUnit, mix, quietFeatures, type MusicFeatures } from "./vfxMusic";
import { VfxPresetPlayer, type VfxBatch, type VfxLayer } from "./vfxPreset";

export const PERFORMANCE_RECIPES: Readonly<Partial<Record<number, VfxLayer>>> = {
    [PERFORMANCE_LAYERS.moonDust]: {
        effect: "field", mode: "continuous", priority: 1,
        options: { range: 1.22, density: 1.06, size: 1.14, fieldColor: "#ADC8FF" },
        map: [
            { input: "activity", parameter: "intensity", from: 0.55, to: 0.96 },
            { input: "sustain", parameter: "speed", from: 0.55, to: 0.90 },
        ],
    },
    [PERFORMANCE_LAYERS.rearLight]: {
        effect: "curtain", layout: "aurora", priority: 3,
        options: { z: 0.55, range: 1.17, width: 0.26, speed: 0.55, curtainColor: "#809AFF" },
        map: [{ input: "sustain", parameter: "length", from: 0.82, to: 1.75 }],
    },
    [PERFORMANCE_LAYERS.silverThread]: {
        effect: "beam", profile: "silk", priority: 2,
        options: { x: -2.46, y: 0.45, z: 0.12, heading: -99, bend: 0.66, range: 1.18, speed: 0.84,
            lanes: 1, segments: 2, width: 0.24, beamColor: "#C0E8FF" },
        map: [
            { input: "pitch", parameter: "height", from: -0.42, to: 0.82 },
            { input: "sustain", parameter: "length", from: 1.3, to: 2.39 },
        ],
    },
    [PERFORMANCE_LAYERS.amberWings]: {
        effect: "curtain", layout: "wings", priority: 4,
        options: { y: -0.16, range: 1.15, width: 0.26, speed: 0.79, curtainColor: "#FFBC79" },
        map: [{ input: "surge", parameter: "length", from: 1.36, to: 2.36 }],
    },
    [PERFORMANCE_LAYERS.timeFan]: {
        effect: "shaft", layout: "fan", priority: 5,
        options: { width: 0.22, shaftColor: "#FFF0C7" },
        map: [{ input: "sustain", parameter: "length", from: 1.1, to: 2.38 }],
    },
    [PERFORMANCE_LAYERS.goldSparks]: {
        effect: "fountain", priority: 6,
        options: { z: 2.64, range: 1.42, size: 1.07, density: 1.08, speed: 1.13, fountainColor: "#FFD59C" },
    },
    [PERFORMANCE_LAYERS.glassGather]: {
        effect: "shard", priority: 7,
        options: { flow: -1, range: 1.18, speed: 0.88, size: 0.94, density: 0.82, shardColor: "#73D2FF" },
    },
    [PERFORMANCE_LAYERS.glassBreak]: {
        effect: "shard", priority: 7,
        options: { flow: 1, range: 1.24, speed: 1.14, size: 1.18, density: 1.12, shardColor: "#FFE4AD" },
    },
};

interface Level { intensity: number; scale: number }
interface Transition {
    tick: number;
    fade: number;
    from: Level;
    to: Level;
}

const dark: Level = { intensity: 0, scale: 1 };

function sample(transitions: readonly Transition[], tick: number): Level {
    let index = transitions.length - 1;
    while (index >= 0 && transitions[index].tick > tick) index--;
    const transition = transitions[index];
    if (!transition) return dark;
    const progress = transition.fade ? clampUnit((tick - transition.tick) / transition.fade) : 1;
    const smooth = progress * progress * (3 - 2 * progress);
    return {
        intensity: mix(transition.from.intensity, transition.to.intensity, smooth),
        scale: mix(transition.from.scale, transition.to.scale, smooth),
    };
}

/** Continuous state is a function of song time. Flashes are crossed only during playback. */
export class VfxPerformancePlayer {
    private readonly transitions: Transition[][] = [];
    private readonly flashes: PerformanceCue[] = [];
    private readonly player: VfxPresetPlayer;
    private lastTick = -1;
    private flashIndex = 0;

    constructor(cues: readonly PerformanceCue[], duration: number) {
        const tracks = new Map<number, Transition[]>();
        const layers: VfxLayer[] = [];
        for (const cue of cues) {
            const recipe = PERFORMANCE_RECIPES[cue.layer];
            if (!recipe) continue;
            if (cue.op === "flash") {
                this.flashes.push(cue);
                continue;
            }
            let track = tracks.get(cue.layer);
            if (!track) {
                tracks.set(cue.layer, track = []);
                this.transitions.push(track);
                layers.push(recipe);
            }
            track.push({
                tick: cue.tick, fade: cue.fade, from: sample(track, cue.tick),
                to: { intensity: cue.level / 100, scale: cue.scale / 100 },
            });
        }
        this.player = new VfxPresetPlayer({ layers, seconds: duration, fadeIn: 0, fadeOut: 0 });
    }

    seek(seconds: number, resetEmitters = true) {
        this.lastTick = seconds * TIME_SCALE;
        if (resetEmitters) this.player.reset(Math.floor(this.lastTick / 2));
        const next = this.flashes.findIndex(cue => cue.tick > this.lastTick);
        this.flashIndex = next < 0 ? this.flashes.length : next;
    }

    update(seconds: number, music: Readonly<MusicFeatures>, emitFlashes = true): VfxBatch[] {
        const tick = seconds * TIME_SCALE;
        if (tick < this.lastTick) this.seek(seconds);
        const batches: VfxBatch[] = [];
        while (this.flashIndex < this.flashes.length && this.flashes[this.flashIndex].tick <= tick) {
            const cue = this.flashes[this.flashIndex++];
            if (!emitFlashes || cue.tick <= this.lastTick) continue;
            const layer = PERFORMANCE_RECIPES[cue.layer]!;
            const options = { ...layer.options, intensity: cue.level / 100, scale: cue.scale / 100 };
            batches.push({ priority: layer.priority ?? 6,
                emitters: effectEmitters(layer.effect, options, {
                    music: quietFeatures, previous: options, layout: layer.layout, profile: layer.profile,
                }) });
        }
        this.lastTick = tick;
        return batches.concat(this.player.update(Math.floor(tick / 2), music, false,
            this.transitions.map(track => sample(track, tick))));
    }
}
