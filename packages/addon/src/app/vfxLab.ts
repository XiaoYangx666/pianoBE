import { Player, ScriptEventSource, system } from "@minecraft/server";
import {
    PERFORMANCE_BRUSHES, PERFORMANCE_METHODS, PERFORMANCE_MOTIONS, PERFORMANCE_ZONES,
    resolvePerformanceColor,
    type PerformanceBrush, type PerformanceMethod, type PerformanceMotion, type PerformanceZone,
    type SecretScore,
} from "@piano/core";
import { DEFAULT_PIANO_SETTINGS, type PianoStageThemeId } from "@domain/piano/settings";
import {
    KEY_PARTICLE_STYLE_LABELS, keyParticleOverrideFromCue, parseKeyParticleAlias,
    type PianoParticleOverride,
} from "@domain/piano/particleOverride";
import { deriveAccentHex } from "@domain/piano/vfxDraw";
import {
    parseVfxOptions, planVfxScene, VFX_EFFECTS, VFX_SCENES,
    type VfxCue, type VfxOptions, type VfxScene,
} from "@domain/piano/vfxLab";
import { VFX_MAX_PIANOS, VfxBudget } from "@domain/piano/vfxBudget";
import {
    isVfxStageTheme, VFX_PAINTERS, VFX_STAGE_THEMES, VfxThemePlayer,
    type PainterCategory, type VfxStageThemeName,
} from "@domain/piano/vfxPainters";
import { VfxPerformancePlayer } from "@domain/piano/vfxPerformance";
import { SecretCinemaPlayer, secretScoreForSong } from "@domain/piano/secretCinema";
import type { PianoTransportEvent, PianoVisualNote } from "@domain/playback/visualEvent";
import type { MidiPlayer } from "@domain/playback/player";
import { quietFeatures, simulatedVfxNotes, VfxMusic, type MusicFeatures } from "@domain/piano/vfxMusic";
import {
    isVfxEffect, validateEffectOptions, validateVfxPreset, vfxInput, VFX_PRESETS, VfxPresetPlayer,
    type VfxBatch, type VfxInput, type VfxPreset,
} from "@domain/piano/vfxPreset";
import { inspectInstrument, instrumentDestroyed, instrumentKey, resolveInstrument, type InstrumentLocation } from "@platform/assembly";
import { spawnVfxEmitter } from "@platform/vfxParticle";
import { loadVfxPresets, saveVfxPreset } from "@platform/storage/vfxPresets";
import { pianoWorld } from "./PianoWorld";
import type { PianoRuntime } from "./PianoRuntime";

interface DrawCommandOptions {
    color: string;
    color2: string;
    brush?: PerformanceBrush;
    zone?: PerformanceZone;
    motion?: PerformanceMotion;
    level: number;
    scale: number;
    seconds: number;
}

type AutoRequest = { auto: true; piano: PianoRuntime } & (
    | { kind: "performance"; midi: MidiPlayer; performance: NonNullable<MidiPlayer["performance"]>; transport: PianoTransportEvent }
    | { kind: "secret"; midi: MidiPlayer; score: SecretScore; transport: PianoTransportEvent }
    | { kind: "songTheme"; midi: MidiPlayer; theme: Exclude<PianoStageThemeId, "off"> }
    | { kind: "manualTheme"; theme: Exclude<PianoStageThemeId, "off">; lastNoteAt: number; seedNote?: PianoVisualNote }
);

type LabRequest =
    | { scene: VfxScene; options: VfxOptions }
    | { preset: VfxPreset; input: VfxInput; name: string }
    | { theme: VfxStageThemeName; input: VfxInput; name: string }
    | { painter: PerformanceMethod; input: VfxInput; options: DrawCommandOptions };

interface Preview {
    location: InstrumentLocation;
    request: LabRequest | AutoRequest;
    producer?: {
        update(tick: number, elapsed: number): VfxBatch[];
        detach?(): void;
        summary?(seconds: number): { method: PerformanceMethod; label: string; slot: number; level: number }[];
        keyParticleOverride?(songTime?: number): PianoParticleOverride | undefined;
    };
    ended: boolean;
    start: number;
    duration: number;
    budget: VfxBudget;
    features: Readonly<MusicFeatures>;
}

