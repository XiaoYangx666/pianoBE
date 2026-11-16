import { useEffect, useMemo, useRef, useState } from "react";
import { Button, FileDropzone, PageHeader, Segmented, Tag, notify } from "@piano/ui";
import { Download, FlaskConical, Pause, Play, Square, Upload, Wand2 } from "lucide-react";
import type { LabNote, ReleaseMode, ScheduleMode, VelocityMode } from "@piano/core/audioLab";
import { api, type MidiSongMeta } from "../api";
import { parseMidi } from "../midiPlayer";
import {
    defaultConfig,
    type LabConfig,
    type LabSampleSet,
} from "./labAssets";
import { DEMO_LABELS, makeDemo, noteName, sliceNotes, trackStats, type DemoTrack } from "./labData";
import { LabAudioEngine, downloadBlob, encodeWav } from "./labEngine";
import { LabMetrics } from "./LabMetrics";
import { LabTimeline } from "./LabTimeline";

type Slot = "A" | "B";

const ACCENT: Record<Slot, string> = { A: "#4f8cff", B: "#e08a2e" };

const PRESETS: { id: string; label: string; apply: () => { A: LabConfig; B: LabConfig } }[] = [
    {
        id: "velocity",
        label: "力度：单层 vs 3 层",
        apply: () => {
            const base = defaultConfig();
            return {
                A: { ...base, velocityMode: "single", scheduleMode: "exact", releaseMode: "noteoff" },
                B: { ...base, velocityMode: "layers3", scheduleMode: "exact", releaseMode: "noteoff" },
            };
        },
    },
    {
        id: "schedule",
        label: "调度：50ms tick vs 精确",
        apply: () => {
            const base = defaultConfig();
            return {
                A: { ...base, scheduleMode: "tick-ceil" },
                B: { ...base, scheduleMode: "exact" },
            };
        },
    },
    {
        id: "quantize",
        label: "量化：向上取整 vs 最近 tick",
        apply: () => {
            const base = defaultConfig();
            return {
                A: { ...base, scheduleMode: "tick-ceil" },
                B: { ...base, scheduleMode: "tick-round" },
            };
        },
    },
    {
        id: "lead",
        label: "量化：最近 tick vs 提前 1 tick",
        apply: () => {
            const base = defaultConfig();
            return {
                A: { ...base, scheduleMode: "tick-round" },
                B: { ...base, scheduleMode: "tick-round-lead" },
            };
        },
    },
    {
        id: "release",
        label: "释放：三档采样 vs Note Off",
        apply: () => {
            const base = defaultConfig();
            const A: LabConfig = {
                ...base,
                sampleSet: "fluidr3",
                velocityMode: "single",
                scheduleMode: "exact",
                releaseMode: "tier",
            };
            return { A, B: { ...A, releaseMode: "noteoff" } };
        },
    },
    {
        id: "current",
        label: "游戏现状 vs 综合改进",
        apply: () => {
            const base = defaultConfig();
            const A: LabConfig = {
                ...base,
                sampleSet: "fluidr3",
                velocityMode: "single",
                scheduleMode: "tick-ceil",
                releaseMode: "tier",
                velocityExponent: 1.0,
            };
            return {
                A,
                B: {
                    ...base,
                    velocityMode: "layers3",
                    scheduleMode: "exact",
                    releaseMode: "noteoff",
                },
            };
        },
    },
];

