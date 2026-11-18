import { useEffect, useState } from "react";
import {
    Button,
    NoteRoll,
    Segmented,
    type PlayerNote,
} from "@piano/ui";
import {
    Check,
    Copy,
    Download,
    FolderDown,
    Music2,
    Pause,
    Pencil,
    Play,
    RefreshCw,
    Square,
} from "lucide-react";
import type { TranscribeOutput } from "../../amt/transcribe";
import { formatBytes, formatDuration, formatElapsed } from "./format";

export type PreviewMode = "midi" | "audio";

export interface ResultPanelProps {
    result: TranscribeOutput;
    notes: PlayerNote[];
    name: string;
    elapsedMs: number | null;
    sourceName: string;
    sourceSize: number;
    previewMode: PreviewMode;
    onPreviewModeChange: (mode: PreviewMode) => void;
    /** 当前播放器是否正在播放这条结果 */
    active: boolean;
    playing: boolean;
    currentTime: number;
    previewBusy: boolean;
    onTogglePlay: () => void;
    onStop: () => void;
    onSeek: (time: number) => void;
    onRename: (name: string) => void;
    onDownload: () => void;
    onAddMine: () => void;
    onAddAddon: () => void;
    added: "mine" | "addon" | null;
    importCodeBusy: boolean;
    onOpenImportCode: () => void;
    onReconvert: () => void;
    isMobile: boolean;
}

/** 转换完成后的结果工作区：视觉中心是大尺寸钢琴卷帘和播放控制。 */
export function ResultPanel({
    result,
    notes,
    name,
    elapsedMs,
    sourceName,
    sourceSize,
    previewMode,
    onPreviewModeChange,
    active,
    playing,
    currentTime,
    previewBusy,
    onTogglePlay,
    onStop,
    onSeek,
    onRename,
    onDownload,
    onAddMine,
    onAddAddon,
    added,
    importCodeBusy,
    onOpenImportCode,
    onReconvert,
    isMobile,
}: ResultPanelProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);

    useEffect(() => {
        setDraft(name);
    }, [name]);

    const commitName = () => {
        const next = draft.trim();
        if (next && next !== name) onRename(next);
        setEditing(false);
    };

    const duration = result.duration;
    const progress = active ? Math.min(currentTime, duration) : 0;
    const ended = active && duration > 0 && currentTime >= duration - 0.05;

    return (
        <section className="mt-5 flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ore-dimmer">
                        转换结果
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        {editing ? (
                            <input
                                autoFocus
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onBlur={commitName}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") commitName();
                                    if (event.key === "Escape") {
                                        setDraft(name);
                                        setEditing(false);
                                    }
                                }}
                                className="min-w-0 max-w-full flex-1 rounded border border-brand/50 bg-transparent px-1.5 py-0.5 text-[20px] font-semibold leading-tight tracking-[-0.02em] outline-none md:text-[24px]"
                            />
                        ) : (
                            <>
                                <h2 className="min-w-0 truncate text-[20px] font-semibold leading-tight tracking-[-0.02em] md:text-[24px]">
                                    {name}
                                </h2>
                                <button
                                    type="button"
                                    aria-label="重命名"
                                    title="重命名"
                                    onClick={() => setEditing(true)}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ore-dimmer transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                >
                                    <Pencil size={13} />
                                </button>
                            </>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ore-dim">
                        <span>{result.notes.length.toLocaleString()} 音符</span>
                        <span className="text-ore-dimmer">·</span>
                        <span>{formatDuration(duration)}</span>
                        <span className="text-ore-dimmer">·</span>
                        <span>{formatBytes(result.midi.byteLength)}</span>
                        <span className="text-ore-dimmer">·</span>
                        <span>耗时 {formatElapsed(elapsedMs)}</span>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" size="sm" color="secondary" onClick={onReconvert}>
                        <RefreshCw size={13} />
                        重新转换
                    </Button>
                </div>
            </div>

            <div className="mt-4 rounded-lg border border-ore-border bg-ore-raised p-2.5 md:p-3">
                <NoteRoll
                    notes={notes}
                    duration={duration}
                    currentTime={progress}
                    height={isMobile ? 220 : 320}
                    onSeek={onSeek}
                    controls
                />

                <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-ore-divider pt-2.5">
                    <Segmented
                        ariaLabel="试听音源"
                        value={previewMode}
                        onChange={(value) => onPreviewModeChange(value)}
                        options={[
                            { value: "midi", label: "MIDI" },
                            { value: "audio", label: "原音频" },
                        ]}
                    />
                    <div className="flex items-center gap-1.5">
                        <Button
                            type="button"
                            size="sm"
                            color="secondary"
                            disabled={previewBusy}
                            onClick={onTogglePlay}
                        >
                            {previewBusy ? (
                                <RefreshCw size={12} className="animate-spin" />
                            ) : playing ? (
                                <Pause size={12} />
                            ) : (
                                <Play size={12} />
                            )}
                            {playing ? "暂停" : ended ? "重播" : active ? "继续" : "试听"}
                        </Button>
                        <button
                            type="button"
                            aria-label="停止"
                            title="停止"
                            disabled={!active}
                            onClick={onStop}
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text disabled:opacity-35"
                        >
                            <Square size={11} />
                        </button>
                    </div>
                    <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-ore-dim">
                        {formatDuration(progress)}
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={Math.max(0, duration)}
                        step={0.05}
                        value={progress}
                        aria-label="播放进度"
                        onChange={(event) => onSeek(Number(event.target.value))}
                        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--pb-primary)]"
                    />
                    <span className="w-9 shrink-0 text-[10.5px] tabular-nums text-ore-dim">
                        {formatDuration(duration)}
                    </span>
                </div>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                    type="button"
                    size="md"
                    onClick={onAddMine}
                    className="w-full sm:w-auto"
                >
                    {added === "mine" ? <Check size={13} /> : <Music2 size={13} />}
                    {added === "mine" ? "已在我的音乐" : "加入我的音乐"}
                </Button>
                <Button
                    type="button"
                    size="md"
                    color="secondary"
                    onClick={onAddAddon}
                    className="w-full sm:w-auto"
                >
                    <FolderDown size={13} />
                    {added === "addon" ? "已在附加包" : "加入附加包"}
                </Button>
                <Button
                    type="button"
                    size="md"
                    color="secondary"
                    disabled={importCodeBusy}
                    onClick={onOpenImportCode}
                    className="w-full sm:w-auto"
                    title="查看游戏内导入码"
                >
                    {importCodeBusy ? (
                        <RefreshCw size={13} className="animate-spin" />
                    ) : (
                        <Copy size={13} />
                    )}
                    导入码
                </Button>
                <Button
                    type="button"
                    size="md"
                    color="ghost"
                    onClick={onDownload}
                    className={isMobile ? "w-full" : undefined}
                >
                    <Download size={14} />
                    下载 MIDI
                </Button>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ore-dim sm:mt-0 sm:ml-auto">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                        来源：<span className="max-w-[220px] truncate text-ore-text">{sourceName}</span>
                        <span className="tabular-nums">· {formatBytes(sourceSize)}</span>
                    </span>
                </div>
            </div>
        </section>
    );
}
