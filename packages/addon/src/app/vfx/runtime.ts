import { system } from "@minecraft/server";
import type { PianoRuntime } from "@app/PianoRuntime";
import { pianoWorld } from "@app/PianoWorld";
import { DEFAULT_PIANO_SETTINGS, type PianoStageThemeId } from "@domain/piano/settings";
import type { MidiPlayer } from "@domain/playback/player";
import type { PianoTransportEvent, PianoVisualNote } from "@domain/playback/visualEvent";
import {
    createPerformanceProgram, createSingleEffectProgram, createThemeProgram,
    getVfxTheme, hasAvailablePerformanceEffects, missingPerformanceResources, quietFeatures, simulatedVfxNotes,
    addTimelineTicks, hostTickAt, timelineTickAt,
    VFX_MAX_PIANOS, VfxBudget, VfxEngine, VfxMusic,
    type ActiveChannelSummary, type HostTick, type MusicFeatures, type PianoParticleOverride,
    type SingleEffectConfig, type TimelineTick, type VfxInput, type VfxNoteEvent, type VfxProgram, type VfxTheme, type VfxTimeline,
} from "@piano/vfx";
import { midiVfxTimeline, sessionVfxTimeline } from "./timeline";
import { inspectInstrument, instrumentDestroyed, instrumentKey, type InstrumentLocation } from "@platform/assembly";
import { isUnloadedChunkError } from "@platform/errors";
import { vfxInstrumentFor } from "@domain/instrument/definition";
import { spawnVfxEmitter } from "@platform/vfxParticle";
import { VfxPropRenderer } from "@platform/vfxProp";
import { createLogger } from "@runtime/log";
import { STAGE_PROP_REGISTRATIONS } from "./stagePropCatalog";

const log = createLogger("vfx");

export type AutoRequest = { auto: true; piano: PianoRuntime } & (
    | { kind: "performance"; midi: MidiPlayer; performance: NonNullable<MidiPlayer["performance"]> }
    | { kind: "songTheme"; midi: MidiPlayer; theme: Exclude<PianoStageThemeId, "off"> }
    | { kind: "manualTheme"; theme: Exclude<PianoStageThemeId, "off">; lastNoteAt: HostTick; seedNote?: PianoVisualNote }
);

export type LabRequest =
    | { theme: VfxTheme; input: VfxInput; name: string }
    | { single: SingleEffectConfig; input: VfxInput; name: string };

export interface VfxSession {
    location: InstrumentLocation;
    request: LabRequest | AutoRequest;
    engine?: VfxEngine;
    music: VfxMusic;
    input: VfxInput;
    cleanup: () => void;
    ended: boolean;
    start: HostTick;
    timeline: VfxTimeline;
    nextFeatureTick?: TimelineTick;
    durationSeconds: number;
    budget: VfxBudget;
    prop: VfxPropRenderer;
    features: Readonly<MusicFeatures>;
    isPerformance?: boolean;
    lastManualNoteAt?: HostTick;
}

const sessions = new Map<string, VfxSession>();
const stageProps = new Map(STAGE_PROP_REGISTRATIONS.map(prop => [prop.id, prop]));
let timer: number | undefined;
let sent = 0;
let failures = 0;
let dropped = 0;
let peakCalls = 0;
let peakMs = 0;

function stopSession(session: VfxSession) {
    if (session.ended) return;
    session.ended = true;
    session.cleanup();
    session.cleanup = () => {};
    session.engine = undefined;
    session.music.clear();
    session.budget.clearPending();
    session.prop.clear();
}

export function getVfxSession(location: InstrumentLocation): VfxSession | undefined {
    return sessions.get(instrumentKey(location.dimension, location.pos));
}

export function activeKeyParticleOverride(piano: PianoRuntime, songTime?: number): PianoParticleOverride | undefined {
    const session = sessions.get(instrumentKey(piano.location.dimension, piano.location.pos));
    if (!session || session.ended || !session.engine) return undefined;
    if ("auto" in session.request && !(piano.settings ?? DEFAULT_PIANO_SETTINGS).stageKeyParticles) return undefined;
    const positionSeconds = session.isPerformance && songTime !== undefined
        ? songTime
        : session.timeline.positionSeconds;
    return session.engine.keyParticleOverride(positionSeconds, session.features, session.input === "solo");
}

type LiveVisualNote = Pick<PianoVisualNote, "midi" | "duration"> & Partial<PianoVisualNote>;

