import { RuntimeScope } from "@begame/tabletop";
import { NativeTextSurface } from "@begame/tabletop/minecraft";
import { hostScope, textPort } from "./minecraft";
import { PIANO_SCREEN } from "./hitboxes.generated";
import { Player, Vector3, system, world } from "@minecraft/server";
import {
    destroyInstrument, inspectInstrument, instrumentDestroyed, instrumentKey, instrumentPlaced,
    InstrumentLocation, resolveInstrument,
} from "@instrument/runtime";
import { MidiPlayer } from "@midiPlayer/player";
import { NoteInfo } from "@types";
import { RightOffsets } from "@utils/block";
import { processNote } from "@utils/note";
import { summonParticle } from "@utils/particle";
import { Signal } from "@utils/signal";
import { displayAnchor, PianoDisplay, PIANO_DISPLAY, removeDormantDisplay, removePianoDisplay } from "./display";
import { pickPianoMenu, pianoModelOffset, pianoRay, pickPianoKey } from "./keyRay";
import { DEFAULT_PIANO_SETTINGS, pianoTextColor, type PianoSettings } from "./settings";

const VIEW_RANGE_SQUARED = 48 ** 2;
const UNLOAD_GRACE = 200;
const SWEEP_INTERVAL = 20;
const VERIFY_INTERVAL = 10;
const TEXT_SETTINGS = ["textVisible", "titleColor", "statusColor", "textScale",
    "textRight", "textUp", "textForward", "textDistance"] as const;

function lcdTime(seconds: number) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function lcdTitle(name: string) {
    let title = "";
    let columns = 0;
    for (const char of name.replace(/§.|[\r\n\t]/g, " ").trim()) {
        const width = char.charCodeAt(0) < 128 ? 1 : 2;
        if (columns + width > 24) return { title: title.trimEnd() + "…", columns: columns + 2 };
        title += char;
        columns += width;
    }
    return { title: title || "P-88", columns };
}

function pianoCenter({ pos, direction }: InstrumentLocation): Vector3 {
    const right = RightOffsets[direction];
    return { x: pos.x + .5 + right.x / 2, y: pos.y, z: pos.z + .5 + right.z / 2 };
}

export class PianoRuntime {
    readonly center: Vector3;
    readonly right: Vector3;
    readonly disposedSignal = new Signal<void>();
    private display?: PianoDisplay;
    private readonly scope = hostScope.child();
    private visualScope?: RuntimeScope;
    private text?: NativeTextSurface;
    private textValue?: string;
    private midi?: MidiPlayer;
    private verifiedAt = -Infinity;
    private integrity: ReturnType<typeof inspectInstrument> = "unloaded";
    private visualRetryAt = 0;
    private disposed = false;
    lastNearby = system.currentTick;

    constructor(readonly location: InstrumentLocation, private readonly activate: () => void) {
        this.right = RightOffsets[location.direction];
        this.center = pianoCenter(location);
    }

    isAlive() { return !this.disposed; }

    verify(tick: number) {
        if (tick - this.verifiedAt >= VERIFY_INTERVAL) {
            this.integrity = inspectInstrument(this.location);
            this.verifiedAt = tick;
        }
        return this.integrity;
    }

    get displayId() { return this.display?.entity.id; }
    get settings() { return this.display?.entity.isValid ? this.display.settings : undefined; }

    updateSettings(previous: PianoSettings, next: PianoSettings) {
        if (this.disposed || !this.display || this.settings !== previous) return false;
        this.display.updateSettings(next);
        if (TEXT_SETTINGS.some(key => previous[key] !== next[key])) this.textValue = undefined;
        return true;
    }

    flushSettings(displayId: string) {
        if (!this.disposed && this.display?.entity.id === displayId) this.display.flushSettings();
    }

    ensureVisual(tick: number) {
        if (this.disposed || tick < this.visualRetryAt || this.display?.entity.isValid) return;
        try {
            this.visualScope?.dispose();
            this.text = undefined;
            this.textValue = undefined;
            this.display?.detachSettings();
            this.display = PianoDisplay.recover(this.location, this.center);
            this.display.retrySettingsSave();
            this.visualScope = this.scope.child();
            this.text = new NativeTextSurface(this.display.entity, this.visualScope,
                { distance: 12, background: { red: 0, green: 0, blue: 0, alpha: 0 } },
                error => console.warn("[piano] 屏幕文字失败", error), textPort);
            this.refreshText();
            this.visualScope.schedule(10, () => {
                this.text?.invalidate();
                this.textValue = undefined;
                this.refreshText();
            });
            const record = this.display.playback;
            if (!this.midi && record?.songs.length) {
                void this.getMidiPlayer().restore(record).catch(error => console.warn("[piano] 恢复播放失败", error));
            }
        } catch (error) {
            this.visualRetryAt = tick + SWEEP_INTERVAL;
            console.warn("[piano] 显示实体初始化失败", error);
        }
    }

