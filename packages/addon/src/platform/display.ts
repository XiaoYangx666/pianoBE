import { reconcileEntityTransform, releaseVisual } from "@begame/tabletop/minecraft";
import { Entity, Vector3, system } from "@minecraft/server";
import type { InstrumentLocation } from "@platform/assembly";
import type { Cardinal_Direction } from "@domain/types";
import { readPlaybackRecord, type PlaybackRecord } from "@domain/playback/playbackRecord";
import { readPianoSettings, type PianoSettings } from "@domain/piano/settings";
import { grandDefinition } from "@domain/instrument/definition";
import { RightOffsets } from "@domain/geometry/offsets";
import { scoreStandOffset } from "@domain/geometry/keyRay";

export const PIANO_DISPLAY = "xypiano:piano_display";
export const SCORE_STAND_ENTITY = "xypiano:grand_score";
export const SCORE_SPREAD = "xypiano:score_spread";
export const SCORE_MOUNTED = "xypiano:score_mounted";
export const SCORE_VARIANT = "xypiano:score_variant";
const SCORE_GRAND = "xypiano:score_grand";
export function pianoDisplayType(location: InstrumentLocation) {
    return location.definition?.displayId ?? PIANO_DISPLAY;
}
const ANCHOR = "xypiano:anchor";
const PLAYBACK = "xypiano:playback_v1";
const SETTINGS = "xypiano:settings_v1";
const LOWEST_KEY = 21;
const KEY_COUNT = 88;
const KEYS_PER_MASK = 11;
const MASK_COUNT = KEY_COUNT / KEYS_PER_MASK;
const STRIKE_SHIFT = KEYS_PER_MASK;
const DOWN_MASK = (1 << KEYS_PER_MASK) - 1;
// An unloaded entity may reject writes. Retry against the same entity when it returns.
const unloadedSettings = new Map<string, PianoSettings>();

// Entity yaw 0 points south. The north block permutation faces north.
const YAW: Record<Cardinal_Direction, number> = { north: 180, west: 90, south: 0, east: -90 };

export function displayAnchor(entity: Entity): Vector3 | undefined {
    const anchor = entity.getDynamicProperty(ANCHOR);
    return typeof anchor === "object" ? anchor : undefined;
}

function ownedDisplays(location: InstrumentLocation, point: Vector3, type = pianoDisplayType(location), maxDistance = .25) {
    const { dimension, pos } = location;
    return dimension.getEntities({ type, location: point, maxDistance })
        .filter(candidate => {
            const anchor = displayAnchor(candidate);
            return anchor?.x === pos.x && anchor.y === pos.y && anchor.z === pos.z;
        });
}

export function removeDormantDisplay(location: InstrumentLocation, point: Vector3) {
    if (!location.dimension.isChunkLoaded(point)) return;
    try {
        for (const entity of ownedDisplays(location, point)) removePianoDisplay(entity);
    } finally {
        removeScoreStand(location, point);
    }
}

export function removeScoreStand(location: InstrumentLocation, point: Vector3) {
    if (!location.dimension.isChunkLoaded(point)) return;
    for (const entity of ownedDisplays(location, point, SCORE_STAND_ENTITY, 2)) releaseVisual(entity);
}