const previews = new Map<string, Preview>();
let timer: number | undefined;
let sent = 0;
let failures = 0;
let dropped = 0;
let peakCalls = 0;
let peakMs = 0;

function stop(preview: Preview) {
    preview.ended = true;
    preview.producer?.detach?.();
    preview.producer = undefined;
    preview.budget.clearPending();
}

function activeKeyParticleOverride(piano: PianoRuntime, songTime?: number): PianoParticleOverride | undefined {
    const key = instrumentKey(piano.location.dimension, piano.location.pos);
    const preview = previews.get(key);
    if (!preview || preview.ended || !preview.producer?.keyParticleOverride) return undefined;
    if ("auto" in preview.request && !(piano.settings ?? DEFAULT_PIANO_SETTINGS).stageKeyParticles) return undefined;
    return preview.producer.keyParticleOverride(songTime);
}

function attachLiveMusic(piano: PianoRuntime, music: VfxMusic, preview: Preview, stopOnTransport = true) {
    return [
        piano.noteSignal.subscribe(note => {
            if (note.tick !== undefined && note.velocity !== undefined && note.source && note.hasVelocity !== undefined) {
                music.note({
                    midi: note.midi,
                    duration: note.duration,
                    tick: note.tick,
                    velocity: note.velocity,
                    source: note.source,
                    hasVelocity: note.hasVelocity,
                    songTime: note.songTime,
                });
            }
        }),
        piano.transportSignal.subscribe(event => {
            music.transport(event);
            if (stopOnTransport && event.type !== "resume" && event.type !== "start") {
                preview.budget.clearPending();
            }
        }),
        piano.onDispose(() => stop(preview)),
    ];
}

function syncSongVfx(piano: PianoRuntime, transport: PianoTransportEvent) {
    const key = instrumentKey(piano.location.dimension, piano.location.pos);
    const previous = previews.get(key);
    const autoPreview = previous && "auto" in previous.request ? previous : undefined;
    if (transport.type === "pause" || transport.type === "stop" || transport.type === "track") {
        if (autoPreview) stop(autoPreview);
        return;
    }
    const midi = piano.getMidiPlayer();
    if (!midi.isPlaying()) return;
    if (!previous && previews.size >= VFX_MAX_PIANOS) return;

    const settings = piano.settings ?? DEFAULT_PIANO_SETTINGS;
    const score = secretScoreForSong(midi.loadedSong);
    const performance = midi.performance;
    let request: AutoRequest | undefined;
    if (settings.stageChoreography && performance) {
        request = { auto: true, kind: "performance", piano, midi, performance, transport };
    } else if (settings.stageChoreography && score) {
        request = { auto: true, kind: "secret", piano, midi, score, transport };
    } else if (settings.stageTheme !== "off") {
        request = { auto: true, kind: "songTheme", piano, midi, theme: settings.stageTheme };
    }

    if (!request) {
        if (autoPreview) stop(autoPreview);
        return;
    }
    if (previous) stop(previous);
    const preview: Preview = {
        location: piano.location,
        request,
        start: system.currentTick,
        duration: Infinity,
        ended: false,
        budget: previous?.budget ?? new VfxBudget(),
        features: quietFeatures,
    };
    previews.set(key, preview);
    preview.producer = createProducer(preview);
    timer ??= system.runInterval(update);
}

function wakeManualTheme(piano: PianoRuntime, theme: Exclude<PianoStageThemeId, "off">, seedNote?: PianoVisualNote) {
    const key = instrumentKey(piano.location.dimension, piano.location.pos);
    const previous = previews.get(key);
    if (!previous && previews.size >= VFX_MAX_PIANOS) return;
    if (previous) stop(previous);
    const preview: Preview = {
        location: piano.location,
        request: { auto: true, kind: "manualTheme", piano, theme, lastNoteAt: system.currentTick, seedNote },
        start: system.currentTick,
        duration: Infinity,
        ended: false,
        budget: previous?.budget ?? new VfxBudget(),
        features: quietFeatures,
    };
    previews.set(key, preview);
    preview.producer = createProducer(preview);
    timer ??= system.runInterval(update);
}