export function AudioLabPage() {
    const engine = useMemo(() => new LabAudioEngine(), []);
    const [playState, setPlayState] = useState(engine.getState());
    const [playingSlot, setPlayingSlot] = useState<Slot | null>(null);
    const [exporting, setExporting] = useState(false);
    const seq = useRef(0);

    const [demo, setDemo] = useState<DemoTrack>("fast");
    const [allNotes, setAllNotes] = useState<LabNote[]>(() => makeDemo("fast"));
    const [songName, setSongName] = useState(DEMO_LABELS.fast);
    const [sourceKind, setSourceKind] = useState<"demo" | "library" | "file">("demo");
    const [library, setLibrary] = useState<MidiSongMeta[]>([]);
    const [libraryId, setLibraryId] = useState("");
    const [libraryError, setLibraryError] = useState("");
    const [segmentStart, setSegmentStart] = useState(0);
    const [segmentLength, setSegmentLength] = useState(16);
    const fileRef = useRef<HTMLInputElement>(null);

    const [slots, setSlots] = useState<{ A: LabConfig; B: LabConfig }>(() => {
        const A = defaultConfig();
        return {
            A: { ...A, scheduleMode: "tick-ceil" },
            B: { ...A, velocityMode: "layers3", scheduleMode: "exact" },
        };
    });
    const [editing, setEditing] = useState<Slot>("A");
    const [trims, setTrims] = useState<Record<Slot, number>>({ A: 0, B: 0 });
    const [matching, setMatching] = useState(false);

    useEffect(() => engine.subscribe(setPlayState), [engine]);
    useEffect(() => () => engine.dispose(), [engine]);

    useEffect(() => {
        api.listSongs("", 1)
            .then((response) => setLibrary(response.items))
            .catch((error) => setLibraryError((error as Error).message));
    }, []);

    const totalDuration = useMemo(() => trackStats(allNotes).duration, [allNotes]);
    const notes = useMemo(
        () => sliceNotes(allNotes, segmentStart, segmentLength),
        [allNotes, segmentStart, segmentLength]
    );
    const stats = useMemo(() => trackStats(notes), [notes]);

    const loadDemo = (track: DemoTrack) => {
        const next = makeDemo(track);
        const duration = trackStats(next).duration;
        setSourceKind("demo");
        setDemo(track);
        setAllNotes(next);
        setSongName(DEMO_LABELS[track]);
        setSegmentStart(0);
        setSegmentLength(Math.min(20, Math.max(1, duration)));
        stop();
    };

    const loadLibrary = async (id: string) => {
        setLibraryId(id);
        if (!id) return;
        try {
            const buffer = await api.getSongRaw(id);
            const next = parseMidi(buffer);
            const meta = library.find((song) => song.id === id);
            const duration = trackStats(next).duration;
            setSourceKind("library");
            setAllNotes(next);
            setSongName(meta?.name ?? "服务端曲目");
            setSegmentStart(0);
            setSegmentLength(Math.min(30, Math.max(1, duration)));
            stop();
        } catch (error) {
            notify({ title: "读取曲目失败", message: (error as Error).message, color: "red" });
        }
    };

    const loadFile = async (files: File[]) => {
        const file = files[0];
        if (!file) return;
        try {
            const next = parseMidi(await file.arrayBuffer());
            const duration = trackStats(next).duration;
            setSourceKind("file");
            setAllNotes(next);
            setSongName(file.name.replace(/\.midi?$/i, ""));
            setSegmentStart(0);
            setSegmentLength(Math.min(30, Math.max(1, duration)));
            setLibraryId("");
            stop();
        } catch (error) {
            notify({ title: "解析 MIDI 失败", message: (error as Error).message, color: "red" });
        }
    };

    const stop = () => {
        seq.current++;
        engine.stop();
        setPlayingSlot(null);
    };

    const startSlot = async (slot: Slot, id: number, onEnded?: () => void) => {
        if (!notes.length) {
            notify({ title: "片段内没有音符", message: "调整起始时间或换一段曲目", color: "yellow" });
            return;
        }
        setPlayingSlot(slot);
        try {
            await engine.play(notes, slots[slot], {
                label: slot,
                gainDb: trims[slot],
                onEnded: () => {
                    if (id !== seq.current) return;
                    setPlayingSlot(null);
                    onEnded?.();
                },
            });
        } catch (error) {
            if (id === seq.current) setPlayingSlot(null);
            notify({ title: "播放失败", message: (error as Error).message, color: "red" });
        }
    };

    const playSlot = (slot: Slot) => {
        const id = ++seq.current;
        void startSlot(slot, id);
    };

    const playAB = () => {
        const id = ++seq.current;
        void startSlot("A", id, () => {
            window.setTimeout(() => {
                if (id === seq.current) void startSlot("B", id);
            }, 700);
        });
    };

    const togglePause = () => {
        if (playState.status === "playing") engine.pause();
        else if (playState.status === "paused") engine.resume();
    };

    const applyPreset = (preset: (typeof PRESETS)[number]) => {
        const next = preset.apply();
        setSlots(next);
        setEditing("A");
        stop();
    };

    const updateConfig = (slot: Slot, patch: Partial<LabConfig>) => {
        setSlots((current) => ({ ...current, [slot]: { ...current[slot], ...patch } }));
        if (slot === playingSlot) stop();
    };

    const exportAB = async () => {
        if (!notes.length) return;
        const duration = Math.min(segmentLength, 90);
        setExporting(true);
        try {
            const a = await engine.renderOffline(notes, slots.A, duration, 0, trims.A);
            downloadBlob(encodeWav(a), `${safeName(songName)}-A-${slots.A.scheduleMode}.wav`);
            const b = await engine.renderOffline(notes, slots.B, duration, 0, trims.B);
            downloadBlob(encodeWav(b), `${safeName(songName)}-B-${slots.B.scheduleMode}.wav`);
            notify({ title: "已导出 A/B", message: `片段 ${duration.toFixed(1)}s，WAV 已开始下载`, color: "teal" });
        } catch (error) {
            notify({ title: "导出失败", message: (error as Error).message, color: "red" });
        } finally {
            setExporting(false);
        }
    };

    const matchLoudness = async () => {
        if (!notes.length) return;
        setMatching(true);
        try {
            const duration = Math.min(segmentLength, 10);
            const a = await engine.renderOffline(notes, slots.A, duration, 0, 0);
            const b = await engine.renderOffline(notes, slots.B, duration, 0, 0);
            const level = (buffer: AudioBuffer) => {
                let sum = 0;
                let count = 0;
                for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                    const data = buffer.getChannelData(channel);
                    for (let i = 0; i < data.length; i++) {
                        sum += data[i] * data[i];
                        count++;
                    }
                }
                return 20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / Math.max(1, count))));
            };
            const diff = level(a) - level(b);
            const trim = Math.max(-12, Math.min(12, diff));
            setTrims({ A: 0, B: Number(trim.toFixed(1)) });
            notify({
                title: "已匹配 A/B 响度",
                message: `B 输出增益 ${trim >= 0 ? "+" : ""}${trim.toFixed(1)} dB（基于 ${duration.toFixed(0)}s 片段）`,
                color: "teal",
            });
        } catch (error) {
            notify({ title: "响度匹配失败", message: (error as Error).message, color: "red" });
        } finally {
            setMatching(false);
        }
    };

    const playingTime = playingSlot ? playState.currentTime : 0;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Audio Lab"
                title="钢琴还原度实验"
                description="在浏览器里隔离对比力度层、50ms tick 量化与 Note Off 释放。正式播放器、游戏包和音色资源都不受影响。"
                actions={
                    <>
                        <Button type="button" size="sm" color="secondary" onClick={() => fileRef.current?.click()}>
                            <Upload size={14} /> 本地 MIDI
                        </Button>
                        <Button type="button" size="sm" color="secondary" loading={exporting} onClick={() => void exportAB()}>
                            <Download size={14} /> 导出 A/B
                        </Button>
                    </>
                }
            />

            <input
                ref={fileRef}
                type="file"
                accept=".mid,.midi"
                hidden
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length) void loadFile(files);
                }}
            />

            <section className="rounded-lg border border-ore-divider bg-ore-raised/40 p-3">
                <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-[11px] text-ore-dim">
                        曲目来源
                        <select
                            className="h-8 rounded-md border border-ore-border bg-ore-raised px-2 text-[12px] text-ore-text"
                            value={sourceKind === "demo" ? `demo:${demo}` : sourceKind === "library" ? `lib:${libraryId}` : "file"}
                            onChange={(event) => {
                                const value = event.target.value;
                                if (value.startsWith("demo:")) loadDemo(value.slice(5) as DemoTrack);
                                else if (value.startsWith("lib:")) void loadLibrary(value.slice(4));
                            }}
                        >
                            <option value="file" disabled>
                                本地文件：{sourceKind === "file" ? songName : "未加载"}
                            </option>
                            {Object.entries(DEMO_LABELS).map(([id, label]) => (
                                <option key={id} value={`demo:${id}`}>
                                    内置 · {label}
                                </option>
                            ))}
                            {library.map((song) => (
                                <option key={song.id} value={`lib:${song.id}`}>
                                    曲库 · {song.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1 text-[11px] text-ore-dim">
                        片段起点（秒）
                        <input
                            type="number"
                            min={0}
                            max={Math.max(0, totalDuration)}
                            step={0.5}
                            value={segmentStart}
                            onChange={(event) => setSegmentStart(Math.max(0, Number(event.target.value) || 0))}
                            className="h-8 w-24 rounded-md border border-ore-border bg-ore-raised px-2 text-[12px] tabular-nums"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-ore-dim">
                        片段长度（秒）
                        <input
                            type="number"
                            min={1}
                            max={120}
                            step={1}
                            value={segmentLength}
                            onChange={(event) => setSegmentLength(Math.max(1, Number(event.target.value) || 1))}
                            className="h-8 w-24 rounded-md border border-ore-border bg-ore-raised px-2 text-[12px] tabular-nums"
                        />
                    </label>

                    <div className="flex-1" />
                    <div className="flex items-center gap-1.5">
                        <Button type="button" size="sm" onClick={() => playSlot("A")} disabled={!notes.length}>
                            <Play size={13} /> 播放 A
                        </Button>
                        <Button type="button" size="sm" onClick={() => playSlot("B")} disabled={!notes.length}>
                            <Play size={13} /> 播放 B
                        </Button>
                        <Button type="button" size="sm" color="secondary" onClick={playAB} disabled={!notes.length}>
                            A → B 连播
                        </Button>
                        <Button type="button" size="sm" color="secondary" onClick={togglePause} disabled={playState.status !== "playing" && playState.status !== "paused"}>
                            <Pause size={13} /> {playState.status === "paused" ? "继续" : "暂停"}
                        </Button>
                        <Button type="button" size="sm" color="ghost" onClick={stop}>
                            <Square size={13} /> 停止
                        </Button>
                    </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ore-dim">
                    <span>
                        当前：<span className="text-ore-text">{songName}</span>
                    </span>
                    <span className="tabular-nums">
                        {stats.count} 音符 · {stats.nps.toFixed(1)} n/s · 音域 {noteName(stats.min)}–{noteName(stats.max)}
                    </span>
                    <span className="tabular-nums">
                        片段 {segmentStart.toFixed(1)}–{(segmentStart + segmentLength).toFixed(1)}s / 全曲 {totalDuration.toFixed(1)}s
                    </span>
                    {sourceKind === "file" && <Tag tone="brand">本地文件，仅浏览器内</Tag>}
                    {libraryError && <Tag tone="default">曲库不可用：{libraryError}</Tag>}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {PRESETS.map((preset) => (
                        <Button key={preset.id} type="button" size="sm" color="ghost" onClick={() => applyPreset(preset)}>
                            <FlaskConical size={12} /> {preset.label}
                        </Button>
                    ))}
                </div>

                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-ore-divider pt-2">
                    <label className="flex flex-col gap-1 text-[11px] text-ore-dim">
                        A 输出增益（dB）
                        <input
                            type="number"
                            min={-12}
                            max={12}
                            step={0.5}
                            value={trims.A}
                            onChange={(event) => setTrims((current) => ({ ...current, A: Number(event.target.value) || 0 }))}
                            className="h-8 w-20 rounded-md border border-ore-border bg-ore-raised px-2 text-[12px] tabular-nums"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-ore-dim">
                        B 输出增益（dB）
                        <input
                            type="number"
                            min={-12}
                            max={12}
                            step={0.5}
                            value={trims.B}
                            onChange={(event) => setTrims((current) => ({ ...current, B: Number(event.target.value) || 0 }))}
                            className="h-8 w-20 rounded-md border border-ore-border bg-ore-raised px-2 text-[12px] tabular-nums"
                        />
                    </label>
                    <Button type="button" size="sm" color="secondary" loading={matching} onClick={() => void matchLoudness()}>
                        <Wand2 size={13} /> 匹配 A/B 响度
                    </Button>
                    <span className="pb-2 text-[10.5px] text-ore-dimmer">只影响试听/导出，不改变指标</span>
                </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
                {(["A", "B"] as Slot[]).map((slot) => (
                    <ConfigCard
                        key={slot}
                        slot={slot}
                        config={slots[slot]}
                        accent={ACCENT[slot]}
                        active={editing === slot}
                        onFocus={() => setEditing(slot)}
                        onChange={(patch) => updateConfig(slot, patch)}
                    />
                ))}
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
                {(["A", "B"] as Slot[]).map((slot) => (
                    <div key={slot} className="flex flex-col gap-2">
                        <LabTimeline
                            notes={notes}
                            config={slots[slot]}
                            playhead={playingSlot === slot ? playingTime : 0}
                            duration={Math.max(0.1, Math.min(segmentLength, stats.duration || segmentLength))}
                            label={`${slot} · ${slots[slot].scheduleMode} · ${slots[slot].velocityMode}`}
                            accent={ACCENT[slot]}
                        />
                        <LabMetrics
                            notes={notes}
                            config={slots[slot]}
                            title={`${slot} 方案指标`}
                            accent={ACCENT[slot]}
                        />
                    </div>
                ))}
            </section>

            <section className="rounded-lg border border-ore-divider bg-ore-raised/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[12px]">
                        <span className={`inline-block h-2 w-2 rounded-full ${playState.status === "playing" ? "animate-pulse" : ""}`} style={{ background: playState.status === "playing" ? "#38a169" : "#888" }} />
                        <span className="font-medium">
                            {playState.status === "loading"
                                ? "加载采样…"
                                : playState.status === "playing"
                                  ? `播放中 ${playingSlot ?? ""}`
                                  : playState.status === "paused"
                                    ? "已暂停"
                                    : playState.status === "ended"
                                      ? "播放结束"
                                      : "空闲"}
                        </span>
                        <span className="tabular-nums text-ore-dim">
                            {playState.currentTime.toFixed(2)} / {playState.duration.toFixed(1)}s
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] tabular-nums text-ore-dim">
                        <span>声部 {playState.voices}</span>
                        <span>RMS {playState.rmsDb.toFixed(1)} dB</span>
                        <span>峰值 {playState.peakDb.toFixed(1)} dB</span>
                    </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--pb-soft)]">
                    <div
                        className="h-full rounded-full bg-brand transition-[width] duration-100"
                        style={{ width: `${Math.min(100, (playState.currentTime / Math.max(0.1, playState.duration)) * 100)}%` }}
                    />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ore-dimmer">
                    <span>力度：{slots[editing].velocityMode} · 曲线指数 {slots[editing].velocityExponent.toFixed(1)} · 层间保留 {Math.round(slots[editing].layerDynamics * 100)}%</span>
                    <span>调度：tick {Math.round(slots[editing].tickSeconds * 1000)}ms</span>
                    <span>释放：{slots[editing].releaseMode} · {Math.round(slots[editing].releaseSeconds * 1000)}ms</span>
                    <span>导出上限 90s，导出使用与试听相同的采样与包络。</span>
                </div>
            </section>

            <section className="rounded-lg border border-ore-divider bg-ore-raised/40 p-3 text-[11.5px] leading-relaxed text-ore-dim">
                <div className="mb-1 font-medium text-ore-text">实验提示</div>
                <ul className="list-disc space-y-1 pl-4">
                    <li>力度实验保持“曲目 / 片段 / 调度 / 释放”不变，只切换单层与多层；多层使用 VCSL vl2/vl3/vl4，层间默认响度完全对齐，因此差异来自音头与泛音，而不是音量。</li>
                    <li>调度实验只改起始时间网格：浅色竖线是 MIDI 原始位置，实色圆点是当前方案实际触发点。</li>
                    <li>释放实验建议用 FluidR3 三档采样做 A，Note Off 做 B；VCSL 只有 4s 长采样，tier 模式等同于自然衰减。</li>
                    <li>对比时先听 A/B 连播，再看指标；不要只追求更小的统计误差，优先判断节奏是否自然、旋律是否清晰。</li>
                </ul>
            </section>
        </div>
    );
}