function timelineNote(note: LiveVisualNote, timeline: VfxTimeline): VfxNoteEvent | undefined {
    if (note.worldTick === undefined || note.velocity === undefined || !note.source || note.hasVelocity === undefined) return;
    return {
        midi: note.midi,
        duration: note.soundDuration ?? note.duration,
        timelineTick: timelineTickAt(timeline.positionSeconds),
        velocity: note.velocity,
        source: note.source,
        hasVelocity: note.hasVelocity,
        songTime: note.songTime,
    };
}

function attachLiveMusic(
    piano: PianoRuntime,
    session: VfxSession,
    resetOnTransport: boolean,
): () => void {
    const cleanups: (() => void)[] = [
        piano.noteSignal.subscribe(note => {
            const event = timelineNote(note, session.timeline);
            if (event) session.music.note(event);
        }),
        piano.onDispose(() => stopSession(session)),
    ];
    // Auto sessions are owned by syncSongVfx, which starts and stops them as one lifecycle.
    if (!("auto" in session.request)) {
        cleanups.push(piano.transportSignal.subscribe(event => {
            session.music.transport(event);
            if (event.type !== "resume" && event.type !== "start") {
                session.budget.clearPending();
                session.prop.clear();
                if (resetOnTransport) session.engine?.seek(session.timeline.positionSeconds, true);
            }
        }));
    }
    return () => {
        for (const fn of cleanups) {
            try { fn(); } catch { /* best effort cleanup */ }
        }
    };
}

function createProgramForSession(session: VfxSession): {
    program: VfxProgram;
    input: VfxInput;
    piano?: PianoRuntime;
    isPerformance?: boolean;
    resetOnTransport: boolean;
    seedNote?: PianoVisualNote;
} | undefined {
    const { request, location } = session;
    if ("auto" in request) {
        if (request.kind === "performance") {
            const program = createPerformanceProgram(request.performance.cues, request.performance.duration);
            return {
                program,
                input: "live",
                piano: request.piano,
                isPerformance: true,
                resetOnTransport: true,
            };
        }
        const theme = getVfxTheme(request.theme);
        if (!theme) return undefined;
        return {
            program: createThemeProgram(theme, { seconds: Infinity }),
            input: "live",
            piano: request.piano,
            resetOnTransport: true,
            seedNote: request.kind === "manualTheme" ? request.seedNote : undefined,
        };
    }

    const piano = request.input === "live" ? pianoWorld.get(location) : undefined;
    if (request.input === "live" && !piano) return undefined;

    if ("theme" in request) {
        return {
            program: createThemeProgram(request.theme, { seconds: request.theme.seconds ?? 45 }),
            input: request.input,
            piano,
            resetOnTransport: true,
        };
    }

    return {
        program: createSingleEffectProgram(request.single),
        input: request.input,
        piano,
        resetOnTransport: false,
    };
}

function initializeSession(session: VfxSession): boolean {
    const built = createProgramForSession(session);
    if (!built) return false;
    const engine = new VfxEngine(built.program, vfxInstrumentFor(session.location.definition));
    const startPosition = session.timeline.positionSeconds;
    if (startPosition > 0) engine.seek(startPosition, true);
    if (built.seedNote) {
        const seed = timelineNote(built.seedNote, session.timeline);
        if (seed) session.music.note(seed);
    }

    session.engine = engine;
    session.input = built.input;
    session.isPerformance = built.isPerformance;
    session.durationSeconds = built.program.durationSeconds;
    session.cleanup = built.piano
        ? attachLiveMusic(built.piano, session, built.resetOnTransport)
        : () => {};
    return true;
}

function startSession(location: InstrumentLocation, request: LabRequest | AutoRequest, waitForDrain: boolean): number {
    const key = instrumentKey(location.dimension, location.pos);
    const previous = sessions.get(key);
    if (!previous && sessions.size >= VFX_MAX_PIANOS) {
        throw new Error("已有 4 架琴占用预览预算，请等待粒子消退");
    }
    if (previous) stopSession(previous);

    const budget = previous?.budget ?? new VfxBudget();
    const now = hostTickAt(system.currentTick);
    const start = waitForDrain ? budget.nextAvailableTick(hostTickAt(system.currentTick + 1)) : now;
    const session: VfxSession = {
        location,
        request,
        music: new VfxMusic(),
        input: "auto" in request ? "live" : request.input,
        cleanup: () => {},
        ended: false,
        start,
        timeline: "auto" in request && request.kind !== "manualTheme"
            ? midiVfxTimeline(request.midi)
            : sessionVfxTimeline(start),
        durationSeconds: Infinity,
        budget,
        prop: new VfxPropRenderer(location, stageProps),
        features: quietFeatures,
        lastManualNoteAt: "auto" in request && request.kind === "manualTheme"
            ? request.lastNoteAt
            : undefined,
    };
    sessions.set(key, session);
    if (!waitForDrain) {
        if (!initializeSession(session)) stopSession(session);
    }
    timer ??= system.runInterval(updateTick);
    return Math.max(0, (start - system.currentTick - 1) / 20);
}