function refreshAutoVfx(piano: PianoRuntime) {
    const key = instrumentKey(piano.location.dimension, piano.location.pos);
    const previous = previews.get(key);
    if (previous && !previous.ended && !("auto" in previous.request)) return;
    const midi = piano.getMidiPlayer();
    if (midi.isPlaying()) {
        syncSongVfx(piano, { type: "seek", position: midi.position });
        return;
    }
    if (previous && !previous.ended && "auto" in previous.request) {
        const settings = piano.settings ?? DEFAULT_PIANO_SETTINGS;
        if (previous.request.kind !== "manualTheme" || settings.stageTheme === "off") {
            stop(previous);
        } else if (previous.request.theme !== settings.stageTheme) {
            wakeManualTheme(piano, settings.stageTheme);
        }
    }
}

function createThemeProducer(
    preview: Preview,
    piano: PianoRuntime | undefined,
    themeName: Exclude<PianoStageThemeId, "off">,
    input: VfxInput,
    seconds: number,
    isManualAuto = false,
    seedNote?: PianoVisualNote,
): NonNullable<Preview["producer"]> {
    const music = new VfxMusic();
    if (seedNote) music.note(seedNote);
    const { location } = preview;
    const isPainterTheme = isVfxStageTheme(themeName);
    const themePlayer = isPainterTheme
        ? new VfxThemePlayer(VFX_STAGE_THEMES[themeName], location.definition, seconds)
        : undefined;
    const presetPlayer = !isPainterTheme
        ? new VfxPresetPlayer({ ...VFX_PRESETS[themeName], seconds: Number.isFinite(seconds) ? seconds : 1e9 })
        : undefined;
    preview.duration = themePlayer ? themePlayer.duration : presetPlayer!.duration;
    const cleanups = piano ? attachLiveMusic(piano, music, preview, true) : [];
    const onResetTransport = piano && presetPlayer
        ? [piano.transportSignal.subscribe(event => {
            if (event.type !== "resume" && event.type !== "start") {
                presetPlayer.reset(system.currentTick - preview.start);
            }
        })]
        : [];
    const allCleanups = [...cleanups, ...onResetTransport];
    return {
        detach: () => allCleanups.forEach(cleanup => cleanup()),
        keyParticleOverride: () => themePlayer ? themePlayer.keyParticleOverride() : presetPlayer?.keyParticleOverride(),
        update(tick, elapsed) {
            if (isManualAuto && "auto" in preview.request && preview.request.kind === "manualTheme") {
                if (tick - preview.request.lastNoteAt >= 160) {
                    stop(preview);
                    return [];
                }
            }
            if (input !== "live" && input !== "solo") {
                for (const note of simulatedVfxNotes(tick, elapsed, input)) music.note(note);
            }
            if (elapsed % 4 === 0) {
                preview.features = input === "solo" ? quietFeatures : music.sample(tick);
            }
            if (themePlayer) {
                return themePlayer.update(elapsed, preview.features, music.recent(), input === "solo");
            }
            if (elapsed % 4 !== 0) return [];
            return presetPlayer!.update(elapsed, preview.features, input === "solo");
        },
    };
}