export function recoverScoreStand(location: InstrumentLocation, center: Vector3, variant = 0) {
    const { dimension, pos, direction } = location;
    const candidates = ownedDisplays(location, center, SCORE_STAND_ENTITY, 2);
    const grand = location.definition === grandDefinition;
    const offset = scoreStandOffset(RightOffsets[direction], grand);
    const point = { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
    const existing = candidates[0];
    if (existing) {
        reconcileEntityTransform(existing, point, YAW[direction]);
        if (existing.getProperty(SCORE_GRAND) !== grand) existing.setProperty(SCORE_GRAND, grand);
        if (existing.getProperty(SCORE_MOUNTED) !== true) existing.setProperty(SCORE_MOUNTED, true);
        if (existing.getProperty(SCORE_VARIANT) !== variant) existing.setProperty(SCORE_VARIANT, variant);
        for (const duplicate of candidates.slice(1)) releaseVisual(duplicate);
        return existing;
    }
    const identifier = SCORE_STAND_ENTITY as Parameters<typeof dimension.spawnEntity>[0];
    const entity = dimension.spawnEntity(identifier, point, { initialRotation: YAW[direction] });
    try {
        entity.setDynamicProperty(ANCHOR, pos);
        entity.setProperty(SCORE_GRAND, grand);
        entity.setProperty(SCORE_MOUNTED, true);
        entity.setProperty(SCORE_VARIANT, variant);
        return entity;
    } catch (error) {
        releaseVisual(entity);
        throw error;
    }
}

export function removePianoDisplay(entity: Entity) {
    unloadedSettings.delete(entity.id);
    releaseVisual(entity);
}

export class PianoDisplay {
    private readonly release = new Map<number, number>();
    private readonly sent = new Array<number>(MASK_COUNT).fill(1);
    private readonly pendingStrikes = new Array<number>(MASK_COUNT).fill(0);
    private light = 1;
    private saved: unknown;
    private config: PianoSettings;
    private persistedConfig: PianoSettings;
    private settingsSavePending = false;

    private constructor(readonly entity: Entity) {
        this.saved = entity.getDynamicProperty(PLAYBACK);
        this.persistedConfig = readPianoSettings(entity.getDynamicProperty(SETTINGS));
        this.config = unloadedSettings.get(entity.id) ?? this.persistedConfig;
        this.settingsSavePending = this.config !== this.persistedConfig;
        // Clear pressed keys and strike bits left in a persisted display.
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
        const identifier = pianoDisplayType(location) as Parameters<typeof dimension.spawnEntity>[0];
        const entity = match ?? dimension.spawnEntity(identifier, point, { initialRotation: yaw });
        try {
            if (!match) entity.setDynamicProperty(ANCHOR, pos);
            for (const property of [PLAYBACK, SETTINGS]) {
                if (entity.getDynamicProperty(property) !== undefined) continue;
                const migrated = candidates.map(candidate => candidate.getDynamicProperty(property))
                    .find(saved => typeof saved === "string");
                if (migrated !== undefined) entity.setDynamicProperty(property, migrated);
            }
            const display = new PianoDisplay(entity);
            for (const candidate of candidates) {
                if (candidate.id !== entity.id) removePianoDisplay(candidate);
            }
            return display;
        } catch (error) {
            if (!match) entity.remove();
            throw error;
        }
    }

    get playback() { return readPlaybackRecord(this.saved); }
    get settings() { return this.config; }

    updateSettings(settings: PianoSettings) {
        this.config = settings;
    }

    flushSettings() {
        this.settingsSavePending = this.config !== this.persistedConfig;
        this.retrySettingsSave();
    }

    retrySettingsSave() {
        if (!this.settingsSavePending || !this.entity.isValid) return;
        try {
            this.entity.setDynamicProperty(SETTINGS, JSON.stringify(this.config));
            this.persistedConfig = this.config;
            this.settingsSavePending = false;
            unloadedSettings.delete(this.entity.id);
        } catch (error) {
            console.warn("[piano] 保存钢琴设置失败", error);
        }
    }

    detachSettings() {
        this.flushSettings();
        if (this.settingsSavePending) unloadedSettings.set(this.entity.id, this.config);
    }

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
        this.pendingStrikes[Math.floor(index / KEYS_PER_MASK)] |= 1 << (index % KEYS_PER_MASK);
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
        if (!this.release.size && this.sent.every(mask => ((mask - 1) & DOWN_MASK) === 0)) return false;
        const down = new Array<number>(MASK_COUNT).fill(0);
        for (const [key, until] of this.release) {
            if (until <= tick) this.release.delete(key);
            else down[Math.floor(key / KEYS_PER_MASK)] |= 1 << (key % KEYS_PER_MASK);
        }
        for (let group = 0; group < MASK_COUNT; group++) {
            // The upper bits toggle once per key strike batch. The lower bits hold the key state.
            const strikes = (this.sent[group] - 1) >> STRIKE_SHIFT;
            const nextStrikes = strikes ^ (this.pendingStrikes[group] & down[group]);
            const mask = 1 + ((nextStrikes << STRIKE_SHIFT) | down[group]);
            if (this.sent[group] !== mask) {
                this.entity.setProperty(`xypiano:keys_${group}`, mask);
                this.sent[group] = mask;
            }
            this.pendingStrikes[group] = 0;
        }
        return this.release.size > 0;
    }

    dispose(remove: boolean) {
        if (remove) {
            removePianoDisplay(this.entity);
            return;
        }
        this.detachSettings();
        if (!this.entity.isValid) return;
        this.release.clear();
        this.pendingStrikes.fill(0);
        this.tick(system.currentTick);
        this.setLight(false);
    }
}