export function startLabPreview(location: InstrumentLocation, request: LabRequest): number {
    return startSession(location, request, true);
}

export function stopLocationVfx(location: InstrumentLocation): boolean {
    const previous = getVfxSession(location);
    if (!previous) return false;
    stopSession(previous);
    return true;
}

function syncSongVfx(piano: PianoRuntime, transport: PianoTransportEvent) {
    const previous = getVfxSession(piano.location);
    const autoSession = previous && "auto" in previous.request ? previous : undefined;
    if (transport.type === "pause" || transport.type === "stop" || transport.type === "track") {
        if (autoSession || previous?.input === "live") stopSession(previous!);
        return;
    }
    const midi = piano.getMidiPlayer();
    if (!midi.isPlaying()) return;
    if (!previous && sessions.size >= VFX_MAX_PIANOS) return;

    const settings = piano.settings ?? DEFAULT_PIANO_SETTINGS;
    const performance = midi.performance;
    if (settings.stageChoreography && performance && transport.type === "start") {
        const missing = missingPerformanceResources(performance.cues);
        if (missing.length) {
            log.warn("曲目缺少演出资源", undefined, {
                song: midi.getInfo().midiName,
                missing: missing.join(","),
            });
        }
    }
    let request: AutoRequest | undefined;
    if (settings.stageChoreography && performance && hasAvailablePerformanceEffects(performance.cues)) {
        request = { auto: true, kind: "performance", piano, midi, performance };
    } else if (settings.stageTheme !== "off") {
        request = { auto: true, kind: "songTheme", piano, midi, theme: settings.stageTheme };
    }

    if (!request) {
        if (autoSession) stopSession(autoSession);
        return;
    }
    startSession(piano.location, request, false);
}

function wakeManualTheme(piano: PianoRuntime, theme: Exclude<PianoStageThemeId, "off">, seedNote?: PianoVisualNote) {
    const previous = getVfxSession(piano.location);
    if (!previous && sessions.size >= VFX_MAX_PIANOS) return;
    startSession(
        piano.location,
        { auto: true, kind: "manualTheme", piano, theme, lastNoteAt: hostTickAt(system.currentTick), seedNote },
        false,
    );
}

function refreshAutoVfx(piano: PianoRuntime) {
    const previous = getVfxSession(piano.location);
    if (previous && !previous.ended && !("auto" in previous.request)) return;
    const midi = piano.getMidiPlayer();
    if (midi.isPlaying()) {
        syncSongVfx(piano, { type: "seek", position: midi.position });
        return;
    }
    if (previous && !previous.ended && "auto" in previous.request) {
        const settings = piano.settings ?? DEFAULT_PIANO_SETTINGS;
        if (previous.request.kind !== "manualTheme" || settings.stageTheme === "off") {
            stopSession(previous);
        } else if (previous.request.theme !== settings.stageTheme) {
            wakeManualTheme(piano, settings.stageTheme);
        }
    }
}