function createProducer(preview: Preview): NonNullable<Preview["producer"]> | undefined {
    const { request, location } = preview;
    if ("auto" in request) {
        if (request.kind === "performance") {
            const { piano, midi, performance, transport } = request;
            const player = new VfxPerformancePlayer(performance.cues, performance.duration, location.definition);
            if (transport.type !== "start") player.seek(transport.position);
            const music = new VfxMusic();
            const detachNote = piano.noteSignal.subscribe(note => {
                const { midi: keyMidi, velocity, tick, source, hasVelocity, songTime } = note;
                if (source === "midi" && velocity !== undefined && tick !== undefined && hasVelocity !== undefined) {
                    music.note({
                        midi: keyMidi, velocity, tick, source, hasVelocity, songTime,
                        duration: note.soundDuration ?? note.duration,
                    });
                }
            });
            const detachPiano = piano.onDispose(() => stop(preview));
            return {
                update(tick, elapsed) {
                    if (elapsed % 4 === 0) preview.features = music.sample(tick);
                    return player.update(midi.position, preview.features, true, music.recent());
                },
                summary: (seconds) => player.activeSummary(seconds),
                keyParticleOverride: (songTime) => player.keyParticleOverride(songTime ?? midi.position),
                detach() { detachNote(); detachPiano(); },
            };
        }
        if (request.kind === "secret") {
            const { piano, midi, score, transport } = request;
            const player = new SecretCinemaPlayer(score, location.definition, transport.position, transport.type === "start");
            return {
                update: () => player.update(midi.position),
                keyParticleOverride: (songTime) => player.keyParticleOverride(songTime ?? midi.position),
                detach: piano.onDispose(() => stop(preview)),
            };
        }
        if (request.kind === "songTheme") {
            return createThemeProducer(preview, request.piano, request.theme, "live", Infinity);
        }
        return createThemeProducer(preview, request.piano, request.theme, "live", Infinity, true, request.seedNote);
    }

    if ("scene" in request) {
        const cues: VfxCue[] = planVfxScene(request.scene, request.options);
        let cursor = 0;
        preview.duration = (cues.at(-1)?.tick ?? 0) + 1;
        return { update: (_tick, elapsed) => {
            const cue = cues[cursor];
            if (!cue || cue.tick > elapsed) return [];
            cursor++;
            return [{ priority: 2, emitters: cue.emitters }];
        } };
    }

    if ("theme" in request) {
        const piano = request.input === "live" ? pianoWorld.get(location) : undefined;
        if (request.input === "live" && !piano) return;
        return createThemeProducer(preview, piano, request.theme, request.input, 45);
    }

    if ("painter" in request) {
        const painter = VFX_PAINTERS[request.painter];
        const opts = request.options;
        const music = new VfxMusic();
        preview.duration = Math.ceil(opts.seconds * 20);
        const piano = request.input === "live" ? pianoWorld.get(location) : undefined;
        if (request.input === "live" && !piano) return;
        const cleanups = piano ? attachLiveMusic(piano, music, preview, false) : [];
        let nextEmit = 0;
        let lastNoteTick = -1;
        let previousLength: number | undefined;
        let previousAmplitude: number | undefined;
        let soloStep = 0;
        return {
            detach: () => cleanups.forEach(cleanup => cleanup()),
            keyParticleOverride: request.painter === "key_style"
                ? () => keyParticleOverrideFromCue({
                    brush: opts.brush,
                    motion: opts.motion,
                    color: opts.color,
                    color2: opts.color2,
                    intensity: opts.level / 100,
                    scale: opts.scale / 100,
                })
                : undefined,
            update(tick, elapsed) {
                if (request.input !== "live" && request.input !== "solo") {
                    for (const note of simulatedVfxNotes(tick, elapsed, request.input)) music.note(note);
                }
                if (elapsed % 4 === 0) {
                    preview.features = request.input === "solo" ? quietFeatures : music.sample(tick);
                }
                if (elapsed < nextEmit) return [];
                const recent = music.recent();
                let hasFresh = false;
                if (painter.category === "keys") {
                    hasFresh = recent.some(note => note.tick > lastNoteTick);
                    if (!hasFresh && request.input !== "solo") return [];
                }
                const result = painter.emit({
                    color: opts.color,
                    color2: opts.color2,
                    intensity: opts.level / 100,
                    scale: opts.scale / 100,
                    brush: opts.brush,
                    zone: opts.zone,
                    motion: opts.motion,
                    music: preview.features,
                    recentNotes: recent,
                    lastNoteTick,
                    definition: location.definition,
                    previousLength,
                    previousAmplitude,
                    phase: painter.category === "keys" ? soloStep : (elapsed * 9) % 360,
                    solo: request.input === "solo",
                });
                if (painter.instant) {
                    nextEmit = elapsed + 45;
                } else if (painter.category === "keys") {
                    if (hasFresh) {
                        for (const note of recent) if (note.tick > lastNoteTick) lastNoteTick = note.tick;
                        nextEmit = elapsed + Math.max(1, painter.interval);
                    } else {
                        nextEmit = elapsed + 8;
                        soloStep += 5;
                    }
                } else {
                    nextEmit = elapsed + Math.max(1, painter.interval);
                }
                if (result.nextLength !== undefined) previousLength = result.nextLength;
                if (result.nextAmplitude !== undefined) previousAmplitude = result.nextAmplitude;
                return result.emitters.length ? [{ priority: result.priority, emitters: result.emitters }] : [];
            },
        };
    }

    const player = new VfxPresetPlayer(request.preset);
    const music = new VfxMusic();
    preview.duration = player.duration;
    const { input } = request;
    const piano = input === "live" ? pianoWorld.get(location) : undefined;
    if (input === "live" && !piano) return;
    const cleanups = piano ? [
        ...attachLiveMusic(piano, music, preview, true),
        piano.transportSignal.subscribe(event => {
            if (event.type !== "resume" && event.type !== "start") {
                player.reset(system.currentTick - preview.start);
            }
        }),
    ] : [];
    return {
        detach: () => cleanups.forEach(cleanup => cleanup()),
        keyParticleOverride: () => player.keyParticleOverride(),
        update(tick, elapsed) {
            if (input !== "live" && input !== "solo") {
                for (const note of simulatedVfxNotes(tick, elapsed, input)) music.note(note);
            }
            if (elapsed % 4 !== 0) return [];
            preview.features = input === "solo" ? quietFeatures : music.sample(tick);
            return player.update(elapsed, preview.features, input === "solo");
        },
    };
}

