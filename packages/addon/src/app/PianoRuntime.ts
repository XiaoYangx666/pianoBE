import { NativeTextSurface, textRotationForHeading } from "@begame/tabletop/minecraft";
import { hostScope, textPort } from "@platform/host";
import { PianoScope } from "@runtime/scope";
import { PIANO_SCREEN } from "@data/hitboxes.generated";
import { type Entity, type Player, type SoundInstance, Vector3, system } from "@minecraft/server";
import { grandDefinition } from "@domain/instrument/definition";
import { inspectInstrument, instrumentCenter, instrumentKey, type InstrumentLocation } from "@platform/assembly";
import { MidiPlayer } from "@domain/playback/player";
import { NoteInfo } from "@domain/types";
import { pianoSoundId, velocityLayerIndex, velocityVolume, type MusicRef, type SongHandle } from "@piano/core";
import { RightOffsets } from "@domain/geometry/offsets";
import { pianoHandZoneBit } from "@domain/util/note";
import { summonParticle } from "@platform/particle";
import { Signal } from "@domain/util/signal";
import { PianoDisplay, readCardFromDisplay, recoverScoreStand, removeScoreStand, SCORE_SPREAD, SCORE_VARIANT, setCardInserted } from "@platform/display";
import { digitalPianoHitModel, grandPianoHitModel, pianoModelOffset } from "@domain/geometry/keyRay";
import { DEFAULT_PIANO_SETTINGS, pianoTextColor, type PianoSettings } from "@domain/piano/settings";
import { AVAILABLE_SCORES, scoreIndexOf, scorePages } from "@domain/score/score";
import { SWEEP_INTERVAL, TEXT_SETTINGS, VERIFY_INTERVAL, NOTE_RELEASE_SECONDS } from "@app/pianoConfig";
import { PianoMusic } from "@app/music/pianoMusic";
import { CardSlot } from "@platform/storage/cardSlot";
import { CardAccess } from "@platform/storage/cardItem";
import type { MusicStorage } from "@domain/music/storage";
import { SoundReleaseQueue } from "@domain/playback/soundRelease";
import type { PianoTransportEvent, PianoVisualNote } from "@domain/playback/visualEvent";

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
    return instrumentCenter(location);
}

const noop = () => {};

export class PianoRuntime {
    readonly center: Vector3;
    readonly right: Vector3;
    readonly hitModel;
    readonly disposedSignal = new Signal<void>();
    /** 每次真正发声时发布；per-piano 键位视图用它聚合所有来源的按键。 */
    readonly noteSignal = new Signal<Pick<PianoVisualNote, "midi" | "duration"> & Partial<PianoVisualNote>>();
    readonly transportSignal = new Signal<PianoTransportEvent>();
    /** 运行时每 tick 发布，UI 等订阅者用来做到期清理，避免自己挂定时器。 */
    readonly tickSignal = new Signal<number>();
    private display?: PianoDisplay;
    private score?: Entity;
    private readonly scope: PianoScope;
    private visualScope?: PianoScope;
    private text?: NativeTextSurface;
    private textValue?: string;
    private midi?: MidiPlayer;
    private midiHandsThisTick = 0;
    private verifiedAt = -Infinity;
    private integrity: ReturnType<typeof inspectInstrument> = "unloaded";
    private visualRetryAt = 0;
    private scoreRetryAt = 0;
    private scoreUnmounted = false;
    private nextScoreTurn = 0;
    private removeVisualOnDispose = false;
    private disposed = false;
    private readonly disposeCleanups = new Set<() => void>();
    private cardSlotBinding?: { entityId: string; slot: CardSlot };
    /** 存储卡歌曲的统一读取入口（每架钢琴一个，缓存按内容指纹隔离）。 */
    readonly music = new PianoMusic(() => this.cardStorage, () => this.cardAccess?.uid);
    private readonly soundReleases = new SoundReleaseQueue(NOTE_RELEASE_SECONDS);
    lastNearby = system.currentTick;

