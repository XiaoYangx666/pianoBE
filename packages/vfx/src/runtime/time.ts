declare const timelineTickBrand: unique symbol;
declare const hostTickBrand: unique symbol;

/** Performance-domain time. It may pause, seek or restart with its session. */
export type TimelineTick = number & { readonly [timelineTickBrand]: "timeline" };
/** Host-domain time. It only drives real dispatch, expiry and resource lifetime. */
export type HostTick = number & { readonly [hostTickBrand]: "host" };

export interface VfxTimeline {
    readonly positionSeconds: number;
}

export const TIMELINE_TICKS_PER_SECOND = 20;

/** The only conversion from a timeline position to its quantized tick. */
export function timelineTickAt(positionSeconds: number): TimelineTick {
    if (!Number.isFinite(positionSeconds)) throw new RangeError("VFX timeline position must be finite");
    return Math.floor(positionSeconds * TIMELINE_TICKS_PER_SECOND + 1e-6) as TimelineTick;
}

export function addTimelineTicks(tick: TimelineTick, delta: number): TimelineTick {
    return (tick + delta) as TimelineTick;
}

/** Explicitly marks a tick supplied by the host environment. */
export function hostTickAt(tick: number): HostTick {
    if (!Number.isFinite(tick) || !Number.isInteger(tick)) throw new RangeError("VFX host tick must be a finite integer");
    return tick as HostTick;
}
