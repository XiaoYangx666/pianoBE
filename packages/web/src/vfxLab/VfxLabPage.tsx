import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, CircleHelp, Eye, EyeOff, FileUp, Maximize2, Pause, Play, Repeat2, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { VFX_COLORS, VFX_EFFECTS, VFX_LIMITS, type NumericParameter, type VfxEffect, type VfxOptions } from "../../../addon/src/domain/piano/vfxLab";
import { VFX_PARTICLES_PER_PIANO } from "../../../addon/src/domain/piano/vfxBudget";
import type { VfxLayout } from "../../../addon/src/domain/piano/vfxLighting";
import { quietFeatures, simulatedVfxNotes, type MusicFeatures } from "../../../addon/src/domain/piano/vfxMusic";
import { validateVfxPreset, VFX_PRESETS, type VfxPreset } from "../../../addon/src/domain/piano/vfxPreset";
import { MidiPlayer, parseMidi, type NoteEvent } from "../midiPlayer";
import { createStage, type Direction, type PreviewStats, type Stage, type Track, type View } from "./stage";
import type { PianoModel } from "./models";
import { MusicStrip } from "./MusicStrip";
import "./vfxLab.css";

const names: Record<string, [string, string]> = {
    galaxy: ["Galaxy", "星河"],
    neon: ["Neon", "霓虹"],
    stage: ["Stage", "舞台"],
};
const effectNames: Record<VfxEffect, string> = {
    field: "星尘", orbit: "环绕星芒", beam: "流光", wave: "波带", ripple: "地面波纹", fountain: "火花", curtain: "光幕",
    shaft: "定向光束",
};
const featureNames: Record<keyof MusicFeatures, string> = {
    density: "密度", velocity: "力度", dynamics: "力度变化", activity: "活动度", pitch: "音高", low: "低音",
    middle: "中音", high: "高音", sustain: "延音", surge: "舞台蓄势", chord: "和弦", onset: "起奏",
};
const layoutNames: Record<VfxLayout, string> = {
    rails: "侧翼灯阵", backline: "后景灯柱", fan: "外展扇形", truss: "门架灯带", aurora: "星云帷幕", wings: "纵深光幕",
    "neon-sides": "霓虹侧翼灯柱", "neon-rear": "霓虹后排灯柱",
};
const parameterNames: Partial<Record<NumericParameter, string>> = {
    x: "横向 X", y: "垂直 Y", z: "纵深 Z", rotation: "旋转", scale: "缩放", range: "范围",
    intensity: "亮度", opacity: "透明度", density: "数量", size: "粒径", speed: "速度", height: "高度",
    heading: "方向", bend: "曲率", lanes: "光轨数", segments: "分段", length: "长度", width: "宽度",
    amplitude: "波幅", period: "周期", wavelength: "波长", phase: "相位",
};
const basicOptions: NumericParameter[] = ["intensity", "scale", "x", "y", "z", "rotation"];
const fixturePoints = [[0, "休止"], [3.75, "弱奏"], [5.5, "长音"], [6.6, "和弦"], [8.7, "高潮"], [11.4, "回落"]] as const;
const fixtureModes = { phrase: "标准乐句", note: "长音", chord: "和弦", dense: "密集音符" } as const;
type Fixture = keyof typeof fixtureModes;
type Layer = VfxPreset["layers"][number];

function makeFixture(mode: Fixture): NoteEvent[] {
    return Array.from({ length: 240 }, (_, tick) => simulatedVfxNotes(tick, tick, mode).map(note => ({
        midi: note.midi, time: tick / 20, duration: note.duration, velocity: note.velocity / 127,
    }))).flat();
}

function toTrack(events: readonly NoteEvent[], duration: number, source: "midi" | "simulation"): Track {
    const notes = new Map<number, NonNullable<ReturnType<Track["notes"]["get"]>>[number][]>();
    for (const note of events) {
        const tick = Math.ceil(note.time * 20 - 1e-7);
        const bucket = notes.get(tick) ?? [];
        bucket.push({ midi: note.midi, duration: note.duration, velocity: Math.round(note.velocity * 127),
            hasVelocity: true, source, tick, songTime: note.time });
        notes.set(tick, bucket);
    }
    return { notes, duration };
}