    getMidiPlayer() {
        const { dimension, pos, direction } = this.location;
        return this.midi ??= new MidiPlayer(dimension, pos, direction, {
            note: (note, sound, duration) => this.playNote(note, sound, duration),
            playing: value => {
                if (value) this.activate();
                this.checkpoint();
                this.refreshText();
            },
        });
    }

    playKey(midi: number, sound = "piano_short") {
        this.playNote(processNote(midi, false), sound, .15);
    }

    isKeyDown(midi: number) {
        return this.display?.isKeyDown(midi) ?? false;
    }

    playNote(note: NoteInfo, sound: string, duration: number) {
        if (this.disposed || note.sample === "none" || this.verify(system.currentTick) !== "complete") return;
        const { dimension } = this.location;
        this.ensureVisual(system.currentTick);
        const settings = this.settings ?? DEFAULT_PIANO_SETTINGS;
        const volume = 2 * settings.volume / 100;
        if (volume > 0) dimension.playSound(`${sound}.${note.sample}`, this.center, { pitch: note.pitch, volume });
        this.display?.strike(note.midi, duration);
        this.activate();
        if (settings.particles) summonParticle(dimension, this.center, this.right, note.midi, settings);
    }

    refreshScreen() { this.refreshText(); }

    private refreshText() {
        if (!this.text || !this.display?.entity.isValid) return;
        const settings = this.display.settings;
        if (!settings.textVisible) {
            if (this.text.size) this.text.clear();
            this.textValue = undefined;
            return;
        }
        const info = this.midi?.getInfo();
        const hasSong = info && info.queueIndex >= 0 && info.queueIndex < info.queueLength;
        const { title, columns } = lcdTitle(hasSong ? info.midiName : "P-88");
        const state = info?.state === "playing" ? "播放" : info?.state === "paused" ? "暂停" : "就绪";
        const status = hasSong
            ? `${state} ${lcdTime(info.currentTime)} / ${lcdTime(info.durationMs / 1000)}  ${info.queueIndex + 1}/${info.queueLength}`
            : `${state} · MIDI`;
        const value = `${title}\n${status}`;
        if (value === this.textValue && this.text.has("title") && this.text.has("status")) return;
        const [centerX, y, centerZ] = PIANO_SCREEN.center;
        const x = centerX - settings.textRight;
        const z = centerZ - settings.textForward;
        const linePosition = (depth: number) => pianoModelOffset(this.right, x, y + settings.textUp, depth);
        const style = {
            depthTest: true, useRotation: true, distance: settings.textDistance,
            rotation: { x: 90, y: this.display.entity.getRotation().y + 180, z: 0 },
        };
        const scale = settings.textScale / 100;
        const success = this.text.sync(new Map([
            ["title", { ...style, value: title, at: linePosition(z + PIANO_SCREEN.height * .22),
                color: pianoTextColor(settings.titleColor),
                scale: scale * Math.min(.23, PIANO_SCREEN.width / 16 * 3.55 / Math.max(7, columns)) }],
            ["status", { ...style, value: status, at: linePosition(z - PIANO_SCREEN.height * .27),
                color: pianoTextColor(settings.statusColor),
                scale: scale * .095 }],
        ]));
        if (success) this.textValue = value;
    }

    tick(tick: number, now: number) {
        this.midi?.tick(now);
        const playing = this.midi?.isPlaying() === true;
        if (!this.display?.entity.isValid) return playing;
        this.display.setLight(playing);
        return this.display.tick(tick) || playing;
    }

    holdPlaybackClock(now: number) { this.midi?.holdClock(now); }

    checkpoint() {
        if (!this.display?.entity.isValid) return;
        this.display.retrySettingsSave();
        const record = this.midi?.checkpoint();
        if (!record) return;
        try { this.display.checkpoint(record); }
        catch (error) { console.warn("[piano] 保存播放失败", error); }
    }

    dispose(removeVisual: boolean) {
        this.disposed = true;
        this.disposedSignal.publish();
        this.disposedSignal.dispose();
        if (!removeVisual) this.checkpoint();
        this.scope.dispose();
        try {
            this.midi?.end();
            this.display?.dispose(removeVisual);
        } finally {
            this.midi = undefined;
            this.display = undefined;
        }
    }

    describe() {
        const info = this.midi?.getInfo();
        const { dimension, pos } = this.location;
        return `[${info?.state ?? "ready"}] ${instrumentKey(dimension, pos)} ${info?.midiName ?? ""}`;
    }
}

class PianoWorld {
    private readonly pianos = new Map<string, PianoRuntime>();
    private readonly active = new Set<PianoRuntime>();
    private nearby = new Map<string, Vector3[]>();
    private inputTick = -1;
    private readonly handled = new Set<string>();

