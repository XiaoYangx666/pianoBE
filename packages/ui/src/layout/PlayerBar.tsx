import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Piano, Volume2, VolumeX, X } from "lucide-react";
import { Menu } from "../primitives";
import { PianoKeys } from "../components/PianoKeys";

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

/** 与 @piano/core/player 的结构一致，UI 包不直接依赖 core。 */
export interface PlayerState {
    status: "idle" | "playing" | "paused" | "ended";
    songId: string | null;
    songName: string;
    currentTime: number;
    duration: number;
    /** 音量 0~1 */
    volume: number;
}

export interface PlayerLike {
    getState(): PlayerState;
    subscribe(listener: (state: PlayerState) => void): () => void;
    pause(): void;
    resume(): void;
    stop(): void;
    seek(time: number): void;
    setVolume?(volume: number): void;
}

export interface PlayerTimbre {
    id: string;
    label: string;
}

/** 播放器附带的音色选项；不传则不显示音色切换。 */
export interface PlayerExtras {
    timbres?: PlayerTimbre[];
    timbreId?: string;
    onTimbreChange?: (id: string) => void;
    /** 可选的逐曲响度归一化开关；不传则不显示。 */
    normalize?: {
        enabled: boolean;
        onToggle: (enabled: boolean) => void;
    };
    /** 额外控件，放在桌面播放条最右侧 */
    extra?: ReactNode;
}

/** 订阅播放器状态；播放器本身是模块级单例，跨路由天然保持播放。 */
export function usePlayerState(player: PlayerLike): PlayerState {
    const [state, setState] = useState<PlayerState>(() => player.getState());
    useEffect(() => {
        setState(player.getState());
        return player.subscribe(setState);
    }, [player]);
    return state;
}

/** 只订阅「当前在播曲目 id」：长列表不应跟着进度刷新重渲染。 */
export function usePlayingSongId(player: PlayerLike): string | null {
    const subscribe = useCallback((onChange: () => void) => player.subscribe(onChange), [player]);
    const getSnapshot = useCallback(() => {
        const state = player.getState();
        return state.status === "playing" || state.status === "paused" ? state.songId : null;
    }, [player]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function formatClock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 三根跳动的音柱：作为「正在播放」的轻量标识，不伪装专辑封面。 */
function PlayingBars({ active, size = "sm" }: { active: boolean; size?: "xs" | "sm" | "lg" }) {
    const heights =
        size === "lg" ? [16, 26, 20, 30, 14] : size === "xs" ? [4, 6, 5, 7, 3] : [7, 11, 8, 12, 6];
    return (
        <span
            className={cx("inline-flex items-end justify-center gap-[2px] text-brand", size === "lg" ? "gap-[3px]" : "")}
            aria-hidden="true"
        >
            {heights.map((height, index) => (
                <span
                    key={index}
                    className={cx("rounded-full bg-current", size === "xs" ? "w-[1.5px]" : "w-[2px]")}
                    style={{
                        height,
                        transformOrigin: "bottom",
                        animation: active ? `pbBars ${900 + index * 130}ms ease-in-out ${index * 90}ms infinite` : undefined,
                        opacity: active ? 1 : 0.35,
                    }}
                />
            ))}
        </span>
    );
}

function useSeek(player: PlayerLike, duration: number, interactive: boolean) {
    const [track, setTrack] = useState<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);

    const seekTo = useCallback(
        (clientX: number) => {
            const rect = track?.getBoundingClientRect();
            if (!rect || duration <= 0 || rect.width <= 0) return;
            const ratio = (clientX - rect.left) / rect.width;
            player.seek(Math.max(0, Math.min(1, ratio)) * duration);
        },
        [duration, player, track]
    );

    return {
        trackRef: setTrack,
        handlers: interactive
            ? {
                  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
                      setDragging(true);
                      event.currentTarget.setPointerCapture(event.pointerId);
                      seekTo(event.clientX);
                  },
                  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                      if (dragging) seekTo(event.clientX);
                  },
                  onPointerUp: () => setDragging(false),
                  onPointerCancel: () => setDragging(false),
              }
            : {},
    };
}