function saveFile(url: string, name: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
}

function exportPreset(preset: VfxPreset) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" }));
    saveFile(url, "pianobe-vfx-preset.json");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function seconds(time: number) { return time.toFixed(2) + " s"; }

function ParameterInput({ label, value, bounds, disabled, whole, set }: {
    label: string;
    value?: number;
    bounds: readonly [number, number];
    disabled?: boolean;
    whole?: boolean;
    set: (value: number | undefined) => void;
}) {
    const [draft, setDraft] = useState(value?.toString() ?? "");
    const [focused, setFocused] = useState(false);
    const [min, max] = bounds;
    function read(text: string) {
        const parsed = text.trim() ? Number(text) : NaN;
        return Number.isFinite(parsed) ? whole ? Math.round(parsed) : parsed : undefined;
    }
    return <input aria-label={label} type="text" inputMode={whole ? "numeric" : "decimal"} disabled={disabled}
        placeholder={disabled ? "已映射" : "默认"} value={focused ? draft : value ?? ""}
        onFocus={() => { setDraft(value?.toString() ?? ""); setFocused(true); }}
        onChange={event => {
            const text = event.target.value;
            const parsed = read(text);
            setDraft(text);
            if (parsed !== undefined && parsed >= min && parsed <= max) set(parsed);
        }}
        onBlur={() => {
            const parsed = read(draft);
            if (parsed !== undefined) set(Math.min(max, Math.max(min, parsed)));
            else if (!draft.trim()) set(undefined);
            setFocused(false);
        }}
        onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function LayerEditor({ layer, update, remove }: { layer: Layer; update: (next: Layer) => void; remove?: () => void }) {
    const parameters = [...basicOptions, ...VFX_EFFECTS[layer.effect].options];
    const tint = `${layer.effect}Color` as const;
    const layouts = VFX_EFFECTS[layer.effect].layouts;
    const options = layer.options ?? {};
    function setOption(key: keyof VfxOptions, value: string | number | undefined) {
        const next = { ...options };
        if (value === undefined) delete next[key];
        else Object.assign(next, { [key]: value });
        update({ ...layer, options: next });
    }
    return (
        <div className="vfx-editor">
            <div className="vfx-row">
                <label>颜色 <input aria-label="颜色" type="color" value={options[tint] ?? VFX_COLORS[layer.effect]}
                    onChange={event => setOption(tint, event.target.value)} /></label>
                <label>模式 <select value={layer.mode ?? ""} onChange={event =>
                    update({ ...layer, mode: (event.target.value || undefined) as Layer["mode"] })}>
                    <option value="">默认</option><option value="autonomous">自主</option>
                    <option value="continuous">持续</option><option value="trigger">触发</option>
                </select></label>
                {(layer.mode ?? VFX_EFFECTS[layer.effect].mode) === "trigger" &&
                    <label>触发 <select value={layer.gate ?? "onset"} onChange={event =>
                        update({ ...layer, gate: event.target.value as Layer["gate"] })}>
                        <option value="onset">起奏</option><option value="chord">和弦</option>
                    </select></label>}
                {layouts && <label>布局 <select value={layer.layout ?? ""} onChange={event =>
                    update({ ...layer, layout: (event.target.value || undefined) as VfxLayout | undefined })}>
                    <option value="">默认</option>
                    {layouts.map(key => <option key={key} value={key}>{layoutNames[key]}</option>)}
                </select></label>}
                {layer.effect === "beam" && <label>纹理 <select value={layer.profile ?? ""} onChange={event =>
                    update({ ...layer, profile: event.target.value ? "silk" : undefined })}>
                    <option value="">细光</option><option value="silk">丝带</option>
                </select></label>}
            </div>
            <div className="vfx-parameters">
                {parameters.map(parameter => {
                    const mapped = layer.mode !== "autonomous" && layer.map?.some(mapping => mapping.parameter === parameter);
                    return <label key={parameter}>{parameterNames[parameter] ?? parameter}
                        <ParameterInput label={parameterNames[parameter] ?? parameter} bounds={VFX_LIMITS[parameter]}
                            value={options[parameter]} disabled={mapped} whole={parameter === "lanes" || parameter === "segments"}
                            set={value => setOption(parameter, value)} />
                    </label>;
                })}
            </div>
            <div className="vfx-mappings">
                <strong>音乐映射</strong>
                {(layer.map ?? []).map((mapping, index) => {
                    function change(patch: Partial<typeof mapping>) {
                        update({ ...layer, map: layer.map?.map((item, i) => i === index ? { ...item, ...patch } : item) });
                    }
                    return <div key={mapping.parameter} className="vfx-map">
                        <select aria-label="音乐特征" value={mapping.input} onChange={event =>
                            change({ input: event.target.value as keyof MusicFeatures })}>
                            {Object.keys(quietFeatures).map(key =>
                                <option key={key} value={key}>{featureNames[key as keyof MusicFeatures]}</option>)}
                        </select>
                        <span>{parameterNames[mapping.parameter]}</span>
                        {(["from", "to"] as const).map(edge => <ParameterInput key={edge} label={edge === "from" ? "映射起点" : "映射终点"}
                            bounds={VFX_LIMITS[mapping.parameter]} value={mapping[edge]}
                            set={value => { if (value !== undefined) change({ [edge]: value }); }} />)}
                        <button aria-label="移除映射" onClick={() =>
                            update({ ...layer, map: layer.map?.filter((_, i) => i !== index) })}>×</button>
                    </div>;
                })}
                {(layer.map?.length ?? 0) < 6 && <select aria-label="添加音乐映射" value="" onChange={event => {
                    const parameter = event.target.value as NumericParameter;
                    const [min, max] = VFX_LIMITS[parameter];
                    update({ ...layer, map: [...(layer.map ?? []), { input: "activity", parameter, from: min, to: max }] });
                }}>
                    <option value="" disabled>添加参数映射</option>
                    {parameters.filter(parameter => parameter !== "lanes" && parameter !== "segments" &&
                        !layer.map?.some(mapping => mapping.parameter === parameter)).map(parameter =>
                            <option key={parameter} value={parameter}>{parameterNames[parameter] ?? parameter}</option>)}
                </select>}
                {remove && <button onClick={remove}>移除图层</button>}
            </div>
        </div>
    );
}

export default function VfxLabPage() {
    const [presetId, setPresetId] = useState("galaxy");
    const [preset, setPreset] = useState<VfxPreset>(VFX_PRESETS.galaxy);
    const [hidden, setHidden] = useState<Set<number>>(new Set());
    const [open, setOpen] = useState<number | null>(null);
    const [fixture, setFixture] = useState<Fixture>("phrase");
    const [midi, setMidi] = useState<{ title: string; notes: NoteEvent[]; duration: number }>();
    const [model, setModel] = useState<PianoModel>("grand");
    const [direction, setDirection] = useState<Direction>("south");
    const [view, setView] = useState<View>("stage");
    const [deck, setDeck] = useState(true);
    const [debug, setDebug] = useState(false);
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
    const presetInput = useRef<HTMLInputElement>(null);
    const position = useRef(0);
    const audio = useMemo(() => new MidiPlayer(), []);
    const playGeneration = useRef(0);
    const loaded = useRef(false);
    const capture = new URLSearchParams(location.search).has("capture");
    const events = useMemo(() => midi?.notes ?? makeFixture(fixture), [fixture, midi]);
    const track = useMemo(() => toTrack(events, midi?.duration ?? 12, midi ? "midi" : "simulation"), [events, midi]);
    const visiblePreset = useMemo(() => ({ ...preset, layers: preset.layers.filter((_, index) => !hidden.has(index)) }), [preset, hidden]);

    function selectPreset(id: string, value = VFX_PRESETS[id]) {
        setPresetId(id);
        setPreset(value);
        setHidden(new Set());
        setOpen(null);
    }

    function jump(to: number, sync = true) {
        position.current = Math.max(0, Math.min(track.duration, to));
        setTime(position.current);
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
                if (!cancelled) setError("无法启动 WebGL · " + String(reason));
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
        stage.current!.configure(visiblePreset, track, model, direction, position.current);
    }, [ready, visiblePreset, track, model, direction]);

    useEffect(() => { stage.current?.setView(view); }, [ready, view]);
    useEffect(() => { stage.current?.setDeck(deck); }, [ready, deck]);
    useEffect(() => { stage.current?.setDebug(debug); }, [ready, debug]);

    useEffect(() => {
        if (!ready) return;
        const instance = stage.current!;
        let raf = 0;
        let last = performance.now();
        let published = -Infinity;
        let prev = -1;
        function animate(now: number) {
            if (playing) {
                if (muted) position.current += Math.min(0.12, (now - last) / 1000);
                else position.current = audio.getState().currentTime;
                if (position.current >= (loop ? loopOut : track.duration)) {
                    if (loop) jump(loopIn);
                    else { setPlaying(false); audio.pause(); }
                }
            }
            last = now;
            if (!capture || position.current !== prev) {
                instance.advance(position.current);
                instance.render();
            }
            prev = position.current;
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
        const lab = {
            render: (options: { preset: string | VfxPreset; time: number; view?: View; piano?: PianoModel; direction?: Direction; deck?: boolean }) => {
                const instance = stage.current!;
                instance.setView(options.view ?? "stage");
                instance.setDeck(options.deck ?? true);
                const selection = typeof options.preset === "string" ? VFX_PRESETS[options.preset] : validateVfxPreset(options.preset);
                if (!selection) throw new Error("未知预设");
                instance.configure(selection, track, options.piano ?? "grand",
                    options.direction ?? "south", options.time);
                position.current = options.time;
                return instance.stats();
            },
        };
        Object.assign(window, { pianoVfxLab: lab });
        return () => { Reflect.deleteProperty(window, "pianoVfxLab"); };
    }, [capture, ready, track]);

    async function togglePlay() {
        if (playing) {
            jump(muted ? position.current : audio.getState().currentTime);
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

    async function loadMidi(file?: File) {
        if (!file) return;
        try {
            const notes = parseMidi(await file.arrayBuffer()).filter(note => note.midi >= 21 && note.midi <= 108);
            if (!notes.length) throw new Error("MIDI 中没有钢琴音域内的音符");
            const duration = Math.ceil(20 * notes.reduce((end, note) => Math.max(end, note.time + note.duration), 0)) / 20 + 2.5;
            resetAudio();
            jump(0, false);
            setLoopIn(0);
            setLoopOut(duration);
            setMidi({ title: file.name, notes, duration });
            setError("");
        } catch (reason) { setError("读取 MIDI 失败 · " + String(reason)); }
    }

    function updateLayer(index: number, layer: Layer) {
        setPreset(previous => ({ ...previous, layers: previous.layers.map((item, i) => i === index ? layer : item) }));
    }

    if (capture) return <main className="vfx-capture"><canvas ref={canvas} />{error && <p>{error}</p>}</main>;
    return <main className="vfx-lab">
        <header className="vfx-header">
            <div className="vfx-header-title"><a href="/">PianoBE</a><span>/</span><h1>VFX Lab</h1></div>
            <details className="vfx-help">
                <summary><CircleHelp size={17} /> 渲染说明</summary>
                <div>预览读取实际 Bedrock 粒子 JSON 与纹理，复用游戏内音乐分析、锚点和发射预算。
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
                            saveFile(canvas.current!.toDataURL(), `pianobe-${presetId}-${time.toFixed(2)}.png`)}><Camera size={17} /></button>
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
                        <select aria-label="音乐片段" value={midi ? "midi" : fixture} onChange={event => {
                            resetAudio(); jump(0, false); setLoopIn(0); setLoopOut(12); setMidi(undefined);
                            setFixture(event.target.value as Fixture);
                        }}>
                            {Object.entries(fixtureModes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                            {midi && <option value="midi">{midi.title}</option>}
                        </select>
                        <button className="vfx-load" onClick={() => midiInput.current?.click()}><FileUp size={15} /> 打开 MIDI</button>
                        <input ref={midiInput} type="file" accept=".mid,.midi" hidden onChange={event => {
                            void loadMidi(event.target.files?.[0]);
                            event.target.value = "";
                        }} />
                    </div>
                    <MusicStrip notes={events} duration={track.duration} time={time}
                        loop={loop ? [loopIn, loopOut] : undefined} seek={jump} />
                    <input aria-label="时间" type="range" min="0" max={track.duration} step="0.05" value={time}
                        onChange={event => jump(event.target.valueAsNumber)} />
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
                <section>
                    <h2>预设</h2>
                    <div className="vfx-presets">
                        {Object.entries(names).map(([key, [name, label]]) => <button key={key} data-preset={key}
                            aria-pressed={presetId === key} onClick={() => selectPreset(key)}>
                            <i className={key} /><span>{name}<small>{label}</small></span>
                        </button>)}
                    </div>
                    <div className="vfx-row vfx-actions">
                        <button onClick={() => presetInput.current?.click()}>导入</button>
                        <button onClick={() => exportPreset(preset)}>导出 JSON</button>
                        <button aria-label="重置预设" title="重置预设" disabled={!VFX_PRESETS[presetId]}
                            onClick={() => selectPreset(presetId)}><RotateCcw size={14} /></button>
                        <input type="file" accept=".json" hidden ref={presetInput} onChange={async event => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (!file) return;
                            try { selectPreset("custom", validateVfxPreset(JSON.parse(await file.text()))); setError(""); }
                            catch (reason) { setError(String(reason)); }
                        }} />
                    </div>
                </section>
                <section>
                    <div className="vfx-section-title"><h2>图层</h2><span>预留 {stats?.reserved ?? 0}/{VFX_PARTICLES_PER_PIANO}</span></div>
                    {preset.layers.map((layer, index) => {
                        const fx = stats?.effects[layer.effect];
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
                                    {layer.layout ? layoutNames[layer.layout] : effectNames[layer.effect]}
                                    <small>{layer.effect}</small><ChevronDown size={14} /></button>
                            </div>
                            {open === index && <><div className="vfx-layer-stats">
                                按效果汇总 · {fx?.particles ?? 0} 粒子 · {fx?.reserved ?? 0} 预留 · {fx?.rate ?? 0} 发射 / 秒
                            </div><LayerEditor layer={layer} update={item => updateLayer(index, item)}
                                remove={preset.layers.length > 1 ? () => {
                                    setPreset(previous => ({ ...previous, layers: previous.layers.filter((_, i) => i !== index) }));
                                    setHidden(previous => new Set([...previous].filter(i => i !== index).map(i => i > index ? i - 1 : i)));
                                    setOpen(null);
                                } : undefined} /></>}
                        </div>;
                    })}
                    {preset.layers.length < 6 && <select aria-label="添加图层" value="" onChange={event => {
                        const effect = event.target.value as VfxEffect;
                        setOpen(preset.layers.length);
                        setPreset(previous => ({ ...previous, layers: [...previous.layers, { effect }] }));
                    }}>
                        <option value="" disabled>添加图层</option>
                        {Object.entries(effectNames).map(([effect, name]) => <option key={effect} value={effect}>{name}</option>)}
                    </select>}
                </section>
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
                    <label className="vfx-checkbox"><input type="checkbox" checked={debug} onChange={event =>
                        setDebug(event.target.checked)} /> 网格、发射点与轨迹</label>
                </section>
            </aside>
        </div>
    </main>;
}