    constructor() {
        instrumentPlaced.subscribe(location => this.get(location));
        instrumentDestroyed.subscribe(location => this.unload(location, true));
        system.runInterval(() => this.sweep(), SWEEP_INTERVAL);
        system.runInterval(() => this.tick());
        world.afterEvents.entityLoad.subscribe(({ entity }) => {
            if (entity.typeId !== PIANO_DISPLAY) return;
            system.run(() => {
                if (!entity.isValid) return;
                const pos = displayAnchor(entity);
                if (!pos) { removePianoDisplay(entity); return; }
                const dimension = entity.dimension;
                if (!dimension.isChunkLoaded(pos)) return;
                const block = dimension.getBlock(pos);
                const location = block?.typeId === "xypiano:piano_left" ? resolveInstrument(block) : undefined;
                if (!location) { removePianoDisplay(entity); return; }
                const integrity = inspectInstrument(location);
                if (integrity === "incomplete") { removePianoDisplay(entity); return; }
                if (integrity === "unloaded" || !this.isNear(location)) return;
                const current = this.get(location);
                if (current?.displayId && current.displayId !== entity.id && entity.isValid) removePianoDisplay(entity);
            });
        });
    }

    get(location: InstrumentLocation): PianoRuntime | undefined {
        const key = instrumentKey(location.dimension, location.pos);
        let piano = this.pianos.get(key);
        if (piano && piano.location.direction !== location.direction) {
            this.unload(piano.location, true);
            piano = undefined;
        }
        const tick = system.currentTick;
        if (!piano) {
            const runtime = new PianoRuntime(location, () => this.active.add(runtime));
            if (runtime.verify(tick) !== "complete") return;
            this.pianos.set(key, runtime);
            piano = runtime;
        } else if (piano.verify(tick) !== "complete") {
            return;
        }
        piano.lastNearby = tick;
        piano.ensureVisual(tick);
        return piano;
    }

    blockTick(location: InstrumentLocation) {
        if (!this.isNear(location)) return;
        const piano = this.get(location);
        if (!piano && inspectInstrument(location) === "incomplete") destroyInstrument(location, false);
    }

    beginInteraction(player: Player) {
        if (this.inputTick !== system.currentTick) {
            this.inputTick = system.currentTick;
            this.handled.clear();
        }
        if (this.handled.has(player.id)) return false;
        this.handled.add(player.id);
        return true;
    }

    interactFromView(player: Player, piano: PianoRuntime) {
        const ray = pianoRay(piano.center, piano.right, player.getHeadLocation(), player.getViewDirection());
        const midi = pickPianoKey(ray, 4, midi => piano.isKeyDown(midi));
        if (midi !== undefined) {
            piano.playKey(midi);
            return "key";
        }
        return pickPianoMenu(ray);
    }

    private isNear({ dimension, pos }: InstrumentLocation) {
        return this.nearby.get(dimension.id)?.some(player =>
            (player.x - pos.x) ** 2 + (player.y - pos.y) ** 2 + (player.z - pos.z) ** 2 <= VIEW_RANGE_SQUARED
        ) ?? false;
    }

    private unload(location: InstrumentLocation, removeVisual: boolean) {
        const { dimension, pos } = location;
        const key = instrumentKey(dimension, pos);
        const piano = this.pianos.get(key);
        if (!piano) {
            if (removeVisual) removeDormantDisplay(location, pianoCenter(location));
            return;
        }
        this.pianos.delete(key);
        this.active.delete(piano);
        piano.dispose(removeVisual);
    }

    private sweep() {
        const nearby = new Map<string, Vector3[]>();
        for (const player of world.getAllPlayers()) {
            const id = player.dimension.id;
            const group = nearby.get(id) ?? [];
            group.push(player.location);
            nearby.set(id, group);
        }
        this.nearby = nearby;
        const tick = system.currentTick;
        for (const piano of this.pianos.values()) {
            const integrity = piano.verify(tick);
            if (integrity === "incomplete") this.unload(piano.location, true);
            else if (integrity === "unloaded") this.unload(piano.location, false);
            else {
                if (this.isNear(piano.location)) {
                    piano.lastNearby = tick;
                    piano.ensureVisual(tick);
                } else if (tick - piano.lastNearby >= UNLOAD_GRACE) {
                    this.unload(piano.location, false);
                    continue;
                }
                piano.checkpoint();
                piano.refreshScreen();
            }
        }
    }

    private tick() {
        const tick = system.currentTick;
        const now = Date.now();
        for (const piano of this.active) {
            try {
                const integrity = piano.verify(tick);
                if (integrity === "incomplete") this.unload(piano.location, true);
                else if (integrity === "unloaded") piano.holdPlaybackClock(now);
                else if (!piano.tick(tick, now)) this.active.delete(piano);
            } catch (error) {
                this.active.delete(piano);
                console.warn("[piano] 钢琴运行时更新失败", error);
            }
        }
    }

    debugDump() {
        return [`Piano runtime: ${this.pianos.size} loaded, ${this.active.size} active`,
            ...Array.from(this.pianos.values(), piano => piano.describe())].join("\n");
    }
}

export const pianoWorld = new PianoWorld();