function ProgressTrack({
    player,
    state,
    compact = false,
}: {
    player: PlayerLike;
    state: PlayerState;
    compact?: boolean;
}) {
    const { trackRef, handlers } = useSeek(player, state.duration, !compact);
    const pct = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;

    if (compact) {
        return (
            <div className="h-[2px] w-full overflow-hidden bg-[var(--pb-track)]">
                <div className="h-full bg-brand transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
            </div>
        );
    }

    return (
        <div
            ref={trackRef}
            {...handlers}
            className="group relative h-1 flex-1 cursor-pointer rounded-full bg-[var(--pb-track)]"
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(state.duration)}
            aria-valuenow={Math.round(state.currentTime)}
            tabIndex={0}
        >
            <div
                className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
                style={{ width: `${pct}%` }}
            />
            <span
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow ring-1 ring-black/10 transition-opacity group-hover:opacity-100"
                style={{ left: `${pct}%` }}
            />
        </div>
    );
}

function PlayGlyph({ playing, size = 16 }: { playing: boolean; size?: number }) {
    return playing ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6.5" y="5" width="3.7" height="14" rx="1.2" />
            <rect x="13.8" y="5" width="3.7" height="14" rx="1.2" />
        </svg>
    ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.1v13.8c0 .8.9 1.3 1.6.9l10.2-6.9a1.1 1.1 0 0 0 0-1.8L9.6 4.2A1.1 1.1 0 0 0 8 5.1Z" />
        </svg>
    );
}

function PlayButton({
    player,
    state,
    size = "md",
}: {
    player: PlayerLike;
    state: PlayerState;
    size?: "md" | "lg";
}) {
    const playing = state.status === "playing";
    return (
        <button
            type="button"
            aria-label={playing ? "暂停" : "播放"}
            title={playing ? "暂停" : "播放"}
            onClick={(event) => {
                event.stopPropagation();
                playing ? player.pause() : player.resume();
            }}
            className={cx(
                "grid shrink-0 place-items-center rounded-full bg-brand text-white",
                "transition-[background-color,transform] duration-150 hover:bg-brand-hover active:scale-95",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/70",
                size === "lg" ? "h-12 w-12" : "h-8 w-8"
            )}
        >
            <PlayGlyph playing={playing} size={size === "lg" ? 18 : 14} />
        </button>
    );
}

function StopButton({ player, className }: { player: PlayerLike; className?: string }) {
    return (
        <button
            type="button"
            aria-label="停止"
            title="停止"
            onClick={() => player.stop()}
            className={cx(
                "grid h-8 w-8 place-items-center rounded-full text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text",
                className
            )}
        >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
        </button>
    );
}

