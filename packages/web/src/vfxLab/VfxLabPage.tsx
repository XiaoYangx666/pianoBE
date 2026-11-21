import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, CircleHelp, Eye, EyeOff, FileUp, Maximize2, Pause, Play, Repeat2, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
    PERFORMANCE_MOTIONS,
    PERFORMANCE_ZONES,
    readSongHeader,
    resolvePerformanceColor,
    songToNoteEvents,
    TIME_SCALE,
    type PerformanceCue,
    type PerformanceMotion,
    type PerformanceZone,
} from "@piano/core";
import secretUrl from "../../../../midis/library/e1563b03.pbe3?url";
import secret from "../../../../midis/performances/e1563b03.json";
import {
    deriveAccentHex,
    getVfxEffect,
    isVfxTheme,
    KEY_PARTICLE_STYLE_LABELS,
    POINT_BRUSHES,
    quietFeatures,
    simulatedVfxNotes,
    STROKE_BRUSHES,
    validateVfxTheme,
    VFX_EFFECT_IDS,
    VFX_EFFECTS,
    VFX_PARTICLES_PER_PIANO,
    VFX_THEME_ORDER,
    VFX_THEMES,
    type MusicFeatures,
    type SingleEffectConfig,
    type VfxTheme,
    type VfxThemeId,
    type VfxThemeLayer,
} from "@piano/vfx";
import { MidiPlayer, parseMidi, type NoteEvent } from "../midiPlayer";
import { createStage, type Direction, type PreviewStats, type Stage, type StageMode, type Track, type View } from "./stage";
import type { PianoModel } from "./models";
import { MusicStrip } from "./MusicStrip";
import "./vfxLab.css";

const themeEnglishNames: Record<VfxThemeId, string> = {
    galaxy: "Galaxy",
    neon: "Neon",
    stage: "Stage",
    sakura: "Sakura",
    starlight: "Starlight",
    cathedral: "Cathedral",
    carnival: "Carnival",
};

const zoneNames: Record<PerformanceZone, string> = {
    stage: "舞台基准",
    low: "低空贴地",
    mid: "中空环绕",
    high: "高空天顶",
};

const motionNames: Record<PerformanceMotion, string> = {
    normal: "标准",
    reverse: "反向",
    intense: "强力",
    gentle: "轻柔",
};

const triggerNames = {
    continuous: "持续周期",
    note: "音符触发",
    instant: "瞬时脉冲",
    control: "状态控制",
} as const;

const featureNames: Record<keyof MusicFeatures, string> = {
    density: "密度",
    velocity: "力度",
    dynamics: "力度变化",
    activity: "活动度",
    pitch: "音高",
    low: "低音",
    middle: "中音",
    high: "高音",
    sustain: "延音",
    surge: "舞台蓄势",
    chord: "和弦",
    onset: "起奏",
};

const fixturePoints = [[0, "休止"], [3.75, "弱奏"], [5.5, "长音"], [6.6, "和弦"], [8.7, "高潮"], [11.4, "回落"]] as const;
const fixtureModes = { phrase: "标准乐句", note: "长音", chord: "和弦", dense: "密集音符" } as const;
type Fixture = keyof typeof fixtureModes;
type LabSong = { title: string; notes: NoteEvent[]; duration: number; performance?: readonly PerformanceCue[]; sample?: boolean };

function readPbe(bytes: Uint8Array): LabSong {
    const header = readSongHeader(bytes);
    return {
        title: header.name,
        notes: songToNoteEvents(bytes),
        duration: header.duration / TIME_SCALE,
        performance: header.performance,
    };
}

async function loadSecret(): Promise<LabSong> {
    const response = await fetch(secretUrl);
    if (!response.ok) throw new Error(`读取《Secret》失败 (${response.status})`);
    return { ...readPbe(new Uint8Array(await response.arrayBuffer())), title: secret.title, sample: true };
}

function makeFixture(mode: Fixture): NoteEvent[] {
    return Array.from({ length: 240 }, (_, tick) => simulatedVfxNotes(tick, tick, mode).map(note => ({
        midi: note.midi, time: tick / 20, duration: note.duration, velocity: note.velocity / 127,
    }))).flat();
}

function toTrack(
    events: readonly NoteEvent[],
    duration: number,
    source: "midi" | "simulation",
    performance?: readonly PerformanceCue[],
): Track {
    const notes = new Map<number, NonNullable<ReturnType<Track["notes"]["get"]>>[number][]>();
    for (const note of events) {
        const tick = source === "midi" ? Math.floor(note.time * 20 + 0.500001) : Math.ceil(note.time * 20 - 1e-7);
        const bucket = notes.get(tick) ?? [];
        bucket.push({
            midi: note.midi,
            duration: note.duration,
            velocity: Math.round(note.velocity * 127),
            hasVelocity: true,
            source,
            tick,
            songTime: note.time,
        });
        notes.set(tick, bucket);
    }
    return { notes, duration, performance };
}

function saveFile(url: string, name: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
}