function update() {
    const tick = system.currentTick;
    const started = Date.now();
    let calls = 0;
    for (const [key, preview] of previews) {
        preview.budget.expire(tick);
        const elapsed = tick - preview.start;
        if (!preview.ended && (elapsed === 0 || tick % 20 === 0) && inspectInstrument(preview.location) !== "complete") stop(preview);
        if (!preview.ended && elapsed >= 0) {
            try {
                preview.producer ??= createProducer(preview);
                if (!preview.producer || elapsed >= preview.duration) stop(preview);
                else {
                    const before = preview.budget.dropped;
                    preview.budget.enqueue(preview.producer.update(tick, elapsed));
                    dropped += preview.budget.dropped - before;
                }
                preview.budget.dispatch(tick, emitter => {
                    calls++;
                    const seconds = "midi" in preview.request ? preview.request.midi.position : elapsed / 20;
                    spawnVfxEmitter(preview.location, emitter, seconds);
                    sent++;
                });
            } catch (error) {
                failures++;
                console.warn("[piano-vfx] 预览失败", error);
                stop(preview);
            }
        }
        if (preview.ended && !preview.budget.active) previews.delete(key);
    }
    peakCalls = Math.max(peakCalls, calls);
    if (calls) peakMs = Math.max(peakMs, Date.now() - started);
    if (!previews.size && timer !== undefined) {
        system.clearRun(timer);
        timer = undefined;
    }
}

function startPreview(location: InstrumentLocation, request: LabRequest) {
    const key = instrumentKey(location.dimension, location.pos);
    const previous = previews.get(key);
    if (!previous && previews.size >= VFX_MAX_PIANOS) throw new Error("已有 4 架琴占用预览预算，请等待粒子消退");
    if (previous) stop(previous);
    const budget = previous?.budget ?? new VfxBudget();
    const start = budget.nextAvailableTick(system.currentTick + 1);
    previews.set(key, { location, request, start, duration: 0, ended: false, budget, features: quietFeatures });
    timer ??= system.runInterval(update);
    return (start - system.currentTick - 1) / 20;
}