    constructor(
        readonly location: InstrumentLocation,
        private activate: () => void,
        private onManualPress: (player: Player, hands: number) => void,
    ) {
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

    /** 供 UI 等外部缓存挂清理；dispose 时无条件执行，不依赖 Signal 是否还能派发。 */
    onDispose(cleanup: () => void): () => void {
        if (this.disposed) {
            try { cleanup(); } catch { /* cleanup is best effort */ }
            return () => {};
        }
        this.disposeCleanups.add(cleanup);
        return () => this.disposeCleanups.delete(cleanup);
    }

    verify(tick: number) {
        if (tick - this.verifiedAt >= VERIFY_INTERVAL) {
            this.integrity = inspectInstrument(this.location);
            this.verifiedAt = tick;
        }
        return this.integrity;
    }

    get displayId() { return this.display?.entity.id; }
    get displayEntity(): Entity | undefined { return this.display?.entity.isValid ? this.display.entity : undefined; }
    get scoreId() { return this.settings?.scoreMounted && this.score?.isValid ? this.score.id : undefined; }
    get hasScreen() { return this.location.definition !== grandDefinition; }
    get settings() { return this.display?.entity.isValid ? this.display.settings : undefined; }

    /** 真实卡槽（显示实体容器）；未加载时 undefined。 */
    get cardSlot(): CardSlot | undefined {
        const entity = this.displayEntity;
        if (!entity) return undefined;
        if (this.cardSlotBinding?.entityId !== entity.id) {
            this.cardSlotBinding = { entityId: entity.id, slot: new CardSlot(entity) };
        }
        return this.cardSlotBinding.slot;
    }

    get cardAccess(): CardAccess | undefined {
        return this.cardSlot?.access();
    }

    /** 插卡里的音乐（未插卡返回 undefined）。 */
    get cardStorage(): MusicStorage | undefined {
        return this.cardAccess?.storage();
    }

    /** 当前卡槽内存储卡的稳定身份。 */
    get cardUid(): string | undefined {
        return this.cardAccess?.uid;
    }

    /** 读取原始 PBE3（曲库复制到存储卡用；曲库来源会走远端/内嵌）。 */
    readBytes(ref: MusicRef): Promise<Uint8Array | undefined> | Uint8Array | undefined {
        if (ref.source === "library") return this.music.readLibrary(ref.id);
        if (ref.cardUid !== undefined && ref.cardUid !== this.cardUid) return undefined;
        return this.cardStorage?.get(ref.id);
    }

    /** 队列条目 → 可播放的共享曲目引用。 */
    acquire(ref: MusicRef): Promise<SongHandle | undefined> {
        return this.music.acquire(ref);
    }

    refreshCardIndicator() {
        const entity = this.displayEntity;
        if (entity) setCardInserted(entity, readCardFromDisplay(entity) !== undefined);
    }

    updateSettings(previous: PianoSettings, next: PianoSettings) {
        if (this.disposed || !this.display || this.settings !== previous) return false;
        this.display.updateSettings(next);
        if (previous.normalizeLoudness !== next.normalizeLoudness) {
            this.midi?.setNormalizeLoudness(next.normalizeLoudness);
        }
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
            this.display = PianoDisplay.recover(this.location, this.center);
            this.syncScore(tick);
            if (this.hasScreen) {
                this.visualScope = this.scope.child("visual");
                this.text = new NativeTextSurface(this.display.entity, this.visualScope.raw,
                    { distance: 12, background: { red: 0, green: 0, blue: 0, alpha: 0 } },
                    error => console.warn("[piano] 屏幕文字失败", error), textPort);
                this.refreshText();
                // 只重试一次同步（不重建 primitive），实体刚加载时首写失败也能补上。
                this.visualScope.schedule(10, () => this.refreshText());
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
        if (!this.midi) {
            this.midi = new MidiPlayer(
                { acquire: (ref: MusicRef) => this.music.acquire(ref) },
                {
                    note: (note, soundDuration, velocity, gain, songTime, hasVelocity, keyDuration) => {
                        if (this.playNote(note, velocity, soundDuration, keyDuration, gain, false, songTime, hasVelocity)
                            && (this.settings ?? DEFAULT_PIANO_SETTINGS).midiPerformance) {
                            this.midiHandsThisTick |= pianoHandZoneBit(note.midi);
                        }
                    },
                    playing: value => {
                        if (value) this.activate();
                        this.checkpoint();
                        this.refreshText();
                    },
                    // 正常播放结束时不调用 stopNotes：释放队列的 600ms 尾音交给 tick 自然走完。
                    stopNotes: () => this.soundReleases.stopAll(),
                    transport: event => this.transportSignal.publish(event),
                }
            );
        }
        this.midi.setNormalizeLoudness((this.settings ?? DEFAULT_PIANO_SETTINGS).normalizeLoudness);
        return this.midi;
    }

    playManualNotes(player: Player, notes: readonly NoteInfo[], velocity: number) {
        let hands = 0;
        for (const note of notes) {
            if (this.playNote(note, velocity, .15, .15, 1, true)) hands |= pianoHandZoneBit(note.midi);
        }
        if (hands) this.onManualPress(player, hands);
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

    playNote(note: NoteInfo, velocity: number, soundDuration: number, keyDuration: number, gain = 1, manual = false, songTime?: number, hasVelocity = true) {
        if (this.disposed || note.sample === "none" || this.verify(system.currentTick) !== "complete") return;
        const { dimension } = this.location;
        this.ensureVisual(system.currentTick);
        const settings = this.settings ?? DEFAULT_PIANO_SETTINGS;
        // 100% → 1.0（正常响度）；再乘力度音量倍数与可选的逐曲归一化增益。采样峰值已限制在 -6 dB。
        const volume = (settings.volume / 100) * velocityVolume(velocity) * gain;
        const stereo = settings.soundMode !== "3d";
        if (volume > 0) {
            const tick = system.currentTick;
            // 先腾声部再 playSound：超限时优先牺牲更轻/更接近结束的音，避免引擎随机截断。
            if (this.soundReleases.makeRoom(velocity, manual, note.midi)) {
                const layer = velocityLayerIndex(velocity, settings.timbre);
                const instance: SoundInstance | undefined = dimension.playSound(
                    `${pianoSoundId(settings.timbre, layer, stereo)}.${note.sample}`,
                    this.center,
                    { pitch: note.pitch, volume: Math.min(10, volume) }
                );
                // Note Off 后统一淡出；不再依赖采样自身的尾音。
                if (instance) {
                    this.soundReleases.add(instance, note.midi, soundDuration, tick, velocity, manual, note.pitch);
                }
            }
        }
        // keyDuration 是 PBE3 里独立存储的琴键实际按下时长，不再用踏板延音。
        const visualDuration = Math.max(0, keyDuration);
        this.display?.strike(note.midi, visualDuration);
        this.noteSignal.publish({ midi: note.midi, duration: visualDuration, soundDuration, velocity, tick: system.currentTick,
            source: manual ? "manual" : "midi", songTime, hasVelocity });
        this.activate();
        if (settings.particles) summonParticle(dimension, this.center, this.right, note.midi, settings, this.hitModel);
        return true;
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
        this.tickSignal.publish(tick);
        this.soundReleases.update(tick);
        this.midiHandsThisTick = 0;
        this.midi?.tick(now);
        const playing = this.midi?.isPlaying() === true;
        // 释放队列里还有实例时必须继续 tick，否则淡出后的 stop() 永远不会执行，
        // 手动敲键的最后一个实例会一直留在队列里。
        const sounding = this.soundReleases.size > 0;
        let visualActive = false;
        if (this.display?.entity.isValid) {
            this.display.setLight(playing);
            visualActive = this.display.tick(tick);
        }
        // Include notes from the last tick even if playback ended in midi.tick().
        const animateMidi = playing && (this.settings ?? DEFAULT_PIANO_SETTINGS).midiPerformance;
        const midiHands = animateMidi || this.midiHandsThisTick ? this.midiHandsThisTick : undefined;
        return { active: visualActive || playing || sounding, midiHands };
    }

    holdPlaybackClock(now: number) { this.midi?.holdClock(now); }

    checkpoint() {
        if (!this.display?.entity.isValid) return;
        const record = this.midi?.checkpoint();
        if (!record) return;
        try { this.display.checkpoint(record); }
        catch (error) { console.warn("[piano] 保存播放失败", error); }
    }

    dispose(removeVisual: boolean) {
        if (this.disposed) return;
        this.disposed = true;
        this.soundReleases.stopAll();
        for (const cleanup of [...this.disposeCleanups]) {
            try { cleanup(); } catch (error) { console.warn("[piano] 运行时清理回调失败", error); }
        }
        this.disposeCleanups.clear();
        this.removeVisualOnDispose = removeVisual;
        this.disposedSignal.publish();
        this.disposedSignal.dispose();
        this.noteSignal.dispose();
        this.transportSignal.dispose();
        this.tickSignal.dispose();
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
        try {
            this.music.dispose();
        } catch (error) {
            console.warn("[piano] 释放音乐缓存失败", error);
        }
        this.cardSlotBinding = undefined;
        // 断开世界组装时注入的回调；它们捕获了本运行时。
        this.activate = noop;
        this.onManualPress = noop;
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
        const cache = this.music.cacheStats();
        const card = this.cardSlot?.occupied ? "inserted" : "empty";
        return `[${info?.state ?? "ready"}] ${instrumentKey(dimension, pos)} ${info?.midiName ?? ""} ` +
            `card=${card} cache=${cache.songs}/${cache.activeSongs} snd=${this.soundReleases.size} ` +
            `scope(s=${stats.scopes} sub=${stats.subscriptions} t=${stats.timers} j=${stats.jobs} d=${stats.disposables} pending=${this.scope.pending})`;
    }
}