function exportThemeJson(theme: VfxTheme, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" }));
    saveFile(url, `pianobe-vfx-${name}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function seconds(time: number) {
    return `${time.toFixed(2)} s`;
}

function defaultBrushLabel(effectId: string): string {
    const def = getVfxEffect(effectId);
    if (!def) return "无";
    const point = def.defaultBrush ? POINT_BRUSHES.find(item => item.id === def.defaultBrush)?.label : undefined;
    const stroke = def.defaultStroke ? STROKE_BRUSHES.find(item => item.id === def.defaultStroke)?.label : undefined;
    if (point && stroke) return `${point} / ${stroke}`;
    return point ?? stroke ?? "无";
}

function variantLabel(effectId: string, variant: string): string {
    if (effectId === "key_style" && variant in KEY_PARTICLE_STYLE_LABELS) {
        return KEY_PARTICLE_STYLE_LABELS[variant as keyof typeof KEY_PARTICLE_STYLE_LABELS];
    }
    return variant;
}

function NumberField({ label, value, min, max, step = 1, disabled, set }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    disabled?: boolean;
    set: (value: number) => void;
}) {
    const [focused, setFocused] = useState(false);
    const [draft, setDraft] = useState("");
    function parse(text: string): number | undefined {
        const number = Number(text.trim());
        return text.trim() && Number.isFinite(number) ? number : undefined;
    }
    return <input
        aria-label={label}
        type="text"
        inputMode={step < 1 ? "decimal" : "numeric"}
        disabled={disabled}
        value={focused ? draft : String(value)}
        onFocus={() => { setDraft(String(value)); setFocused(true); }}
        onChange={event => {
            const text = event.target.value;
            setDraft(text);
            const parsed = parse(text);
            if (parsed !== undefined && parsed >= min && parsed <= max) set(parsed);
        }}
        onBlur={() => {
            const parsed = parse(draft);
            if (parsed !== undefined) set(Math.min(max, Math.max(min, parsed)));
            setFocused(false);
        }}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />;
}

function BrushSelect({ label, effectId, value, onChange }: {
    label: string;
    effectId: string;
    value?: string;
    onChange: (next?: string) => void;
}) {
    const def = getVfxEffect(effectId);
    if (!def?.defaultBrush && !def?.defaultStroke) return null;
    return (
        <label>{label}
            <select aria-label={label} value={value ?? ""} onChange={event => onChange(event.target.value || undefined)}>
                <option value="">默认 ({defaultBrushLabel(effectId)})</option>
                {def.defaultBrush && (
                    <optgroup label="点状纹理">
                        {POINT_BRUSHES.map(brush => (
                            <option key={brush.id} value={brush.id}>{brush.label} ({brush.id})</option>
                        ))}
                    </optgroup>
                )}
                {def.defaultStroke && (
                    <optgroup label="线条笔刷">
                        {STROKE_BRUSHES.map(brush => (
                            <option key={brush.id} value={brush.id}>{brush.label} ({brush.id})</option>
                        ))}
                    </optgroup>
                )}
            </select>
        </label>
    );
}

function ThemeLayerEditor({ layer, update, remove }: {
    layer: VfxThemeLayer;
    update: (next: VfxThemeLayer) => void;
    remove?: () => void;
}) {
    const def = getVfxEffect(layer.effect);
    const primaryHex = resolvePerformanceColor(layer.color);
    const accentHex = layer.color2 ? resolvePerformanceColor(layer.color2) : deriveAccentHex(primaryHex);
    const levelMapped = typeof layer.level !== "number";

    return (
        <div className="vfx-editor">
            <div className="vfx-painter-grid">
                <label>特效
                    <select aria-label="图层特效" value={layer.effect} onChange={event => {
                        const effect = event.target.value;
                        const nextDef = getVfxEffect(effect);
                        update({
                            ...layer,
                            effect,
                            brush: undefined,
                            variant: nextDef?.variants?.[0],
                            gate: nextDef?.trigger === "instant"
                                ? (layer.gate ?? { input: "chord", threshold: 0.5, cooldown: 32 })
                                : undefined,
                        });
                    }}>
                        {VFX_EFFECT_IDS.map(id => (
                            <option key={id} value={id}>{VFX_EFFECTS[id].label} ({id})</option>
                        ))}
                    </select>
                </label>
                {def?.variants?.length ? (
                    <label>变体
                        <select aria-label="图层变体" value={layer.variant ?? ""} onChange={event =>
                            update({ ...layer, variant: event.target.value || undefined })}>
                            <option value="">默认</option>
                            {def.variants.map(item => (
                                <option key={item} value={item}>{variantLabel(layer.effect, item)}</option>
                            ))}
                        </select>
                    </label>
                ) : null}
                <div className="vfx-colors">
                    <label>主色 <input aria-label="图层主色" type="color" value={primaryHex}
                        onChange={event => update({ ...layer, color: event.target.value })} /></label>
                    <label>副色 <input aria-label="图层副色" type="color" value={accentHex}
                        onChange={event => update({ ...layer, color2: event.target.value })} /></label>
                </div>
                <BrushSelect label="画笔" effectId={layer.effect} value={layer.brush}
                    onChange={brush => update({ ...layer, brush })} />
                {def?.trigger !== "control" && <>
                    <label>高度区域
                        <select aria-label="图层区域" value={layer.zone ?? "stage"} onChange={event =>
                            update({ ...layer, zone: event.target.value as PerformanceZone })}>
                            {(Object.keys(PERFORMANCE_ZONES) as PerformanceZone[]).map(zone => (
                                <option key={zone} value={zone}>{zoneNames[zone]}</option>
                            ))}
                        </select>
                    </label>
                    <label>运动修饰
                        <select aria-label="图层运动" value={layer.motion ?? "normal"} onChange={event =>
                            update({ ...layer, motion: event.target.value as PerformanceMotion })}>
                            {(Object.keys(PERFORMANCE_MOTIONS) as PerformanceMotion[]).map(motion => (
                                <option key={motion} value={motion}>{motionNames[motion]}</option>
                            ))}
                        </select>
                    </label>
                </>}
                <label>缩放 (%)
                    <NumberField label="图层缩放" value={layer.scale ?? 100} min={50} max={170}
                        set={scale => update({ ...layer, scale: Math.round(scale) })} />
                </label>
                <label>强度模式
                    <select aria-label="强度模式" value={levelMapped ? "mapped" : "fixed"} onChange={event => {
                        if (event.target.value === "mapped") {
                            update({ ...layer, level: { input: "activity", from: 40, to: 90 } });
                        } else {
                            update({ ...layer, level: typeof layer.level === "number" ? layer.level : 85 });
                        }
                    }}>
                        <option value="fixed">固定百分比</option>
                        <option value="mapped">音乐特征映射</option>
                    </select>
                </label>
                {typeof layer.level === "number" ? (
                    <label>强度 (%)
                        <NumberField label="图层强度" value={layer.level} min={0} max={100}
                            set={level => update({ ...layer, level: Math.round(level) })} />
                    </label>
                ) : (
                    <>
                        <label>音乐特征
                            <select aria-label="映射特征" value={layer.level.input} onChange={event => {
                                if (typeof layer.level === "number") return;
                                update({ ...layer, level: { ...layer.level, input: event.target.value as keyof MusicFeatures } });
                            }}>
                                {(Object.keys(quietFeatures) as (keyof MusicFeatures)[]).map(key => (
                                    <option key={key} value={key}>{featureNames[key]}</option>
                                ))}
                            </select>
                        </label>
                        <label>映射下限 (%)
                            <NumberField label="映射起点" value={layer.level.from} min={0} max={100}
                                set={from => typeof layer.level !== "number" && update({ ...layer, level: { ...layer.level, from: Math.round(from) } })} />
                        </label>
                        <label>映射上限 (%)
                            <NumberField label="映射终点" value={layer.level.to} min={0} max={100}
                                set={to => typeof layer.level !== "number" && update({ ...layer, level: { ...layer.level, to: Math.round(to) } })} />
                        </label>
                    </>
                )}
                {(def?.trigger === "instant" || layer.gate) && (
                    <>
                        <label>门限触发
                            <select aria-label="门限输入" value={layer.gate?.input ?? "off"} onChange={event => {
                                const value = event.target.value;
                                if (value === "off") { update({ ...layer, gate: undefined }); return; }
                                update({
                                    ...layer,
                                    gate: {
                                        input: value as "chord" | "onset" | "surge",
                                        threshold: layer.gate?.threshold ?? 0.5,
                                        cooldown: layer.gate?.cooldown ?? 32,
                                    },
                                });
                            }}>
                                <option value="off">无门限</option>
                                <option value="chord">和弦</option>
                                <option value="onset">起奏</option>
                                <option value="surge">舞台蓄势</option>
                            </select>
                        </label>
                        {layer.gate && <>
                            <label>触发阈值
                                <NumberField label="门限阈值" value={layer.gate.threshold} min={0} max={1} step={0.05}
                                    set={threshold => layer.gate && update({ ...layer, gate: { ...layer.gate, threshold } })} />
                            </label>
                            <label>冷却刻数
                                <NumberField label="门限冷却" value={layer.gate.cooldown} min={1} max={400}
                                    set={cooldown => layer.gate && update({ ...layer, gate: { ...layer.gate, cooldown: Math.round(cooldown) } })} />
                            </label>
                        </>}
                    </>
                )}
                {remove && <button type="button" onClick={remove}>移除图层</button>}
            </div>
        </div>
    );
}

export default function VfxLabPage() {
    const [inspectorMode, setInspectorMode] = useState<"theme" | "effect">("theme");
    const [themeId, setThemeId] = useState<string>("galaxy");
    const [theme, setTheme] = useState<VfxTheme>(VFX_THEMES.galaxy);
    const [singleConfig, setSingleConfig] = useState<SingleEffectConfig>({
        effect: "magic_circle",
        color: "#68E4FF",
        color2: "#C58CFF",
        zone: "stage",
        motion: "normal",
        level: 85,
        scale: 100,
    });
    const [hidden, setHidden] = useState<Set<number>>(new Set());
    const [open, setOpen] = useState<number | null>(null);
    const [fixture, setFixture] = useState<Fixture>("phrase");
    const [midi, setMidi] = useState<LabSong>();
    const [model, setModel] = useState<PianoModel>("grand");
    const [direction, setDirection] = useState<Direction>("south");
    const [view, setView] = useState<View>("stage");
    const [deck, setDeck] = useState(true);
    const [debug, setDebug] = useState(false);
    const [showKeyParticles, setShowKeyParticles] = useState(true);
    const effectCount = VFX_EFFECT_IDS.length;
    const [loop, setLoop] = useState(true);
    const [loopIn, setLoopIn] = useState(0);
    const [loopOut, setLoopOut] = useState(12);
    const [muted, setMuted] = useState(false);
    const [ready, setReady] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [loadingAudio, setLoadingAudio] = useState(false);
    const [time, setTime] = useState(0);
    const [stats, setStats] = useState<PreviewStats>();
    const [error, setError] = useState("");
    const canvas = useRef<HTMLCanvasElement>(null);
    const stage = useRef<Stage | null>(null);
    const midiInput = useRef<HTMLInputElement>(null);
    const themeInput = useRef<HTMLInputElement>(null);
    const position = useRef(0);
    const audio = useMemo(() => new MidiPlayer(), []);
    const playGeneration = useRef(0);
    const selectionGeneration = useRef(0);
    const loaded = useRef(false);
    const capture = new URLSearchParams(location.search).has("capture");
    const events = useMemo(() => midi?.notes ?? makeFixture(fixture), [fixture, midi]);
    const track = useMemo(() => toTrack(events, midi?.duration ?? 12, midi ? "midi" : "simulation", midi?.performance), [events, midi]);
    const visibleTheme = useMemo<VfxTheme>(() => ({
        ...theme,
        layers: theme.layers.filter((_, index) => !hidden.has(index)),
    }), [theme, hidden]);
    const activeEffectDef = getVfxEffect(singleConfig.effect);

    function selectTheme(id: string, value: VfxTheme = isVfxTheme(id) ? VFX_THEMES[id] : VFX_THEMES.galaxy) {
        setThemeId(id);
        setTheme(value);
        setHidden(new Set());
        setOpen(null);
    }

    function jump(to: number, sync = true) {
        position.current = Math.max(0, Math.min(track.duration, to));
        setTime(position.current);
        if (sync) stage.current?.seek(position.current);
        if (sync && loaded.current) audio.seek(position.current);
    }

    function resetAudio() {
        playGeneration.current++;
        audio.stop();
        loaded.current = false;
        setPlaying(false);
        setLoadingAudio(false);
    }

    useEffect(() => {
        let cancelled = false;
        const start = requestAnimationFrame(() => {
            void createStage(canvas.current!).then(instance => {
                if (cancelled) { instance.dispose(); return; }
                stage.current = instance;
                setReady(true);
            }).catch(reason => {
                if (!cancelled) setError(`无法启动 WebGL · ${String(reason)}`);
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(start);
            stage.current?.dispose();
            stage.current = null;
            audio.stop();
        };
    }, [audio]);

    useEffect(() => {
        if (!ready) return;
        const mode: StageMode = inspectorMode === "effect"
            ? { kind: "single", config: singleConfig }
            : { kind: "theme", theme: visibleTheme };
        stage.current!.configure(mode, track, model, direction, position.current);
    }, [ready, visibleTheme, track, model, direction, inspectorMode, singleConfig]);

    useEffect(() => { stage.current?.setView(view); }, [ready, view]);
    useEffect(() => { stage.current?.setDeck(deck); }, [ready, deck]);
    useEffect(() => { stage.current?.setDebug(debug); }, [ready, debug]);
    useEffect(() => { stage.current?.setKeyParticles(showKeyParticles); }, [ready, showKeyParticles]);

    useEffect(() => {
        if (!ready || capture) return;
        const instance = stage.current!;
        let raf = 0;
        let last = performance.now();
        let published = -Infinity;
        function animate(now: number) {
            if (playing) {
                if (muted) position.current += Math.min(0.12, (now - last) / 1000);
                else position.current = audio.getState().currentTime;
                if (position.current >= (loop ? loopOut : track.duration)) {
                    if (loop) jump(loopIn);
                    else { position.current = track.duration; setPlaying(false); audio.pause(); }
                }
            }
            last = now;
            instance.advance(position.current);
            instance.render();
            if (now - published > 115) {
                setTime(position.current);
                setStats(instance.stats());
                published = now;
            }
            raf = requestAnimationFrame(animate);
        }
        raf = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(raf);
    }, [ready, playing, muted, loop, loopIn, loopOut, track, audio, capture]);

    useEffect(() => {
        if (!capture || !ready) return;
        let sample: Promise<LabSong> | undefined;
        const decodeSong = (base64: string) => readPbe(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
        const lab = {
            render: async (options: {
                preset: string | VfxTheme;
                time: number;
                view?: View;
                piano?: PianoModel;
                direction?: Direction;
                deck?: boolean;
                songBase64?: string;
            }) => {
                const instance = stage.current!;
                instance.setView(options.view ?? "stage");
                instance.setDeck(options.deck ?? true);
                const custom = options.songBase64 ? decodeSong(options.songBase64) : undefined;
                const song = custom ?? (options.preset === "secret" ? await (sample ??= loadSecret()) : undefined);
                const input = song ? toTrack(song.notes, song.duration, "midi", song.performance) : track;
                const selection = song
                    ? VFX_THEMES.galaxy
                    : typeof options.preset === "string"
                        ? (isVfxTheme(options.preset) ? VFX_THEMES[options.preset] : undefined)
                        : validateVfxTheme(options.preset);
                if (!selection) throw new Error(`未知主题: ${String(options.preset)}`);
                instance.configure({ kind: "theme", theme: selection }, input, options.piano ?? "grand",
                    options.direction ?? "south", options.time);
                position.current = options.time;
                return { ...instance.stats(), duration: song?.duration ?? track.duration };
            },
            advance: (time: number) => {
                position.current = time;
                stage.current!.advance(time);
                stage.current!.render();
                return stage.current!.stats();
            },
            scoreDuration: async () => (await (sample ??= loadSecret())).duration,
            songDuration: (base64: string) => decodeSong(base64).duration,
        };
        Object.assign(window, { pianoVfxLab: lab });
        return () => { Reflect.deleteProperty(window, "pianoVfxLab"); };
    }, [capture, ready, track]);

    async function togglePlay() {
        if (playing) {
            if (!muted) position.current = audio.getState().currentTime;
            setTime(position.current);
            audio.pause();
            setPlaying(false);
            return;
        }
        if (position.current >= (loop ? loopOut : track.duration)) jump(loop ? loopIn : 0);
        if (muted) { setPlaying(true); return; }
        if (loaded.current) { audio.resume(); setPlaying(true); return; }
        const generation = ++playGeneration.current;
        setLoadingAudio(true);
        try {
            await audio.playSong("vfx-lab", midi?.title ?? fixtureModes[fixture], track.duration, events);
            if (generation !== playGeneration.current) return;
            loaded.current = true;
            audio.seek(position.current);
            setPlaying(true);
        } catch (reason) {
            if (generation === playGeneration.current) setError(String(reason));
        } finally {
            if (generation === playGeneration.current) setLoadingAudio(false);
        }
    }

    async function selectSong(load: () => Promise<LabSong>) {
        const generation = ++selectionGeneration.current;
        try {
            const song = await load();
            if (generation !== selectionGeneration.current) return;
            resetAudio();
            jump(0, false);
            setLoopIn(0);
            setLoopOut(song.duration);
            setLoop(false);
            setMidi(song);
            setError("");
        } catch (reason) {
            if (generation === selectionGeneration.current) setError(`读取曲目失败 · ${String(reason)}`);
        }
    }

    function loadMidi(file?: File) {
        if (!file) return;
        void selectSong(async () => {
            const bytes = await file.arrayBuffer();
            if (file.name.toLowerCase().endsWith(".pbe3")) return readPbe(new Uint8Array(bytes));
            const notes = parseMidi(bytes).filter(note => note.midi >= 21 && note.midi <= 108);
            if (!notes.length) throw new Error("MIDI 中没有钢琴音域内的音符");
            const duration = Math.ceil(20 * notes.reduce((end, note) => Math.max(end, note.time + note.duration), 0)) / 20 + 2.5;
            return { title: file.name, notes, duration };
        });
    }

    function updateLayer(index: number, layer: VfxThemeLayer) {
        setTheme(previous => ({
            ...previous,
            layers: previous.layers.map((item, i) => i === index ? layer : item),
        }));
    }

    if (capture) return <main className="vfx-capture"><canvas ref={canvas} />{error && <p>{error}</p>}</main>;
    return <main className="vfx-lab">
        <header className="vfx-header">
            <div className="vfx-header-title"><a href="/">PianoBE</a><span>/</span><h1>VFX Lab</h1></div>
            <details className="vfx-help">
                <summary><CircleHelp size={17} /> 渲染说明</summary>
                <div>预览读取实际 Bedrock 粒子 JSON 与图集纹理，与游戏内共享同一套 VFX 引擎、特效定义、音乐特征采样及粒子预算。
                    排练台、布光和演奏者是 Web 场景布置，可切换平地。
                    Vibrant Visuals 的 MER、混合、世界照明和网络时序以游戏客户端为准。</div>
            </details>
        </header>
        {error && <div className="vfx-error" role="alert">{error} <button onClick={() => setError("")}>关闭</button></div>}
        <div className="vfx-workbench">
            <section className="vfx-main" aria-label="舞台预览">
                <div className="vfx-viewport">
                    <canvas aria-label="钢琴和粒子三维舞台" ref={canvas} />
                    {!ready && !error && <p className="vfx-loading">正在加载舞台资源…</p>}
                    <div className="vfx-viewport-bar">
                        <div className="vfx-segment" aria-label="摄像机">
                            {(["stage", "performer", "orbit"] as const).map((choice, index) =>
                                <button key={choice} aria-pressed={view === choice} onClick={() => setView(choice)}>
                                    {["舞台", "演奏视角", "自由"][index]}
                                </button>)}
                        </div>
                        <button className="vfx-icon" title="保存画面" aria-label="保存画面" disabled={!ready} onClick={() =>
                            saveFile(canvas.current!.toDataURL(), `pianobe-${themeId}-${time.toFixed(2)}.png`)}><Camera size={17} /></button>
                        <button className="vfx-icon" title="全屏" aria-label="全屏" onClick={event =>
                            void event.currentTarget.closest(".vfx-viewport")?.requestFullscreen()}><Maximize2 size={16} /></button>
                    </div>
                    <div className="vfx-overlay"><span>{model === "grand" ? "三角钢琴" : "P-88"}</span>
                        <span>{stats?.particles ?? 0} 粒子</span></div>
                </div>
                <section className="vfx-transport" aria-label="音乐时间轴">
                    <div className="vfx-row vfx-player-row">
                        <button className="vfx-play" title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"}
                            disabled={!ready || loadingAudio} onClick={() => void togglePlay()}>
                            {playing ? <Pause size={17} /> : <Play size={17} />}</button>
                        <button className="vfx-icon" title={muted ? "取消静音" : "静音"} aria-label={muted ? "取消静音" : "静音"}
                            onClick={() => { resetAudio(); setMuted(!muted); }}>
                            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
                        <button className="vfx-icon" aria-label="循环片段" aria-pressed={loop} onClick={() => setLoop(!loop)}><Repeat2 size={17} /></button>
                        <time>{seconds(time)} <small>/ {seconds(track.duration)}</small></time>
                        <select aria-label="音乐片段" value={midi?.sample ? "secret" : midi ? "midi" : fixture} onChange={event => {
                            if (event.target.value === "secret") { void selectSong(loadSecret); return; }
                            selectionGeneration.current++;
                            resetAudio(); jump(0, false); setLoopIn(0); setLoopOut(12); setMidi(undefined);
                            setFixture(event.target.value as Fixture);
                        }}>
                            {Object.entries(fixtureModes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                            <option value="secret">{secret.title}</option>
                            {midi && !midi.sample && <option value="midi">{midi.title}</option>}
                        </select>
                        <button className="vfx-load" onClick={() => midiInput.current?.click()}><FileUp size={15} /> 打开曲目</button>
                        <input ref={midiInput} type="file" accept=".mid,.midi,.pbe3" hidden onChange={event => {
                            loadMidi(event.target.files?.[0]);
                            event.target.value = "";
                        }} />
                    </div>
                    <MusicStrip notes={events} duration={track.duration} time={time}
                        loop={loop ? [loopIn, loopOut] : undefined} seek={jump} />
                    <input aria-label="时间" type="range" min="0" max={track.duration} step="0.05" value={time}
                        onChange={event => jump(event.target.valueAsNumber)} />
                    {midi?.sample && <div className="vfx-cues">{secret.sections.map(section =>
                        <button key={section.at} title={section.note} onClick={() => jump(section.at)}>{section.label}</button>)}</div>}
                    {midi || fixture !== "phrase" ? null : <div className="vfx-cues">{fixturePoints.map(([at, label]) =>
                        <button key={label} onClick={() => jump(at)}>{label}</button>)}</div>}
                    {loop && <div className="vfx-loop">
                        <label>循环起点 <input type="number" min="0" max={loopOut - 0.25} step="0.05"
                            value={loopIn} onChange={event => setLoopIn(Math.max(0, Math.min(loopOut - 0.25, event.target.valueAsNumber || 0)))} /></label>
                        <label>终点 <input type="number" min={loopIn + 0.25} max={track.duration} step="0.05" value={loopOut}
                            onChange={event => setLoopOut(Math.min(track.duration, Math.max(loopIn + 0.25, event.target.valueAsNumber || 0)))} /></label>
                    </div>}
                </section>
                <section className="vfx-meter" aria-label="音乐特征和性能">
                    {(["activity", "density", "sustain", "chord", "surge"] as const).map(key =>
                        <div key={key}><span>{featureNames[key]}</span><meter min={0} max={1} value={stats?.features[key] ?? 0} /></div>)}
                    <div className="vfx-perf">{stats ? `${stats.frameMs.toFixed(1)} ms 绘制 CPU · ${stats.draws} 绘制调用 · ${stats.dropped} 批丢弃` : "等待渲染"}</div>
                </section>
            </section>
            <aside className="vfx-inspector">
                {stats?.keyParticle && <section>
                    <div className="vfx-section-title">
                        <h2>弹奏粒子</h2>
                        <span>{stats.keyParticle.overridden ? "舞台替换中" : "钢琴默认"} · {stats.keyParticle.glimmer ? "含微光" : "无微光"}</span>
                    </div>
                    <div className="vfx-channel-item">
                        <span>{stats.keyParticle.label} <small>({stats.keyParticle.style})</small></span>
                        <span className="vfx-swatches">
                            {stats.keyParticle.colors.map((hex, index) => (
                                <i key={index} title={hex} style={{ background: hex }} />
                            ))}
                        </span>
                    </div>
                </section>}
                {midi?.performance ? <section>
                    <h2>{midi.title}</h2>
                    <div>曲目编排 · {midi.performance.length} 条提示 · 预留 {stats?.reserved ?? 0}/{VFX_PARTICLES_PER_PIANO}</div>
                    <div className="vfx-channel-list">
                        {(stats?.activeChannels ?? []).map(channel => (
                            <div className="vfx-channel-item" key={`${channel.effect}:${channel.slot}`}>
                                <span>{channel.label} <small>({channel.effect}:{channel.slot})</small></span>
                                <span>{channel.level}%</span>
                            </div>
                        ))}
                        {!stats?.activeChannels?.length && <div className="vfx-layer-stats">当前时刻暂无活跃持续通道</div>}
                    </div>
                </section> : <>
                    <section>
                        <div className="vfx-mode-tabs">
                            <button type="button" aria-pressed={inspectorMode === "theme"}
                                onClick={() => setInspectorMode("theme")}>主题编排 ({VFX_THEME_ORDER.length})</button>
                            <button type="button" aria-pressed={inspectorMode === "effect"}
                                onClick={() => setInspectorMode("effect")}>单特效 ({effectCount})</button>
                        </div>
                    </section>
                    {inspectorMode === "effect" ? <section>
                        <h2>内置特效（{effectCount} 种）</h2>
                        <div className="vfx-painter-grid">
                            <label>特效
                                <select aria-label="特效" value={singleConfig.effect} onChange={event => {
                                    const effect = event.target.value;
                                    const nextDef = getVfxEffect(effect);
                                    setSingleConfig(prev => ({
                                        ...prev,
                                        effect,
                                        brush: undefined,
                                        variant: nextDef?.variants?.[0],
                                    }));
                                }}>
                                    {VFX_EFFECT_IDS.map(id => (
                                        <option key={id} value={id}>{VFX_EFFECTS[id].label} ({id})</option>
                                    ))}
                                </select>
                            </label>
                            {activeEffectDef?.variants?.length ? (
                                <label>变体
                                    <select aria-label="变体" value={singleConfig.variant ?? ""} onChange={event =>
                                        setSingleConfig(prev => ({ ...prev, variant: event.target.value || undefined }))}>
                                        <option value="">默认</option>
                                        {activeEffectDef.variants.map(item => (
                                            <option key={item} value={item}>{variantLabel(singleConfig.effect, item)}</option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}
                            <div className="vfx-colors">
                                <label>主色 <input aria-label="主色" type="color" value={singleConfig.color}
                                    onChange={event => setSingleConfig(prev => ({ ...prev, color: event.target.value }))} /></label>
                                <label>副色 <input aria-label="副色" type="color" value={singleConfig.color2 ?? singleConfig.color}
                                    onChange={event => setSingleConfig(prev => ({ ...prev, color2: event.target.value }))} /></label>
                            </div>
                            <BrushSelect label="画笔" effectId={singleConfig.effect} value={singleConfig.brush}
                                onChange={brush => setSingleConfig(prev => ({ ...prev, brush }))} />
                            {activeEffectDef?.trigger !== "control" && <>
                                <label>高度区域
                                    <select aria-label="高度区域" value={singleConfig.zone ?? "stage"} onChange={event =>
                                        setSingleConfig(prev => ({ ...prev, zone: event.target.value as PerformanceZone }))}>
                                        {(Object.keys(PERFORMANCE_ZONES) as PerformanceZone[]).map(zone => (
                                            <option key={zone} value={zone}>{zoneNames[zone]}</option>
                                        ))}
                                    </select>
                                </label>
                                <label>运动修饰
                                    <select aria-label="运动修饰" value={singleConfig.motion ?? "normal"} onChange={event =>
                                        setSingleConfig(prev => ({ ...prev, motion: event.target.value as PerformanceMotion }))}>
                                        {(Object.keys(PERFORMANCE_MOTIONS) as PerformanceMotion[]).map(motion => (
                                            <option key={motion} value={motion}>{motionNames[motion]}</option>
                                        ))}
                                    </select>
                                </label>
                            </>}
                            <label>强度 (%)
                                <NumberField label="强度" value={singleConfig.level ?? 85} min={10} max={100}
                                    set={level => setSingleConfig(prev => ({ ...prev, level: Math.round(level) }))} />
                            </label>
                            <label>缩放 (%)
                                <NumberField label="缩放" value={singleConfig.scale ?? 100} min={50} max={170}
                                    set={scale => setSingleConfig(prev => ({ ...prev, scale: Math.round(scale) }))} />
                            </label>
                            {activeEffectDef?.trigger === "instant" && (
                                <button type="button" onClick={() => {
                                    stage.current?.triggerFlash();
                                    if (!playing) void togglePlay();
                                }}>触发一次（{activeEffectDef.label}）</button>
                            )}
                        </div>
                        <div className="vfx-layer-stats">
                            预留 {stats?.reserved ?? 0}/{VFX_PARTICLES_PER_PIANO}
                            {activeEffectDef ? ` · ${triggerNames[activeEffectDef.trigger]} · 默认画笔 ${defaultBrushLabel(singleConfig.effect)}` : ""}
                        </div>
                    </section> : <>
                        <section>
                            <h2>舞台主题</h2>
                            <div className="vfx-presets">
                                {VFX_THEME_ORDER.map(id => (
                                    <button key={id} data-preset={id} aria-pressed={themeId === id} onClick={() => selectTheme(id)}>
                                        <i className={id} />
                                        <span>{themeEnglishNames[id]}<small>{VFX_THEMES[id].label}</small></span>
                                    </button>
                                ))}
                            </div>
                            <div className="vfx-row vfx-actions">
                                <button onClick={() => themeInput.current?.click()}>导入 JSON</button>
                                <button onClick={() => exportThemeJson(theme, themeId)}>导出 JSON</button>
                                <button aria-label="重置主题" title="重置主题" disabled={!isVfxTheme(themeId)}
                                    onClick={() => selectTheme(themeId)}><RotateCcw size={14} /></button>
                                <input type="file" accept=".json" hidden ref={themeInput} onChange={async event => {
                                    const file = event.target.files?.[0];
                                    event.currentTarget.value = "";
                                    if (!file) return;
                                    try { selectTheme("custom", validateVfxTheme(JSON.parse(await file.text()))); setError(""); }
                                    catch (reason) { setError(String(reason)); }
                                }} />
                            </div>
                        </section>
                        <section>
                            <div className="vfx-section-title">
                                <h2>{theme.label ?? "自定义"}图层</h2>
                                <span>预留 {stats?.reserved ?? 0}/{VFX_PARTICLES_PER_PIANO}</span>
                            </div>
                            {theme.layers.map((layer, index) => {
                                const def = getVfxEffect(layer.effect);
                                return <div className="vfx-layer" key={index}>
                                    <div className="vfx-layer-row">
                                        <button title={hidden.has(index) ? "显示图层" : "隐藏图层"} aria-pressed={!hidden.has(index)}
                                            onClick={() => setHidden(previous => {
                                                const next = new Set(previous);
                                                if (next.has(index)) next.delete(index);
                                                else next.add(index);
                                                return next;
                                            })}>{hidden.has(index) ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                                        <button className="vfx-layer-name" aria-expanded={open === index}
                                            onClick={() => setOpen(open === index ? null : index)}>
                                            {def?.label ?? layer.effect}
                                            <small>{layer.effect}</small>
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>
                                    {open === index && <ThemeLayerEditor
                                        layer={layer}
                                        update={item => updateLayer(index, item)}
                                        remove={theme.layers.length > 1 ? () => {
                                            setTheme(previous => ({ ...previous, layers: previous.layers.filter((_, i) => i !== index) }));
                                            setHidden(previous => new Set([...previous].filter(i => i !== index).map(i => i > index ? i - 1 : i)));
                                            setOpen(null);
                                        } : undefined}
                                    />}
                                </div>;
                            })}
                            {theme.layers.length < 8 && <select aria-label="添加图层" value="" onChange={event => {
                                const effect = event.target.value;
                                const nextDef = getVfxEffect(effect);
                                setOpen(theme.layers.length);
                                setTheme(previous => ({
                                    ...previous,
                                    layers: [
                                        ...previous.layers,
                                        {
                                            effect,
                                            color: "#8EC8FF",
                                            level: { input: "activity", from: 40, to: 90 },
                                            ...(nextDef?.variants?.length ? { variant: nextDef.variants[0] } : {}),
                                            ...(nextDef?.trigger === "instant" ? { gate: { input: "chord", threshold: 0.5, cooldown: 32 } } : {}),
                                        },
                                    ],
                                }));
                            }}>
                                <option value="" disabled>添加图层</option>
                                {VFX_EFFECT_IDS.map(id => (
                                    <option key={id} value={id}>{VFX_EFFECTS[id].label} ({id})</option>
                                ))}
                            </select>}
                        </section>
                    </>}
                </>}
                <section className="vfx-scene-controls">
                    <h2>场景</h2>
                    <label>钢琴 <select aria-label="钢琴" value={model} onChange={event => setModel(event.target.value as PianoModel)}>
                        <option value="grand">三角钢琴</option><option value="p88">P-88</option>
                    </select></label>
                    <label>朝向 <select aria-label="朝向" value={direction} onChange={event => setDirection(event.target.value as Direction)}>
                        <option value="south">南</option><option value="west">西</option><option value="north">北</option><option value="east">东</option>
                    </select></label>
                    <label>布景 <select aria-label="布景" value={deck ? "deck" : "floor"} onChange={event => setDeck(event.target.value === "deck")}>
                        <option value="deck">排练台</option><option value="floor">平地</option>
                    </select></label>
                    <label className="vfx-checkbox"><input type="checkbox" checked={showKeyParticles} onChange={event =>
                        setShowKeyParticles(event.target.checked)} /> 显示弹奏粒子</label>
                    <label className="vfx-checkbox"><input type="checkbox" checked={debug} onChange={event =>
                        setDebug(event.target.checked)} /> 网格、发射点与轨迹</label>
                </section>
            </aside>
        </div>
    </main>;
}