function status() {
    let active = 0;
    let emitters = 0;
    let reserved = 0;
    for (const preview of previews.values()) {
        if (!preview.ended) active++;
        emitters += preview.budget.active;
        reserved += preview.budget.reserved;
    }
    return `预览 ${active} / ${previews.size} 架占用 · 发射批次 ${emitters} · 预留粒子 ${reserved} · 已提交 ${sent} · 预算丢弃 ${dropped} 批 · 失败 ${failures} · 峰值 ${peakCalls} 调用/刻，${peakMs} ms/发射刻`;
}

function words(message: string): [string, string] {
    const [, head = "", rest = ""] = message.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/) ?? [];
    return [head, rest];
}

function parseDrawOptions(raw: string): DrawCommandOptions {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("参数需要是 JSON 对象");
    const color = parsed.color !== undefined ? resolvePerformanceColor(String(parsed.color)) : "#68E4FF";
    const color2 = parsed.color2 !== undefined ? resolvePerformanceColor(String(parsed.color2)) : deriveAccentHex(color);
    let aliasBrush: PerformanceBrush | undefined;
    let aliasMotion: PerformanceMotion | undefined;
    if (parsed.style !== undefined) {
        const alias = parseKeyParticleAlias(String(parsed.style));
        if (!alias) throw new Error(`未知弹奏粒子样式 ${parsed.style}`);
        aliasBrush = alias.brush;
        aliasMotion = alias.motion;
    }
    let brush: PerformanceBrush | undefined = aliasBrush;
    if (parsed.brush !== undefined) {
        if (typeof parsed.brush !== "string" || !Object.hasOwn(PERFORMANCE_BRUSHES, parsed.brush)) {
            throw new Error(`未知笔刷 ${parsed.brush}`);
        }
        brush = parsed.brush as PerformanceBrush;
    }
    let zone: PerformanceZone | undefined;
    if (parsed.zone !== undefined) {
        if (typeof parsed.zone !== "string" || !Object.hasOwn(PERFORMANCE_ZONES, parsed.zone)) {
            throw new Error(`未知高度区域 ${parsed.zone}`);
        }
        zone = parsed.zone as PerformanceZone;
    }
    let motion: PerformanceMotion | undefined = aliasMotion;
    if (parsed.motion !== undefined) {
        if (typeof parsed.motion !== "string" || !Object.hasOwn(PERFORMANCE_MOTIONS, parsed.motion)) {
            throw new Error(`未知运动修饰 ${parsed.motion}`);
        }
        motion = parsed.motion as PerformanceMotion;
    }
    const level = parsed.level !== undefined ? Number(parsed.level) : 85;
    if (!Number.isFinite(level) || level < 1 || level > 100) throw new Error("level 需要在 1 到 100 之间");
    const scale = parsed.scale !== undefined ? Number(parsed.scale) : 100;
    if (!Number.isFinite(scale) || scale < 50 || scale > 170) throw new Error("scale 需要在 50 到 170 之间");
    const seconds = parsed.seconds !== undefined ? Number(parsed.seconds) : 12;
    if (!Number.isFinite(seconds) || seconds < 2 || seconds > 180) throw new Error("seconds 需要在 2 到 180 之间");
    return { color, color2, brush, zone, motion, level, scale, seconds };
}

