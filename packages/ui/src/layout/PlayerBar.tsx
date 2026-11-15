import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { IconButton } from "../primitives";

/** 与 @piano/core/player 的结构一致，UI 包不直接依赖 core。 */
export interface PlayerState {
    status: "idle" | "playing" | "paused" | "ended";
    songId: string | null;
    songName: string;
    currentTime: number;
    duration: number;
}

export interface PlayerLike {
    getState(): PlayerState;
    subscribe(listener: (state: PlayerState) => void): () => void;
    pause(): void;
    resume(): void;
    stop(): void;
    seek(time: number): void;
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

function useSeek(player: PlayerLike, duration: number) {
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
        handlers: {
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
        },
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
    const { trackRef, handlers } = useSeek(player, state.duration);
    const pct = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;

    if (compact) {
        return (
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--pb-track)]">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
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
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                style={{ left: `${pct}%` }}
            />
        </div>
    );
}

function Transport({ player, state }: { player: PlayerLike; state: PlayerState }) {
    const playing = state.status === "playing";
    return (
        <div className="flex items-center gap-2">
            <IconButton
                aria-label={playing ? "暂停" : "播放"}
                title={playing ? "暂停" : "播放"}
                onClick={() => (playing ? player.pause() : player.resume())}
            >
                {playing ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </IconButton>
            <IconButton aria-label="停止" title="停止" onClick={() => player.stop()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
            </IconButton>
        </div>
    );
}

/** 桌面端底部播放条；空闲时不渲染。 */
export function PlayerBar({ player, extra }: { player: PlayerLike; extra?: ReactNode }) {
    const state = usePlayerState(player);
    if (state.status === "idle") return null;

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-ore-divider bg-ore-raised/92 backdrop-blur md:block">
            <div className="mx-auto grid h-[72px] max-w-[1600px] grid-cols-[minmax(0,1fr)_minmax(240px,2.1fr)_minmax(0,1fr)] items-center gap-5 px-5">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{state.songName || "未命名曲目"}</div>
                    <div className="text-[11px] tabular-nums text-ore-dim">
                        正在播放 · {formatClock(state.currentTime)} / {formatClock(state.duration)}
                    </div>
                </div>
                <div className="flex flex-col gap-1.5">
                    <div className="flex justify-center">
                        <Transport player={player} state={state} />
                    </div>
                    <div className="flex items-center gap-2.5">
                        <span className="text-[11px] tabular-nums text-ore-dim">{formatClock(state.currentTime)}</span>
                        <ProgressTrack player={player} state={state} />
                        <span className="text-[11px] tabular-nums text-ore-dim">{formatClock(state.duration)}</span>
                    </div>
                </div>
                <div className="flex justify-end">{extra}</div>
            </div>
        </div>
    );
}

/** 移动端迷你播放器：点击展开为底部面板。 */
export function MiniPlayer({ player }: { player: PlayerLike }) {
    const state = usePlayerState(player);
    const [opened, setOpened] = useState(false);
    if (state.status === "idle") return null;

    const playing = state.status === "playing";

    return (
        <>
            <div
                className="flex items-center gap-3 border-t border-ore-divider bg-ore-raised/95 px-4 py-2.5 backdrop-blur"
                role="button"
                tabIndex={0}
                aria-label="展开播放器"
                onClick={() => setOpened(true)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setOpened(true);
                }}
            >
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{state.songName || "未命名曲目"}</div>
                    <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] tabular-nums text-ore-dim">
                            {formatClock(state.currentTime)} / {formatClock(state.duration)}
                        </span>
                        <ProgressTrack player={player} state={state} compact />
                    </div>
                </div>
                <IconButton
                    aria-label={playing ? "暂停" : "播放"}
                    onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        playing ? player.pause() : player.resume();
                    }}
                >
                    {playing ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <rect x="6" y="5" width="4" height="14" rx="1" />
                            <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    )}
                </IconButton>
            </div>

            {opened && (
                <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setOpened(false)}>
                    <div
                        className="rounded-t-2xl border-t border-ore-divider bg-ore-raised p-5"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mx-auto mb-4 h-1 w-11 rounded-full bg-[var(--pb-track)]" />
                        <div className="text-center">
                            <div className="text-[11px] uppercase tracking-widest text-ore-dim">正在播放</div>
                            <div className="mt-1 line-clamp-2 text-lg font-bold">{state.songName || "未命名曲目"}</div>
                        </div>
                        <div className="mt-4">
                            <ProgressTrack player={player} state={state} />
                            <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ore-dim">
                                <span>{formatClock(state.currentTime)}</span>
                                <span>{formatClock(state.duration)}</span>
                            </div>
                        </div>
                        <div className="mt-4 flex justify-center">
                            <Transport player={player} state={state} />
                        </div>
                        <button
                            type="button"
                            className="mt-4 w-full rounded-md py-2 text-xs text-ore-dim hover:bg-[var(--pb-hover)]"
                            onClick={() => setOpened(false)}
                        >
                            收起
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
