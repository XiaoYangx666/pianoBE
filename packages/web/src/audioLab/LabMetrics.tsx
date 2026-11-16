import { useMemo } from "react";
import {
    durationBuckets,
    noteEnd,
    scheduleMetrics,
    scheduleNotes,
    velocityBuckets,
    velocityHistogram,
    voiceStats,
    type LabNote,
} from "@piano/core/audioLab";
import type { LabConfig } from "./labAssets";
import { trackStats } from "./labData";

interface Props {
    notes: readonly LabNote[];
    config: LabConfig;
    title: string;
    accent: string;
}

function pct(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
}

function ms(value: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)} ms`;
}

export function LabMetrics({ notes, config, title, accent }: Props) {
    const model = useMemo(() => {
        const scheduled = scheduleNotes(notes, {
            mode: config.scheduleMode,
            tickSeconds: config.tickSeconds,
            velocityMode: config.sampleSet === "fluidr3" ? "single" : config.velocityMode,
            velocityExponent: config.velocityExponent,
        });
        const schedule = scheduleMetrics(scheduled);
        const releaseMode =
            config.sampleSet === "vcsl" && config.releaseMode === "tier" ? "natural" : config.releaseMode;
        const voices = voiceStats(
            scheduled,
            {
                releaseMode,
                releaseSeconds: config.releaseSeconds,
                sampleSeconds: 4,
            },
            0.02
        );
        const buckets = velocityBuckets(
            notes,
            config.sampleSet === "fluidr3" ? "single" : config.velocityMode
        );
        const histogram = velocityHistogram(notes, 8);
        const durations = durationBuckets(notes);
        const stats = trackStats(notes);
        const maxHistogram = Math.max(1, ...histogram.map((bin) => bin.count));
        const tailEnd = Math.max(0, ...scheduled.map((note) => noteEnd(note, {
            releaseMode: config.sampleSet === "vcsl" && config.releaseMode === "tier" ? "natural" : config.releaseMode,
            releaseSeconds: config.releaseSeconds,
            sampleSeconds: 4,
        })));
        return { schedule, voices, buckets, histogram, durations, stats, maxHistogram, tailEnd };
    }, [notes, config]);

    const grid = [
        ["音符数 / 密度", `${model.stats.count} 个 · ${model.stats.nps.toFixed(1)} n/s`],
        ["音域 / 片段", `${model.stats.min}–${model.stats.max} · ${model.stats.duration.toFixed(1)}s`],
        ["触发误差 均值", ms(model.schedule.meanMs)],
        ["触发误差 P90", `${model.schedule.p90AbsMs.toFixed(1)} ms`],
        ["触发误差 最大", `${model.schedule.maxAbsMs.toFixed(1)} ms`],
        ["±20ms 内", pct(model.schedule.within20)],
        ["相邻间隔改变 >20ms", pct(model.schedule.intervalShiftRatio)],
        ["同时刻压缩 / 和弦跨度", `${model.schedule.collisions} 次 · ${model.schedule.maxChordSpreadMs.toFixed(0)} ms`],
        ["最大 / 平均声部", `${model.voices.maxVoices} / ${model.voices.meanVoices.toFixed(2)}`],
        ["尾音 / 时值比", `${model.voices.tailRatio.toFixed(2)}×`],
        ["估算结束时间", `${model.tailEnd.toFixed(1)}s`],
    ];

    return (
        <section className="rounded-lg border border-ore-divider bg-ore-raised/40 p-3">
            <div className="mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent }} />
                <span className="text-[12.5px] font-semibold">{title}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
                {grid.map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-2 border-b border-ore-divider/60 pb-1">
                        <span className="text-ore-dim">{label}</span>
                        <span className="tabular-nums">{value}</span>
                    </div>
                ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                    <div className="mb-1 text-[10.5px] uppercase tracking-[0.1em] text-ore-dimmer">力度分布</div>
                    <div className="flex h-16 items-end gap-1">
                        {model.histogram.map((bin) => (
                            <div key={bin.from} className="flex flex-1 flex-col items-center gap-1" title={`${bin.from}–${bin.to}: ${bin.count}`}>
                                <div
                                    className="w-full rounded-sm"
                                    style={{
                                        height: `${Math.max(2, (bin.count / model.maxHistogram) * 48)}px`,
                                        background: accent,
                                        opacity: 0.65,
                                    }}
                                />
                                <span className="text-[9px] tabular-nums text-ore-dimmer">{bin.from}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <div className="mb-1 text-[10.5px] uppercase tracking-[0.1em] text-ore-dimmer">力度层使用</div>
                    <div className="flex flex-col gap-1">
                        {model.buckets.map((bucket) => (
                            <div key={bucket.layer} className="flex items-center gap-2 text-[11px]">
                                <span className="w-16 text-ore-dim">{bucket.label}</span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--pb-soft)]">
                                    <div className="h-full rounded-full" style={{ width: `${bucket.ratio * 100}%`, background: accent }} />
                                </div>
                                <span className="w-14 text-right tabular-nums text-ore-dim">{pct(bucket.ratio)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-3">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.1em] text-ore-dimmer">时值分布</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ore-dim">
                    {model.durations.map((bucket) => (
                        <span key={bucket.label} className="tabular-nums">
                            {bucket.label} <span className="text-ore-text">{bucket.count}</span>
                        </span>
                    ))}
                </div>
            </div>
        </section>
    );
}
