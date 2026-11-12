import { NativeTextSurface, textRotationForHeading } from "@begame/tabletop/minecraft";
import { hostScope, textPort } from "@platform/host";
import { PianoScope } from "@runtime/scope";
import { PIANO_SCREEN } from "@data/hitboxes.generated";
import { type Entity, Vector3, system } from "@minecraft/server";
import { grandDefinition } from "@domain/instrument/definition";
import { inspectInstrument, instrumentKey, type InstrumentLocation } from "@platform/assembly";
import { MidiPlayer } from "@domain/playback/player";
import { NoteInfo } from "@domain/types";
import { pianoSoundId, getSoundLayerByDuration, type PianoSoundLayer } from "@piano/core";
import { RightOffsets } from "@domain/geometry/offsets";
import { processNote } from "@domain/util/note";
import { summonParticle } from "@platform/particle";
import { Signal } from "@domain/util/signal";
import { PianoDisplay, recoverScoreStand, removeScoreStand, SCORE_SPREAD, SCORE_VARIANT } from "@platform/display";
import { digitalPianoHitModel, grandPianoHitModel, pianoModelOffset } from "@domain/geometry/keyRay";
import { DEFAULT_PIANO_SETTINGS, pianoTextColor, type PianoSettings } from "@domain/piano/settings";
import { AVAILABLE_SCORES, scoreIndexOf, scorePages } from "@domain/score/score";
import { midiManager } from "@app/midiManager";
import { SWEEP_INTERVAL, TEXT_SETTINGS, VERIFY_INTERVAL } from "@app/pianoConfig";

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

export function pianoCenter(location: InstrumentLocation): Vector3 {
    const { pos, direction } = location;
    const right = RightOffsets[direction];
    const center = location.definition === grandDefinition ? 0 : .5;
    return { x: pos.x + .5 + right.x * center, y: pos.y, z: pos.z + .5 + right.z * center };
}

export class PianoRuntime {
    readonly center: Vector3;
    readonly right: Vector3;
    readonly hitModel;
    readonly disposedSignal = new Signal<void>();
    /** 每次真正发声时发布；per-piano 键位视图用它聚合所有来源的按键。 */
    readonly noteSignal = new Signal<{ midi: number; duration: number }>();
    private display?: PianoDisplay;
    private score?: Entity;
    private readonly scope: PianoScope;
    private visualScope?: PianoScope;
    private text?: NativeTextSurface;
    private textValue?: string;
    private midi?: MidiPlayer;
    private verifiedAt = -Infinity;
    private integrity: ReturnType<typeof inspectInstrument> = "unloaded";
    private visualRetryAt = 0;
    private scoreRetryAt = 0;
    private scoreUnmounted = false;
    private nextScoreTurn = 0;
    private removeVisualOnDispose = false;
    private disposed = false;
    lastNearby = system.currentTick;

