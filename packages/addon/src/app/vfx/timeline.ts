import { system } from "@minecraft/server";
import { hostTickAt, type HostTick, type VfxTimeline } from "@piano/vfx";
import type { MidiPlayer } from "@domain/playback/player";

/** A song-backed performance follows the player through pause, resume and seek. */
export function midiVfxTimeline(midi: MidiPlayer): VfxTimeline {
    return {
        get positionSeconds() {
            return Math.max(0, midi.position);
        },
    };
}

/** A manual or simulated performance starts only when its host-side drain delay ends. */
export function sessionVfxTimeline(start: HostTick): VfxTimeline {
    return {
        get positionSeconds() {
            return Math.max(0, hostTickAt(system.currentTick) - start) / 20;
        },
    };
}
