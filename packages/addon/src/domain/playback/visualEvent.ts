export interface PianoVisualNote {
    midi: number;
    duration: number;
    soundDuration?: number;
    velocity: number;
    tick: number;
    source: "manual" | "midi" | "simulation";
    songTime?: number;
    /** False when the PBE3 decoder supplied its fixed default velocity. */
    hasVelocity: boolean;
}

export interface PianoTransportEvent {
    type: "track" | "start" | "pause" | "resume" | "stop" | "seek";
    position: number;
}
