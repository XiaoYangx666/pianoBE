import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Music2, Volume2, VolumeX, X } from "lucide-react";
import { Menu } from "../primitives";

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
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--pb-track)]">
                <div
                    className="h-full rounded-full bg-brand transition-[width] duration-150 ease-linear"
                    style={{ width: `${pct}%` }}
                />
            </div>
        );
    }

    return (
        <div
            ref={trackRef}
            {...handlers}
            className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-[var(--pb-track)]"
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(state.duration)}
            aria-valuenow={Math.round(state.currentTime)}
            tabIndex={0}
        >
            <div
                className="h-full rounded-full bg-brand transition-[width] duration-150 ease-linear"
                style={{ width: `${pct}%` }}
            />
            <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                style={{ left: `${pct}%` }}
            />
        </div>
    );
}

function PlayGlyph({ playing }: { playing: boolean }) {
    return playing ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1.4" />
            <rect x="14" y="5" width="4" height="14" rx="1.4" />
        </svg>
    ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10-6.8a1.1 1.1 0 0 0 0-1.8l-10-6.8A1.1 1.1 0 0 0 8 5.2Z" />
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
                "grid shrink-0 place-items-center rounded-full bg-brand text-white shadow-lg shadow-[color:var(--pb-primary-shadow)]/30",
                "transition-[transform,background-color] duration-150 hover:bg-brand-hover active:scale-95",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                size === "lg" ? "h-14 w-14" : "h-9 w-9"
            )}
        >
            <PlayGlyph playing={playing} />
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
                "grid h-9 w-9 place-items-center rounded-full text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text",
                className
            )}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
        <div className={cx("flex items-center gap-2", className)}>
            <button
                type="button"
                aria-label={muted ? "取消静音" : "静音"}
                title={muted ? "取消静音" : "静音"}
                onClick={() => player.setVolume?.(muted ? lastAudible.current || 0.8 : 0)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
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
                className={cx("h-1 cursor-pointer accent-[var(--pb-primary)]", wide ? "flex-1" : "w-20")}
            />
            {wide && (
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ore-dim">
                    {Math.round(volume * 100)}%
                </span>
            )}
        </div>
    );
}

function TimbreControl({
    extras,
    compact = false,
}: {
    extras?: PlayerExtras;
    compact?: boolean;
}) {
    const list = extras?.timbres ?? [];
    if (list.length === 0 || !extras?.onTimbreChange) return null;
    const current = list.find((item) => item.id === extras.timbreId) ?? list[0];

    return (
        <Menu
            align="end"
            side="top"
            trigger={
                compact ? (
                    <button
                        type="button"
                        title={`音色：${current.label}`}
                        className="inline-flex h-9 max-w-[132px] items-center gap-1.5 rounded-full bg-[var(--pb-control)] px-3 text-xs text-ore-text transition-colors hover:bg-[var(--pb-control-hover)]"
                    >
                        <Music2 size={14} className="shrink-0 text-ore-dim" />
                        <span className="truncate">{current.label}</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--pb-control-border)] bg-[var(--pb-control)] px-2.5 text-xs text-ore-text transition-colors hover:bg-[var(--pb-control-hover)]"
                    >
                        <Music2 size={14} className="text-ore-dim" />
                        <span className="max-w-[96px] truncate">{current.label}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ore-dim" aria-hidden="true">
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </button>
                )
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

/** 桌面端底部播放条；空闲时不渲染。 */
export function PlayerBar({ player, extras }: { player: PlayerLike; extras?: PlayerExtras }) {
    const state = usePlayerState(player);
    if (state.status === "idle") return null;

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-ore-divider bg-ore-raised/92 backdrop-blur md:block">
            <div className="mx-auto grid h-[72px] max-w-[1600px] grid-cols-[minmax(0,1fr)_minmax(220px,2.1fr)_auto] items-center gap-5 px-5">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{state.songName || "未命名曲目"}</div>
                    <div className="text-[11px] tabular-nums text-ore-dim">
                        正在播放 · {formatClock(state.currentTime)} / {formatClock(state.duration)}
                    </div>
                </div>
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-center gap-3">
                        <StopButton player={player} />
                        <PlayButton player={player} state={state} />
                    </div>
                    <div className="flex items-center gap-2.5">
                        <span className="text-[11px] tabular-nums text-ore-dim">{formatClock(state.currentTime)}</span>
                        <ProgressTrack player={player} state={state} />
                        <span className="text-[11px] tabular-nums text-ore-dim">{formatClock(state.duration)}</span>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                    <TimbreControl extras={extras} />
                    <VolumeControl player={player} state={state} />
                    {extras?.extra}
                </div>
            </div>
        </div>
    );
}

/** 移动端迷你播放器：点击展开为底部面板。 */
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
    const pct = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;

    return (
        <>
            <div className="border-t border-ore-divider bg-ore-raised px-3 py-2">
                <div
                    className="flex items-center gap-3 rounded-xl bg-[var(--pb-soft)] py-2 pl-2 pr-2.5"
                    role="button"
                    tabIndex={0}
                    aria-label="展开播放器"
                    onClick={() => setOpened(true)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setOpened(true);
                    }}
                >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#6b8afd] to-[#3f5edb] text-white">
                        <Music2 size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold leading-tight">
                            {state.songName || "未命名曲目"}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--pb-track)]">
                                <div
                                    className="h-full rounded-full bg-brand transition-[width] duration-150 ease-linear"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <span className="shrink-0 text-[10px] tabular-nums text-ore-dim">
                                {formatClock(state.currentTime)}
                            </span>
                        </div>
                    </div>
                    <PlayButton player={player} state={state} />
                </div>
            </div>

            {opened &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[80] overflow-y-auto bg-black/55 backdrop-blur-sm animate-[pbFadeIn_140ms_ease-out]"
                        onClick={() => setOpened(false)}
                    >
                    <div className="flex min-h-full items-center justify-center p-4">
                        <div
                            className="relative w-full max-w-[380px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-ore-border bg-ore-raised p-5 shadow-2xl animate-[pbDialogIn_180ms_ease-out]"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ore-dim">
                                    正在播放
                                </span>
                                <button
                                    type="button"
                                    aria-label="关闭播放器"
                                    onClick={() => setOpened(false)}
                                    className="grid h-8 w-8 place-items-center rounded-full text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="mt-1 text-center">
                                <div className="line-clamp-2 text-base font-semibold leading-snug">
                                    {state.songName || "未命名曲目"}
                                </div>
                                <div className="mt-0.5 text-[11px] text-ore-dim">PianoBE 预览</div>
                            </div>

                            <div className="mx-auto mt-5 grid h-36 w-36 place-items-center rounded-2xl bg-gradient-to-br from-[#6b8afd] to-[#3f5edb] text-white shadow-xl shadow-[color:var(--pb-primary-shadow)]/25">
                                <Music2 size={48} />
                            </div>

                            <div className="mt-5">
                                <ProgressTrack player={player} state={state} />
                                <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ore-dim">
                                    <span>{formatClock(state.currentTime)}</span>
                                    <span>{formatClock(state.duration)}</span>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-3 items-center">
                                <div className="justify-self-start">
                                    <StopButton player={player} />
                                </div>
                                <PlayButton player={player} state={state} size="lg" />
                                <div className="justify-self-end">
                                    <TimbreControl extras={extras} compact />
                                </div>
                            </div>

                            <div className="mt-4 rounded-xl bg-[var(--pb-soft)] px-3 py-2">
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