function ConfigCard({
    slot,
    config,
    accent,
    active,
    onFocus,
    onChange,
}: {
    slot: Slot;
    config: LabConfig;
    accent: string;
    active: boolean;
    onFocus: () => void;
    onChange: (patch: Partial<LabConfig>) => void;
}) {
    const setSampleSet = (sampleSet: LabSampleSet) => {
        if (sampleSet === "fluidr3") {
            onChange({ sampleSet, velocityMode: "single" });
        } else {
            onChange({ sampleSet, velocityMode: config.velocityMode === "single" ? "layers3" : config.velocityMode });
        }
    };

    return (
        <section
            className={`rounded-lg border p-3 transition-colors ${active ? "border-brand/50 bg-ore-raised/60" : "border-ore-divider bg-ore-raised/30"}`}
            onFocus={onFocus}
            onMouseDown={onFocus}
        >
            <div className="mb-2 flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
                <span className="text-[13px] font-semibold">方案 {slot}</span>
                <Tag tone={slot === "A" ? "brand" : "default"}>{slot === "A" ? "基准" : "对照"}</Tag>
                <div className="flex-1" />
                <span className="text-[10.5px] text-ore-dimmer">点击卡片后编辑</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                <Field label="音源">
                    <Segmented
                        ariaLabel={`方案 ${slot} 音源`}
                        value={config.sampleSet}
                        options={[
                            { value: "fluidr3", label: "FluidR3" },
                            { value: "vcsl", label: "VCSL 多层" },
                        ]}
                        onChange={(value) => setSampleSet(value as LabSampleSet)}
                        className="w-full"
                    />
                </Field>
                <Field label="力度">
                    <Segmented
                        ariaLabel={`方案 ${slot} 力度`}
                        value={config.sampleSet === "fluidr3" ? "single" : config.velocityMode}
                        options={[
                            { value: "single", label: "单层" },
                            { value: "layers2", label: "2 层" },
                            { value: "layers3", label: "3 层" },
                        ]}
                        onChange={(value) => {
                            const mode = value as VelocityMode;
                            onChange({ velocityMode: mode, sampleSet: mode === "single" ? config.sampleSet : "vcsl" });
                        }}
                        className="w-full"
                    />
                </Field>
                <Field label="调度">
                    <select
                        className="h-8 w-full rounded-md border border-ore-border bg-ore-raised px-2 text-[12px]"
                        value={config.scheduleMode}
                        onChange={(event) => onChange({ scheduleMode: event.target.value as ScheduleMode })}
                    >
                        <option value="exact">原始精确时间</option>
                        <option value="tick-ceil">50ms 向上取整（现状）</option>
                        <option value="tick-round">最近 tick</option>
                        <option value="tick-round-lead">最近 tick + 提前 1 tick</option>
                        <option value="tick-ceil-lead">向上取整 + 提前 1 tick</option>
                    </select>
                </Field>
                <Field label="Tick 网格">
                    <select
                        className="h-8 w-full rounded-md border border-ore-border bg-ore-raised px-2 text-[12px]"
                        value={String(config.tickSeconds)}
                        onChange={(event) => onChange({ tickSeconds: Number(event.target.value) })}
                    >
                        <option value="0.05">50ms（20 TPS）</option>
                        <option value="0.025">25ms（40 TPS，假设）</option>
                        <option value="0.1">100ms（10 TPS）</option>
                    </select>
                </Field>
                <Field label="释放">
                    <select
                        className="h-8 w-full rounded-md border border-ore-border bg-ore-raised px-2 text-[12px]"
                        value={config.releaseMode}
                        onChange={(event) => onChange({ releaseMode: event.target.value as ReleaseMode })}
                    >
                        <option value="tier">三档采样（现状）</option>
                        <option value="noteoff">Note Off + 短释放</option>
                        <option value="noteoff-long">Note Off + 长释放</option>
                        <option value="natural">忽略 Note Off</option>
                    </select>
                </Field>
                <Field label={`释放时长 ${Math.round(config.releaseSeconds * 1000)}ms`}>
                    <input
                        type="range"
                        min={0.02}
                        max={0.6}
                        step={0.01}
                        value={config.releaseSeconds}
                        onChange={(event) => onChange({ releaseSeconds: Number(event.target.value) })}
                        className="w-full accent-[color:var(--pb-primary-light)]"
                    />
                </Field>
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label={`力度曲线指数 ${config.velocityExponent.toFixed(1)}`}>
                    <input
                        type="range"
                        min={1}
                        max={2.2}
                        step={0.1}
                        value={config.velocityExponent}
                        onChange={(event) => onChange({ velocityExponent: Number(event.target.value) })}
                        className="w-full accent-[color:var(--pb-primary-light)]"
                    />
                </Field>
                <Field label={`层间原始电平保留 ${Math.round(config.layerDynamics * 100)}%`}>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={config.layerDynamics}
                        disabled={config.sampleSet === "fluidr3"}
                        onChange={(event) => onChange({ layerDynamics: Number(event.target.value) })}
                        className="w-full accent-[color:var(--pb-primary-light)] disabled:opacity-40"
                    />
                </Field>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-ore-dimmer">
                <span>
                    音源：{config.sampleSet === "vcsl" ? "VCSL Steinway B · vl2/vl3/vl4" : "FluidR3 GM · 0.5/2/4s 三档"}
                </span>
                <span className="tabular-nums">分界：{config.velocityMode === "layers2" ? "64" : "42 / 84"}（MIDI 力度）</span>
                {config.sampleSet === "vcsl" && config.releaseMode === "tier" && (
                    <Tag tone="default">VCSL 无三档，tier ≈ 自然衰减</Tag>
                )}
                {config.layerDynamics > 0 && config.sampleSet === "vcsl" && (
                    <Tag tone="default">保留层间电平差，切换处可能有响度台阶</Tag>
                )}
            </div>
        </section>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1 text-[11px] text-ore-dim">
            <span>{label}</span>
            {children}
        </label>
    );
}

function safeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "audio-lab";
}