    constructor(readonly location: InstrumentLocation, private readonly activate: () => void) {
        this.right = RightOffsets[location.direction];
        this.center = pianoCenter(location);
        this.hitModel = location.definition === grandDefinition ? grandPianoHitModel : digitalPianoHitModel;
        this.scope = new PianoScope(hostScope, "piano");
        this.scope.own("midi", () => this.midi?.end());
        this.scope.own("display", () => this.display?.dispose(this.removeVisualOnDispose));
        this.scope.own("score", () => {
            if (this.removeVisualOnDispose) removeScoreStand(this.location, this.center);
        });
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
    get scoreId() { return this.settings?.scoreMounted && this.score?.isValid ? this.score.id : undefined; }
    get hasScreen() { return this.location.definition !== grandDefinition; }
    get settings() { return this.display?.entity.isValid ? this.display.settings : undefined; }

    updateSettings(previous: PianoSettings, next: PianoSettings) {
        if (this.disposed || !this.display || this.settings !== previous) return false;
        this.display.updateSettings(next);
        if (TEXT_SETTINGS.some(key => previous[key] !== next[key])) this.textValue = undefined;
        if (previous.scoreMounted !== next.scoreMounted || previous.scoreId !== next.scoreId) {
            this.scoreRetryAt = 0;
            this.syncScore(system.currentTick);
        }
        return true;
    }

    flushSettings(displayId: string) {
        if (!this.disposed && this.display?.entity.id === displayId) this.display.flushSettings();
    }

    ensureVisual(tick: number) {
        if (this.disposed || tick < this.visualRetryAt) return;
        if (this.display?.entity.isValid && (!this.hasScreen || this.text)) {
            this.syncScore(tick);
            return;
        }
        try {
            this.visualScope?.dispose();
            this.visualScope = undefined;
            this.text = undefined;
            this.textValue = undefined;
            this.display?.detachSettings();
            this.display = PianoDisplay.recover(this.location, this.center);
            this.display.retrySettingsSave();
            this.syncScore(tick);
            if (this.hasScreen) {
                this.visualScope = this.scope.child("visual");
                this.text = new NativeTextSurface(this.display.entity, this.visualScope.raw,
                    { distance: 12, background: { red: 0, green: 0, blue: 0, alpha: 0 } },
                    error => console.warn("[piano] 屏幕文字失败", error), textPort);
                this.refreshText();
                this.visualScope.schedule(10, () => {
                    this.text?.invalidate();
                    this.textValue = undefined;
                    this.refreshText();
                });
            }
            const record = this.display.playback;
            if (!this.midi && record?.songs.length) {
                void this.getMidiPlayer().restore(record).catch(error => console.warn("[piano] 恢复播放失败", error));
            }
        } catch (error) {
            this.visualRetryAt = tick + SWEEP_INTERVAL;
            console.warn("[piano] 显示实体初始化失败", error);
        }
    }

    private syncScore(tick: number) {
        const settings = this.settings;
        if (!settings || tick < this.scoreRetryAt) return;
        // 没有导入曲谱时也允许安装空白谱架；导入曲谱后按原设置自动换成真实谱面。
        if (AVAILABLE_SCORES.length === 0) {
            try {
                if (settings.scoreMounted && !this.score?.isValid) {
                    this.scoreUnmounted = false;
                    this.score = recoverScoreStand(this.location, this.center, 0);
                } else if (!settings.scoreMounted && !this.scoreUnmounted) {
                    removeScoreStand(this.location, this.center);
                    this.score = undefined;
                    this.scoreUnmounted = true;
                }
            } catch (error) {
                this.scoreRetryAt = tick + SWEEP_INTERVAL;
                console.warn("[piano] 同步空白谱架失败", error);
            }
            return;
        }
        const variant = scoreIndexOf(settings.scoreId);
        try {
            if (settings.scoreMounted && !this.score?.isValid) {
                this.scoreUnmounted = false;
                this.score = recoverScoreStand(this.location, this.center, variant);
            } else if (!settings.scoreMounted && !this.scoreUnmounted) {
                removeScoreStand(this.location, this.center);
                this.score = undefined;
                this.scoreUnmounted = true;
                return;
            }
            const entity = this.score;
            if (settings.scoreMounted && entity?.isValid && entity.getProperty(SCORE_VARIANT) !== variant) {
                entity.setProperty(SCORE_VARIANT, variant);
                // 换曲谱后回到第一跨页，避免把上一张谱的翻页状态带过去。
                entity.setProperty(SCORE_SPREAD, 0);
            }
        } catch (error) {
            this.scoreRetryAt = tick + SWEEP_INTERVAL;
            console.warn("[piano] 同步谱架失败", error);
        }
    }

    getMidiPlayer() {
        if (this.disposed) throw new Error("Piano runtime disposed");
        return this.midi ??= new MidiPlayer(midiManager, {
            note: (note, duration) => this.playNote(note, getSoundLayerByDuration(duration), duration),
            playing: value => {
                if (value) this.activate();
                this.checkpoint();
                this.refreshText();
            },
        });
    }

    playKey(midi: number, layer: PianoSoundLayer = "short") {
        this.playNote(processNote(midi, false), layer, .15);
    }

    turnScore(spread: 0 | 1) {
        const entity = this.score;
        const tick = system.currentTick;
        if (this.disposed || !entity?.isValid || !this.settings?.scoreMounted || tick < this.nextScoreTurn) return;
        // 谱架只有两个跨页（前 2 页 / 后 2 页）。pages 现在是每页一张图，
        // 少于 3 页时没有第二个跨页可翻。
        if (spread === 1 && scorePages(this.settings.scoreId).length <= 2) return;
        if (entity.getProperty(SCORE_SPREAD) === spread) return;
        entity.setProperty(SCORE_SPREAD, spread);
        this.nextScoreTurn = tick + 8;
    }

    isKeyDown(midi: number) {
        return this.display?.isKeyDown(midi) ?? false;
    }

    playNote(note: NoteInfo, layer: PianoSoundLayer, duration: number) {
        if (this.disposed || note.sample === "none" || this.verify(system.currentTick) !== "complete") return;
        const { dimension } = this.location;
        this.ensureVisual(system.currentTick);
        const settings = this.settings ?? DEFAULT_PIANO_SETTINGS;
        const volume = 2 * settings.volume / 100;
        if (volume > 0) dimension.playSound(`${pianoSoundId(settings.timbre, layer)}.${note.sample}`, this.center, { pitch: note.pitch, volume });
        this.display?.strike(note.midi, duration);
        this.noteSignal.publish({ midi: note.midi, duration });
        this.activate();
        if (settings.particles) summonParticle(dimension, this.center, this.right, note.midi, settings, this.hitModel);
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
        const screen = PIANO_SCREEN;
        const { title, columns } = lcdTitle(hasSong ? info.midiName : "P-88");
        const state = info?.state === "playing" ? "播放" : info?.state === "paused" ? "暂停" : "就绪";
        const status = hasSong
            ? `${state} ${lcdTime(info.currentTime)} / ${lcdTime(info.durationMs / 1000)}  ${info.queueIndex + 1}/${info.queueLength}`
            : `${state} · MIDI`;
        const value = `${title}\n${status}`;
        if (value === this.textValue && this.text.has("title") && this.text.has("status")) return;
        const [centerX, y, centerZ] = screen.center;
        const x = centerX - settings.textRight;
        const z = centerZ - settings.textForward;
        const linePosition = (depth: number) => pianoModelOffset(this.right, x, y + settings.textUp, depth);
        const style = {
            depthTest: true, useRotation: true, distance: settings.textDistance,
            rotation: textRotationForHeading(this.display.entity.getRotation().y + 180, "flat"),
        };
        const scale = settings.textScale / 100;
        const success = this.text.sync(new Map([
            ["title", { ...style, value: title, at: linePosition(z + screen.height * .22),
                color: pianoTextColor(settings.titleColor),
                scale: scale * Math.min(.23, screen.width / 16 * 3.55 / Math.max(7, columns)) }],
            ["status", { ...style, value: status, at: linePosition(z - screen.height * .27),
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
        if (this.disposed) return;
        this.disposed = true;
        this.removeVisualOnDispose = removeVisual;
        this.disposedSignal.publish();
        this.disposedSignal.dispose();
        this.noteSignal.dispose();
        if (!removeVisual) {
            try {
                this.checkpoint();
            } catch (error) {
                console.warn("[piano] 保存播放失败", error);
            }
        }
        // Scope owns visual/text, midi and display; one failed cleanup cannot
        // skip the remaining ones.
        this.scope.dispose();
        this.visualScope = undefined;
        this.text = undefined;
        this.midi = undefined;
        this.display = undefined;
        this.score = undefined;
    }

    describe() {
        const info = this.midi?.getInfo();
        const { dimension, pos } = this.location;
        const stats = this.scope.stats;
        return `[${info?.state ?? "ready"}] ${instrumentKey(dimension, pos)} ${info?.midiName ?? ""} ` +
            `scope(s=${stats.scopes} sub=${stats.subscriptions} t=${stats.timers} j=${stats.jobs} d=${stats.disposables} pending=${this.scope.pending})`;
    }
}