function VolumeControl({
    player,
    state,
    className,
    wide = false,
}: {
    player: PlayerLike;
    state: PlayerState;
    className?: string;
    wide?: boolean;
}) {
    const volume = Math.max(0, Math.min(1, state.volume ?? 1));
    const lastAudible = useRef(volume > 0 ? volume : 0.8);
    useEffect(() => {
        if (volume > 0) lastAudible.current = volume;
    }, [volume]);

    if (!player.setVolume) return null;

    const muted = volume <= 0;
    return (
        <div className={cx("flex items-center gap-1.5", className)}>
            <button
                type="button"
                aria-label={muted ? "取消静音" : "静音"}
                title={muted ? "取消静音" : "静音"}
                onClick={() => player.setVolume?.(muted ? lastAudible.current || 0.8 : 0)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
            >
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                aria-label="音量"
                title={`音量 ${Math.round(volume * 100)}%`}
                onChange={(event) => player.setVolume?.(Number(event.target.value))}
                className={cx("h-1 cursor-pointer accent-[var(--pb-primary)]", wide ? "flex-1" : "w-[76px]")}
            />
            {wide && (
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-ore-dim">
                    {Math.round(volume * 100)}%
                </span>
            )}
        </div>
    );
}

function TimbreControl({ extras, compact = false }: { extras?: PlayerExtras; compact?: boolean }) {
    const list = extras?.timbres ?? [];
    if (list.length === 0 || !extras?.onTimbreChange) return null;
    const current = list.find((item) => item.id === extras.timbreId) ?? list[0];

    return (
        <Menu
            align="end"
            side="top"
            minWidth={176}
            trigger={
                <button
                    type="button"
                    title={`音色：${current.label}`}
                    className={cx(
                        "inline-flex items-center gap-1.5 rounded-md text-[11.5px] text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text",
                        compact ? "h-8 max-w-[132px] border border-ore-border px-2.5" : "h-8 max-w-[140px] border border-ore-border bg-[var(--pb-soft)] px-2.5 hover:border-brand/40"
                    )}
                >
                    <Piano size={14} className="shrink-0" />
                    <span className="truncate">{current.label}</span>
                </button>
            }
            items={list.map((item) => ({
                key: item.id,
                label: item.label,
                selected: item.id === extras.timbreId,
                onSelect: () => extras.onTimbreChange?.(item.id),
            }))}
        />
    );
}

/** 逐曲响度归一化开关：默认关闭，由用户决定是否拉平曲目间响度。 */
function NormalizeControl({ extras }: { extras?: PlayerExtras }) {
    const normalize = extras?.normalize;
    if (!normalize) return null;
    return (
        <button
            type="button"
            aria-pressed={normalize.enabled}
            title={normalize.enabled ? "逐曲响度归一化：开" : "逐曲响度归一化：关（保持原始动态）"}
            onClick={() => normalize.onToggle(!normalize.enabled)}
            className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] transition-colors",
                normalize.enabled
                    ? "border-brand/50 bg-brand/10 text-[color:var(--pb-primary-light)]"
                    : "border-ore-border text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
            )}
        >
            <AudioLines size={14} className="shrink-0" />
            <span>归一化</span>
        </button>
    );
}

/** 桌面端底部播放条；空闲时不渲染。 */
export function PlayerBar({ player, extras }: { player: PlayerLike; extras?: PlayerExtras }) {
    const state = usePlayerState(player);
    if (state.status === "idle") return null;
    const playing = state.status === "playing";

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-ore-divider bg-ore-raised lg:block">
            <div className="mx-auto grid h-[76px] max-w-[1600px] grid-cols-[minmax(0,1.05fr)_minmax(320px,1.55fr)_minmax(0,1fr)] items-center gap-6 px-6">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                        <PianoKeys playing={playing} className="h-10 w-12 p-1.5" />
                        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border border-ore-divider bg-ore-raised">
                            <PlayingBars active={playing} size="xs" />
                        </span>
                    </div>
                    <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium leading-5">{state.songName || "未命名曲目"}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ore-dim">
                            <span
                                className={cx(
                                    "inline-block h-1.5 w-1.5 rounded-full",
                                    playing ? "bg-brand" : "bg-ore-dimmer/60"
                                )}
                            />
                            <span className={playing ? "text-[color:var(--pb-primary-light)]" : undefined}>
                                {playing ? "正在播放" : "已暂停"}
                            </span>
                            <span className="text-ore-dimmer">·</span>
                            <span>MIDI 试听</span>
                        </div>
                    </div>
                </div>

                <div className="flex min-w-0 items-center gap-3 border-l border-ore-divider pl-5">
                    <StopButton player={player} />
                    <PlayButton player={player} state={state} />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-ore-dim">
                            {formatClock(state.currentTime)}
                        </span>
                        <ProgressTrack player={player} state={state} />
                        <span className="w-8 shrink-0 text-[10.5px] tabular-nums text-ore-dim">
                            {formatClock(state.duration)}
                        </span>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-l border-ore-divider pl-5">
                    <TimbreControl extras={extras} />
                    <NormalizeControl extras={extras} />
                    <span className="h-5 w-px bg-ore-divider" />
                    <VolumeControl player={player} state={state} />
                    {extras?.extra}
                </div>
            </div>
        </div>
    );
}