function updateTick() {
    const hostTick = hostTickAt(system.currentTick);
    const started = Date.now();
    let calls = 0;

    for (const [key, session] of sessions) {
        session.budget.expire(hostTick);
        const elapsed = hostTick - session.start;
        if (!session.ended && (elapsed === 0 || hostTick % 20 === 0) && inspectInstrument(session.location) !== "complete") {
            stopSession(session);
        }

        const positionSeconds = session.timeline.positionSeconds;
        if (!session.ended && elapsed >= 0) {
            try {
                if (!session.engine && !initializeSession(session)) {
                    stopSession(session);
                    continue;
                }
                if (
                    "auto" in session.request &&
                    session.request.kind === "manualTheme" &&
                    hostTick - (session.lastManualNoteAt ?? hostTick) >= 160
                ) {
                    stopSession(session);
                } else if (!session.isPerformance && session.durationSeconds !== Infinity
                    && positionSeconds >= session.durationSeconds) {
                    stopSession(session);
                } else if (session.engine) {
                    const timelineTick = timelineTickAt(positionSeconds);
                    if (session.input !== "live" && session.input !== "solo") {
                        for (const note of simulatedVfxNotes(timelineTick, session.input)) session.music.note(note);
                    }
                    if (session.nextFeatureTick === undefined || timelineTick >= session.nextFeatureTick) {
                        session.features = session.input === "solo" ? quietFeatures : session.music.sample(timelineTick);
                        session.nextFeatureTick = addTimelineTicks(timelineTick, 4);
                    }
                    const solo = session.input === "solo";
                    const prop = session.engine.stageProp(positionSeconds, session.features, solo);
                    const nativeStageProp = session.prop.render(prop, hostTick) ? prop?.channelKey : undefined;
                    const before = session.budget.dropped;
                    const batches = session.engine.update(
                        positionSeconds,
                        session.features,
                        session.music.recent(timelineTick),
                        { emitFlashes: true, solo, nativeStageProp },
                    );
                    session.budget.enqueue(batches);
                    dropped += session.budget.dropped - before;
                }
            } catch (error) {
                failures++;
                if (!isUnloadedChunkError(error)) log.warn("VFX 运行失败", error);
                stopSession(session);
            }
        }

        try {
            session.budget.dispatch(hostTick, emitter => {
                calls++;
                spawnVfxEmitter(session.location, emitter, positionSeconds);
                sent++;
            });
        } catch (error) {
            // A failed spawn must not leave the session half-dispatched: stop it so
            // cleanup, pending reservations and the engine lifecycle all close.
            failures++;
            // 区块卸载导致的发射失败是预期情况：静默结束会话即可。
            if (!isUnloadedChunkError(error)) log.warn("VFX 发射失败", error);
            stopSession(session);
        }

        if (session.ended && !session.budget.active) sessions.delete(key);
    }

    peakCalls = Math.max(peakCalls, calls);
    if (calls) peakMs = Math.max(peakMs, Date.now() - started);
    if (!sessions.size && timer !== undefined) {
        system.clearRun(timer);
        timer = undefined;
    }
}

export function getVfxStatus(): string {
    let active = 0;
    let emitters = 0;
    let reserved = 0;
    for (const session of sessions.values()) {
        if (!session.ended) active++;
        emitters += session.budget.active;
        reserved += session.budget.reserved;
    }
    return `预览 ${active} / ${sessions.size} 架占用 · 发射批次 ${emitters} · 预留粒子 ${reserved} · 已提交 ${sent} · 预算丢弃 ${dropped} 批 · 失败 ${failures} · 峰值 ${peakCalls} 调用/刻，${peakMs} ms/发射刻`;
}

export function summarizeSessionChannels(session: VfxSession, seconds: number): ActiveChannelSummary[] {
    if (!session.engine) return [];
    return session.engine.activeSummary(seconds, session.features, session.input === "solo");
}

export function registerVfxRuntime() {
    pianoWorld.created.subscribe(piano => {
        piano.setParticleOverrideProvider((songTime) => activeKeyParticleOverride(piano, songTime));
        piano.transportSignal.subscribe(event => syncSongVfx(piano, event));
        piano.settingsSignal.subscribe(() => refreshAutoVfx(piano));
        piano.noteSignal.subscribe(note => {
            if (note.source !== "manual") return;
            const settings = piano.settings ?? DEFAULT_PIANO_SETTINGS;
            if (settings.stageTheme === "off" || piano.getMidiPlayer().isPlaying()) return;
            const previous = getVfxSession(piano.location);
            if (previous && !previous.ended) {
                if ("auto" in previous.request && previous.request.kind === "manualTheme") {
                    previous.lastManualNoteAt = hostTickAt(system.currentTick);
                }
                return;
            }
            const seed = note.worldTick !== undefined && note.velocity !== undefined && note.hasVelocity !== undefined
                ? {
                    midi: note.midi,
                    duration: note.duration,
                    soundDuration: note.soundDuration,
                    worldTick: note.worldTick,
                    velocity: note.velocity,
                    source: "manual" as const,
                    hasVelocity: note.hasVelocity,
                    songTime: note.songTime,
                }
                : undefined;
            wakeManualTheme(piano, settings.stageTheme, seed);
        });
    });

    instrumentDestroyed.subscribe(location => {
        const session = getVfxSession(location);
        if (session) stopSession(session);
    });
}
