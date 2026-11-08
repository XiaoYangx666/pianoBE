import { releaseVisual } from "@begame/tabletop/minecraft";
import { Entity, Vector3, VanillaEntityIdentifier, system } from "@minecraft/server";
import type { InstrumentLocation } from "@instrument/runtime";
import type { Cardinal_Direction } from "@types";
import { readPlaybackRecord, type PlaybackRecord } from "./playbackRecord";

export const PIANO_DISPLAY = "xypiano:piano_display";
const ANCHOR = "xypiano:anchor";
const PLAYBACK = "xypiano:playback_v1";
const LOWEST_KEY = 21;
const KEY_COUNT = 88;
const KEYS_PER_MASK = 11;
const MASK_COUNT = KEY_COUNT / KEYS_PER_MASK;

// Entity yaw 0 points south. The north block permutation faces north.
const YAW: Record<Cardinal_Direction, number> = { north: 180, west: 90, south: 0, east: -90 };

export function displayAnchor(entity: Entity): Vector3 | undefined {
    const anchor = entity.getDynamicProperty(ANCHOR);
    return typeof anchor === "object" ? anchor : undefined;
}

function ownedDisplays({ dimension, pos }: InstrumentLocation, point: Vector3) {
    return dimension.getEntities({ type: PIANO_DISPLAY, location: point, maxDistance: .25 })
        .filter(candidate => {
            const anchor = displayAnchor(candidate);
            return anchor?.x === pos.x && anchor.y === pos.y && anchor.z === pos.z;
        });
}

export function removeDormantDisplay(location: InstrumentLocation, point: Vector3) {
    if (!location.dimension.isChunkLoaded(point)) return;
    for (const entity of ownedDisplays(location, point)) entity.remove();
}

export class PianoDisplay {
    private readonly release = new Map<number, number>();
    private readonly sent = new Array<number>(MASK_COUNT).fill(1);
    private light = 1;
    private saved: unknown;

    private constructor(readonly entity: Entity) {
        this.saved = entity.getDynamicProperty(PLAYBACK);
        // Clear pressed keys left in a display persisted through chunk unload.
        for (let group = 0; group < MASK_COUNT; group++) {
            entity.setProperty(`xypiano:keys_${group}`, 1);
        }
        entity.setProperty("xypiano:playback_light", 1);
    }

    static recover(location: InstrumentLocation, point: Vector3) {
        const { dimension, pos, direction } = location;
        const yaw = YAW[direction];
        const candidates = ownedDisplays(location, point);
        const match = candidates.find(candidate => {
            const delta = (candidate.getRotation().y - yaw) % 360;
            return Math.abs(delta) <= .01;
        });
        const migrated = candidates.map(candidate => candidate.getDynamicProperty(PLAYBACK))
            .find(saved => typeof saved === "string");
        const entity = match ?? dimension.spawnEntity(PIANO_DISPLAY as VanillaEntityIdentifier, point, { initialRotation: yaw });
        try {
            if (!match) entity.setDynamicProperty(ANCHOR, pos);
            if (migrated !== undefined && entity.getDynamicProperty(PLAYBACK) === undefined) {
                entity.setDynamicProperty(PLAYBACK, migrated);
            }
            const display = new PianoDisplay(entity);
            for (const candidate of candidates) {
                if (candidate.id !== entity.id) candidate.remove();
            }
            return display;
        } catch (error) {
            if (!match) entity.remove();
            throw error;
        }
    }

    get playback() { return readPlaybackRecord(this.saved); }

    checkpoint(record: PlaybackRecord) {
        if (!this.entity.isValid) return;
        const raw = JSON.stringify(record);
        if (raw === this.saved) return;
        this.entity.setDynamicProperty(PLAYBACK, raw);
        this.saved = raw;
    }

    strike(midi: number, seconds: number) {
        const index = midi - LOWEST_KEY;
        if (!Number.isInteger(index) || index < 0 || index >= KEY_COUNT) return;
        const hold = Math.max(3, Math.min(120, Math.ceil((Number.isFinite(seconds) ? seconds : 0) * 20)));
        this.release.set(index, Math.max(this.release.get(index) ?? 0, system.currentTick + hold));
    }

    isKeyDown(midi: number) {
        const index = midi - LOWEST_KEY;
        const group = Math.floor(index / KEYS_PER_MASK);
        return ((this.sent[group] - 1) & (1 << (index % KEYS_PER_MASK))) !== 0;
    }

    setLight(playing: boolean) {
        const value = playing ? 2 : 1;
        if (this.light === value || !this.entity.isValid) return;
        this.entity.setProperty("xypiano:playback_light", value);
        this.light = value;
    }

    tick(tick: number) {
        if (!this.release.size && this.sent.every(mask => mask === 1)) return false;
        const masks = new Array<number>(MASK_COUNT).fill(1);
        for (const [key, until] of this.release) {
            if (until <= tick) this.release.delete(key);
            else masks[Math.floor(key / KEYS_PER_MASK)] += 2 ** (key % KEYS_PER_MASK);
        }
        for (let group = 0; group < MASK_COUNT; group++) {
            if (this.sent[group] === masks[group]) continue;
            this.entity.setProperty(`xypiano:keys_${group}`, masks[group]);
            this.sent[group] = masks[group];
        }
        return this.release.size > 0;
    }

    dispose(remove: boolean) {
        if (!this.entity.isValid) return;
        if (remove) releaseVisual(this.entity);
        else {
            this.release.clear();
            this.tick(system.currentTick);
            this.setLight(false);
        }
    }
}