/** 移动端迷你播放器：点击展开为居中的正在播放面板。 */
export function MiniPlayer({ player, extras }: { player: PlayerLike; extras?: PlayerExtras }) {
    const state = usePlayerState(player);
    const [opened, setOpened] = useState(false);

    useEffect(() => {
        if (state.status === "idle") setOpened(false);
    }, [state.status]);

    useEffect(() => {
        if (!opened) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpened(false);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previous;
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [opened]);

    if (state.status === "idle") return null;

    const playing = state.status === "playing";

    return (
        <>
            <div
                className="relative flex items-center gap-2.5 border-t border-ore-divider bg-ore-raised px-3 py-1.5"
                role="button"
                tabIndex={0}
                aria-label="展开播放器"
                onClick={() => setOpened(true)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setOpened(true);
                }}
            >
                <div className="w-9 shrink-0">
                    <PianoKeys playing={playing} className="h-8 w-9 p-1" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium leading-tight">
                        {state.songName || "未命名曲目"}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] tabular-nums text-ore-dim">{formatClock(state.currentTime)}</span>
                        <div className="flex-1">
                            <ProgressTrack player={player} state={state} compact />
                        </div>
                        <span className="text-[10px] tabular-nums text-ore-dim">{formatClock(state.duration)}</span>
                    </div>
                </div>
                <PlayButton player={player} state={state} />
            </div>

            {opened &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[80] overflow-y-auto bg-black/55 animate-[pbFadeIn_140ms_ease-out]"
                        onClick={() => setOpened(false)}
                    >
                        <div className="flex min-h-full items-center justify-center p-4">
                            <div
                                className="relative w-full max-w-[360px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-ore-border bg-ore-raised p-5 shadow-[0_24px_64px_-16px_var(--pb-shadow)] animate-[pbDialogIn_160ms_ease-out]"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ore-dimmer">
                                        正在播放
                                    </span>
                                    <button
                                        type="button"
                                        aria-label="关闭播放器"
                                        onClick={() => setOpened(false)}
                                        className="grid h-7 w-7 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                    >
                                        <X size={15} />
                                    </button>
                                </div>

                                <div className="mt-6 flex flex-col items-center text-center">
                                    <div className="relative">
                                        <PianoKeys
                                            playing={playing}
                                            className="h-16 w-20 rounded-lg p-2.5"
                                        />
                                        <span className="absolute -bottom-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full border border-ore-divider bg-ore-raised">
                                            <PlayingBars active={playing} size="xs" />
                                        </span>
                                    </div>
                                    <h2 className="mt-4 line-clamp-2 text-[19px] font-semibold leading-snug tracking-[-0.02em]">
                                        {state.songName || "未命名曲目"}
                                    </h2>
                                    <div className="mt-1 text-[11.5px] text-ore-dim">
                                        MIDI 试听 · {playing ? "正在播放" : "已暂停"}
                                    </div>
                                </div>

                                <div className="mt-6">
                                    <ProgressTrack player={player} state={state} />
                                    <div className="mt-2 flex justify-between text-[10.5px] tabular-nums text-ore-dim">
                                        <span>{formatClock(state.currentTime)}</span>
                                        <span>{formatClock(state.duration)}</span>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-3 items-center">
                                    <div className="justify-self-start">
                                        <StopButton player={player} />
                                    </div>
                                    <div className="justify-self-center">
                                        <PlayButton player={player} state={state} size="lg" />
                                    </div>
                                </div>

                                <div className="mt-5 border-t border-ore-divider pt-3">
                                    <div className="mb-3 flex items-center justify-between gap-2">
                                        <TimbreControl extras={extras} compact />
                                        <NormalizeControl extras={extras} />
                                    </div>
                                    <VolumeControl player={player} state={state} wide />
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}
