import { useEffect, useRef, useState } from "react";
import { midiPlayer, type PlayerState } from "./midiPlayer";

export function PlayerBar() {
    const [state, setState] = useState<PlayerState>(midiPlayer.getState());
    const trackRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);

    useEffect(() => midiPlayer.subscribe(setState), []);

    if (state.status === "idle") return null;

    const pct =
        state.duration > 0
            ? Math.min(100, (state.currentTime / state.duration) * 100)
            : 0;

    /** 指针位置 → 目标秒数（统一处理鼠标/触摸/触控笔） */
    const seekTo = (clientX: number) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || state.duration <= 0) return;
        const ratio = (clientX - rect.left) / rect.width;
        midiPlayer.seek(Math.max(0, Math.min(1, ratio)) * state.duration);
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging.current) return;
        seekTo(e.clientX);
    };
    const onPointerUp = () => {
        dragging.current = false;
    };

    return (
        <div className="playerbar">
            <div
                className="playerbar-track"
                ref={trackRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <div className="playerbar-fill" style={{ width: `${pct}%` }} />
                <div className="playerbar-thumb" style={{ left: `${pct}%` }} />
            </div>
            <div className="playerbar-info">
                <span className="playerbar-name">{state.songName}</span>
                <span className="playerbar-time">
                    {formatSeconds(state.currentTime)} / {formatSeconds(state.duration)}
                </span>
            </div>
            <div className="playerbar-controls">
                <button
                    className="icon-btn"
                    onClick={() =>
                        state.status === "playing"
                            ? midiPlayer.pause()
                            : midiPlayer.resume()
                    }
                    title={state.status === "playing" ? "暂停" : "继续"}
                >
                    {state.status === "playing" ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button className="icon-btn" onClick={() => midiPlayer.stop()} title="停止">
                    <StopIcon />
                </button>
            </div>
        </div>
    );
}

function PlayIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

function StopIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
    );
}

function formatSeconds(s: number): string {
    const sec = Math.floor(s);
    const m = Math.floor(sec / 60);
    return `${m}:${String(sec % 60).padStart(2, "0")}`;
}