export function registerVfxLab() {
    pianoWorld.created.subscribe(piano => {
        piano.setParticleOverrideProvider((songTime) => activeKeyParticleOverride(piano, songTime));
        piano.transportSignal.subscribe(event => syncSongVfx(piano, event));
        piano.settingsSignal.subscribe(() => refreshAutoVfx(piano));
        piano.noteSignal.subscribe(note => {
            if (note.source !== "manual") return;
            const settings = piano.settings ?? DEFAULT_PIANO_SETTINGS;
            if (settings.stageTheme === "off" || piano.getMidiPlayer().isPlaying()) return;
            const key = instrumentKey(piano.location.dimension, piano.location.pos);
            const previous = previews.get(key);
            if (previous && !previous.ended) {
                if ("auto" in previous.request && previous.request.kind === "manualTheme") {
                    previous.request.lastNoteAt = system.currentTick;
                }
                return;
            }
            const seed = note.tick !== undefined && note.velocity !== undefined && note.hasVelocity !== undefined
                ? {
                    midi: note.midi, duration: note.duration, tick: note.tick, velocity: note.velocity,
                    source: "manual" as const, hasVelocity: note.hasVelocity, songTime: note.songTime,
                }
                : undefined;
            wakeManualTheme(piano, settings.stageTheme, seed);
        });
    });
    instrumentDestroyed.subscribe(location => {
        const preview = previews.get(instrumentKey(location.dimension, location.pos));
        if (preview) stop(preview);
    });
    system.afterEvents.scriptEventReceive.subscribe(event => {
        if (event.id !== "pbe:vfx" || event.sourceType !== ScriptEventSource.Entity || !(event.sourceEntity instanceof Player)) return;
        const player = event.sourceEntity;
        const [action, args] = words(event.message);
        const say = (message: string) => player.sendMessage(`[PianoBE VFX Lab] ${message}`);
        try {
            if (action === "help" || !action) {
                say("list [分类] · painters [分类] · draw <方法> [输入] [JSON] · theme <主题> [输入] · preview <特效> [JSON] · preset <预设> [输入] · compose <输入> <JSON> · save/remove · status · reset · stop");
                say("输入 live / phrase / note / chord / dense / solo");
                return;
            }
            if (action === "list") {
                const entries = Object.entries(VFX_EFFECTS).filter(([, def]) => !args || def.category === args);
                for (const [name, def] of entries) say(`${def.category} / ${name} · ${def.mode} · ${def.options.join(", ")}`);
                if (!args) {
                    say(`内置主题 ${[...Object.keys(VFX_PRESETS), ...Object.keys(VFX_STAGE_THEMES)].join(", ")} · 自定义 ${[...loadVfxPresets().keys()].join(", ") || "无"}`);
                }
                return;
            }
            if (action === "painters") {
                const category = args.trim() as PainterCategory | "";
                const entries = (Object.entries(VFX_PAINTERS) as [PerformanceMethod, typeof VFX_PAINTERS[PerformanceMethod]][])
                    .filter(([, def]) => !category || def.category === category);
                if (!entries.length) throw new Error("分类需为 atmosphere / curve / stage / keys / accent");
                for (const [name, def] of entries) {
                    say(`${def.category} / ${name} (${def.label}) · 笔刷 ${def.defaultBrush} · ${def.instant ? "瞬时" : "持续"}`);
                }
                return;
            }
            if (action === "save" || action === "remove") {
                const [name, body] = words(args);
                saveVfxPreset(name, action === "save" ? validateVfxPreset(JSON.parse(body)) : undefined);
                say(action === "save" ? `已保存 ${name}` : `已移除 ${name}`);
                return;
            }
            const hit = player.getBlockFromViewDirection({ maxDistance: 12 });
            const location = hit && resolveInstrument(hit.block);
            const previous = location && previews.get(instrumentKey(location.dimension, location.pos));
            if (action === "status") {
                say(status());
                const statusPiano = previous && "piano" in previous.request
                    ? previous.request.piano
                    : location ? pianoWorld.get(location) : undefined;
                const keyOverride = previous && !previous.ended
                    ? (statusPiano ? activeKeyParticleOverride(statusPiano) : previous.producer?.keyParticleOverride?.())
                    : undefined;
                const keyText = keyOverride?.style
                    ? ` · 弹奏粒子 ${KEY_PARTICLE_STYLE_LABELS[keyOverride.style]}`
                    : "";
                if (previous && "midi" in previous.request) {
                    const channels = previous.producer?.summary?.(previous.request.midi.position) ?? [];
                    const activeText = channels.length
                        ? ` · 活跃通道 ${channels.map(c => `${c.method}:${c.slot}(${c.level}%)`).join(", ")}`
                        : "";
                    const modeLabel = previous.request.kind === "secret"
                        ? "Secret 电影版"
                        : previous.request.kind === "songTheme"
                            ? `主题 ${previous.request.theme}`
                            : "曲目演出";
                    say(`${modeLabel} · ${previous.request.midi.position.toFixed(2)} 秒${activeText}${keyText}`);
                }
                if (previous && "input" in previous.request) {
                    const { density, activity, velocity, pitch, sustain } = previous.features;
                    const label = "painter" in previous.request ? previous.request.painter : previous.request.name;
                    say(`${label} / ${previous.request.input} · 密度 ${density.toFixed(2)} · 活跃 ${activity.toFixed(2)} · 力度 ${velocity.toFixed(2)} · 音高 ${pitch.toFixed(2)} · 延音 ${sustain.toFixed(2)}${keyText}`);
                }
                return;
            }
            if (!location || inspectInstrument(location) !== "complete") throw new Error("请瞄准 12 格以内的完整钢琴方块");
            if (action === "stop") {
                if (previous) stop(previous);
                say(previous ? "已停止后续发射，现存粒子会自行淡出" : "这架琴没有预览");
                return;
            }
            const [name, detail] = words(args);
            const scene = VFX_SCENES.find(value => value === action);
            let request: LabRequest;
            if (action === "reset" && previous) {
                if ("midi" in previous.request) {
                    void previous.request.midi.restart();
                    return;
                }
                if ("auto" in previous.request) throw new Error("该模式不可重播");
                request = "scene" in previous.request ? { scene: previous.request.scene, options: {} } : previous.request;
            } else if (scene) {
                request = { scene, options: parseVfxOptions(args) };
            } else if (action === "preview" && isVfxEffect(name)) {
                request = {
                    input: "solo", name, preset: {
                        seconds: 9,
                        layers: [{ effect: name, options: validateEffectOptions(name, detail ? JSON.parse(detail) : {}) }],
                    },
                };
            } else if (action === "draw") {
                if (!Object.hasOwn(PERFORMANCE_METHODS, name)) throw new Error(`未知绘制方法 ${name}`);
                const trimmed = detail.trim();
                let inputName = "live";
                let jsonRaw = "";
                if (trimmed.startsWith("{")) {
                    jsonRaw = trimmed;
                } else if (trimmed) {
                    const [maybeInput, maybeJson] = words(trimmed);
                    inputName = maybeInput;
                    jsonRaw = maybeJson;
                }
                request = {
                    painter: name as PerformanceMethod,
                    input: vfxInput(inputName),
                    options: parseDrawOptions(jsonRaw),
                };
            } else if (action === "preset" || action === "theme") {
                const input = vfxInput(detail || "live");
                if (isVfxStageTheme(name)) {
                    request = { theme: name, input, name };
                } else {
                    const preset = Object.hasOwn(VFX_PRESETS, name) ? VFX_PRESETS[name] : loadVfxPresets().get(name);
                    if (!preset) throw new Error(`未知预设或主题 ${name}`);
                    request = { preset, name, input };
                }
            } else if (action === "compose") {
                request = { preset: validateVfxPreset(JSON.parse(detail)), name: "compose", input: vfxInput(name) };
            } else {
                throw new Error("未知指令或预览，使用 help 查看用法");
            }
            const wait = startPreview(location, request);
            const label = "scene" in request
                ? request.scene
                : "painter" in request
                    ? `${request.painter} / ${request.input}`
                    : `${request.name} / ${request.input}`;
            say(wait > 0 ? `${label} 将在现有粒子淡出后开始（约 ${wait.toFixed(1)} 秒）` : `开始 ${label}`);
        } catch (error) {
            say(error instanceof Error ? error.message : String(error));
        }
    });
}
