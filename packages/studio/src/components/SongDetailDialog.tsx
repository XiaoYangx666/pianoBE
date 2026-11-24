import { Download, Music2, Sparkles, Trash2 } from "lucide-react";
import { PLAIN_PERFORMANCE_ID, TIME_SCALE, type LibraryRecord } from "@piano/core";
import { Button, Dialog, SongBadge } from "@piano/ui";
import type { StudioPlugin, StudioSong } from "../adapters/types";

function formatDuration(scaled: number): string {
    const sec = Math.max(0, Math.floor(scaled / TIME_SCALE));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export interface SongDetailDialogProps {
    song: StudioSong | null;
    libraries: readonly LibraryRecord[];
    plugins: readonly StudioPlugin[];
    canDeletePerformance: boolean;
    onClose: () => void;
    onDeletePerformance: (songId: string, perfId: string) => void;
    onDownloadPbe3: (song: StudioSong) => void;
}

export function SongDetailDialog({
    song,
    libraries,
    plugins,
    canDeletePerformance,
    onClose,
    onDeletePerformance,
    onDownloadPbe3,
}: SongDetailDialogProps) {
    if (!song) return null;

    const availableEffects = new Set<string>();
    for (const plugin of plugins) {
        if (!plugin.enabled) continue;
        for (const eff of plugin.provides.effects ?? []) availableEffects.add(eff);
    }

    const libNames = (song.libraries ?? [])
        .map((id) => libraries.find((l) => l.id === id)?.name ?? id)
        .filter(Boolean);

    const performances =
        song.performanceEntries.length > 0
            ? song.performanceEntries
            : [
                  {
                      id: PLAIN_PERFORMANCE_ID,
                      name: "普通演奏",
                      requiredEffects: [] as string[],
                  },
              ];

    return (
        <Dialog
            opened={Boolean(song)}
            onClose={onClose}
            size="md"
            title={
                <span className="flex min-w-0 items-center gap-2">
                    <Music2 size={17} className="shrink-0 text-brand" />
                    <span className="truncate">{song.name}</span>
                </span>
            }
            footer={
                <div className="flex w-full items-center justify-between">
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        onClick={() => onDownloadPbe3(song)}
                    >
                        <Download size={14} /> 导出 PBE3
                    </Button>
                    <Button type="button" size="sm" onClick={onClose}>
                        关闭
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-4 text-[12.5px]">
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-ore-divider bg-ore-raised p-3 sm:grid-cols-3">
                    <div>
                        <div className="text-[11px] text-ore-dimmer">曲目 ID</div>
                        <div className="mt-0.5 font-mono text-[12px]">{song.id}</div>
                    </div>
                    <div>
                        <div className="text-[11px] text-ore-dimmer">时长 / 音符</div>
                        <div className="mt-0.5 tabular-nums">
                            {formatDuration(song.duration)} · {song.noteCount} 音符
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] text-ore-dimmer">音乐本体指纹</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-ore-dim">
                            {song.musicFingerprint ?? "-"}
                        </div>
                    </div>
                    {song.aliases && song.aliases.length > 0 && (
                        <div className="col-span-2 sm:col-span-3">
                            <div className="text-[11px] text-ore-dimmer">别名 / 来源名称</div>
                            <div className="mt-0.5 text-ore-dim">{song.aliases.join("、")}</div>
                        </div>
                    )}
                    <div className="col-span-2 sm:col-span-3">
                        <div className="text-[11px] text-ore-dimmer">所属曲库</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                            {libNames.length > 0 ? (
                                libNames.map((name) => <SongBadge key={name}>{name}</SongBadge>)
                            ) : (
                                <span className="text-ore-dim">未归类</span>
                            )}
                        </div>
                    </div>
                </div>

                <div>
                    <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
                        <Sparkles size={14} className="text-brand" />
                        演出编排 ({performances.length})
                    </div>
                    <div className="flex flex-col gap-2">
                        {performances.map((perf) => {
                            const reqs = perf.requiredEffects ?? [];
                            const missing = reqs.filter((e) => !availableEffects.has(e));
                            const isPlain = perf.id === PLAIN_PERFORMANCE_ID;
                            return (
                                <div
                                    key={perf.id}
                                    className="flex items-start justify-between gap-3 rounded-lg border border-ore-border bg-ore-raised px-3 py-2.5"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                                            <span>{perf.name}</span>
                                            <SongBadge>{isPlain ? "默认可用" : perf.id}</SongBadge>
                                            {reqs.length > 0 && missing.length === 0 && (
                                                <SongBadge tone="brand">特效就绪</SongBadge>
                                            )}
                                            {missing.length > 0 && (
                                                <SongBadge>缺少特效 ({missing.length})</SongBadge>
                                            )}
                                        </div>
                                        {perf.author && (
                                            <div className="mt-0.5 text-[11px] text-ore-dim">
                                                编排作者：{perf.author}
                                            </div>
                                        )}
                                        {reqs.length > 0 && (
                                            <div className="mt-1 text-[11px] text-ore-dimmer">
                                                所需特效：{reqs.join("、")}
                                            </div>
                                        )}
                                        {missing.length > 0 && (
                                            <div className="mt-0.5 text-[11px] text-[color:var(--pb-warning)]">
                                                缺少：{missing.join("、")}（纯音乐演奏不受影响）
                                            </div>
                                        )}
                                    </div>
                                    {canDeletePerformance && !isPlain && (
                                        <button
                                            type="button"
                                            title="删除此演出编排"
                                            onClick={() => onDeletePerformance(song.id, perf.id)}
                                            className="grid h-7 w-7 shrink-0 place-items-center rounded text-ore-dim hover:bg-[var(--pb-hover)] hover:text-red-400"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
