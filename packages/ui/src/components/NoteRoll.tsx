import { useEffect, useRef, useState } from "react";
import { LocateFixed, ZoomIn, ZoomOut } from "lucide-react";

export interface PlayerNote {
    /** MIDI 音高 */
    pitch: number;
    /** 开始时间（秒） */
    start: number;
    /** 结束时间（秒） */
    end: number;
    /** 力度 0~1；用于调整时值条高度与透明度 */
    velocity?: number;
}

export interface NoteRollProps {
    notes: PlayerNote[];
    /** 曲目总时长（秒） */
    duration: number;
    /** 当前播放位置（秒），用于绘制播放头 */
    currentTime?: number;
    height?: number;
    className?: string;
    /** 点击卷帘跳转播放位置 */
    onSeek?: (time: number) => void;
    /** 显示缩放 / 跟随 / 横向定位工具条 */
    controls?: boolean;
}

const ZOOM_LEVELS = [1, 2, 4, 8, 16];
const GUTTER = 34;
const RULER = 18;
const PAD = 4;
const PITCH_MIN = 21;
const PITCH_MAX = 108;

const NOTE_RGB = "78, 158, 148";
const ACTIVE_RGB = "196, 246, 237";
const PLAYHEAD = "rgba(245, 158, 11, 0.98)";

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function gridStepFor(windowSeconds: number): number {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const target = windowSeconds / 48;
    return steps.find((step) => step >= target) ?? 300;
}

function formatTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function isBlackKey(pitch: number): boolean {
    return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

/**
 * 钢琴卷帘：参考 DAW 的 Piano Roll，采用矩形音符、音高侧栏、时间标尺和可缩放视口。
 * 组件只负责显示与定位，音符数据仍来自现有 MIDI / 转录结果。
 */
export function NoteRoll({
    notes,
    duration,
    currentTime = 0,
    height = 240,
    className,
    onSeek,
    controls = true,
}: NoteRollProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoomIndex, setZoomIndex] = useState(0);
    const [viewStart, setViewStart] = useState(0);
    const [follow, setFollow] = useState(true);

    const zoom = ZOOM_LEVELS[zoomIndex];
    const total = Math.max(0.001, duration);
    const windowDuration = total / zoom;
    const effectiveStart = zoom === 1 ? 0 : clamp(viewStart, 0, Math.max(0, total - windowDuration));

    // 换曲 / 换缩放时重置视口
    useEffect(() => {
        setZoomIndex(0);
        setViewStart(0);
        setFollow(true);
    }, [duration, notes]);

    useEffect(() => {
        setViewStart((start) => clamp(start, 0, Math.max(0, total - windowDuration)));
    }, [total, windowDuration]);

    // 播放跟随：只在播放头接近视口边缘时平移，避免每帧抖动
    useEffect(() => {
        if (!follow || zoom === 1 || currentTime <= 0) return;
        setViewStart((start) => {
            const end = start + windowDuration;
            if (currentTime < start || currentTime > end - windowDuration * 0.1) {
                return clamp(currentTime - windowDuration * 0.3, 0, Math.max(0, total - windowDuration));
            }
            return start;
        });
    }, [currentTime, follow, zoom, windowDuration, total]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const draw = () => {
            const parent = canvas.parentElement;
            if (!parent) return;
            const width = Math.max(1, parent.clientWidth);
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);

            const plotLeft = GUTTER;
            const plotTop = RULER;
            const plotWidth = Math.max(1, width - plotLeft - PAD);
            const plotHeight = Math.max(1, height - plotTop - PAD);

            let low = 60;
            let high = 72;
            if (notes.length > 0) {
                low = PITCH_MAX;
                high = PITCH_MIN;
                for (const note of notes) {
                    if (note.pitch < low) low = note.pitch;
                    if (note.pitch > high) high = note.pitch;
                }
                low = Math.max(PITCH_MIN, low - 2);
                high = Math.min(PITCH_MAX, high + 2);
            }
            const span = Math.max(12, high - low + 1);
            const rowHeight = plotHeight / span;
            const noteHeight = clamp(rowHeight * 0.82, 1.1, 6);
            const start = effectiveStart;
            const end = start + windowDuration;
            const x = (time: number) => plotLeft + ((time - start) / windowDuration) * plotWidth;
            const y = (pitch: number) => plotTop + (1 - (pitch - low) / span) * plotHeight;

            // 背景
            ctx.fillStyle = "rgba(127, 127, 127, 0.035)";
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = "rgba(127, 127, 127, 0.075)";
            ctx.fillRect(0, 0, plotLeft, height);

            // 黑键行底色 + C 音高线
            for (let pitch = low; pitch <= high; pitch++) {
                if (!isBlackKey(pitch)) continue;
                const py = y(pitch);
                ctx.fillStyle = "rgba(15, 23, 42, 0.05)";
                ctx.fillRect(plotLeft, py - rowHeight / 2, plotWidth, rowHeight);
            }

            ctx.font = "9px ui-monospace, SFMono-Regular, monospace";
            ctx.textBaseline = "middle";
            for (let pitch = Math.ceil(low / 12) * 12; pitch <= high; pitch += 12) {
                const py = y(pitch);
                ctx.fillStyle = "rgba(127, 127, 127, 0.18)";
                ctx.fillRect(plotLeft, py, plotWidth, 1);
                if (rowHeight * 12 >= 16) {
                    ctx.fillStyle = "rgba(127, 127, 127, 0.72)";
                    ctx.fillText(`C${Math.floor(pitch / 12) - 1}`, 6, py);
                }
            }

            // 时间网格与标尺
            const step = gridStepFor(windowDuration);
            const pixelsPerStep = (step / windowDuration) * plotWidth;
            const labelEvery = Math.max(1, Math.ceil(44 / Math.max(1, pixelsPerStep)));
            for (let index = 0; ; index++) {
                const time = Math.floor(start / step) * step + index * step;
                if (time > end + 1e-9) break;
                if (time < start - 1e-9) continue;
                const px = x(time);
                ctx.fillStyle = "rgba(127, 127, 127, 0.14)";
                ctx.fillRect(px, plotTop, 1, plotHeight);
                if (index % labelEvery === 0) {
                    ctx.fillStyle = "rgba(127, 127, 127, 0.7)";
                    ctx.fillText(formatTime(time), px + 3, RULER / 2);
                }
            }

            // 音符：时间轴由左到右，音高由下到上
            for (const note of notes) {
                if (note.end < start || note.start > end) continue;
                const px = x(note.start);
                const widthPx = Math.max(1.2, x(note.end) - px);
                const py = y(note.pitch);
                const strength = clamp(note.velocity ?? 0.72, 0, 1);
                const active = currentTime >= note.start && currentTime <= note.end;
                const barHeight = active
                    ? noteHeight
                    : Math.max(1.1, Math.min(noteHeight, noteHeight * (0.6 + strength * 0.4)));
                const alpha = active ? 0.96 : 0.38 + strength * 0.5;
                ctx.fillStyle = active
                    ? `rgba(${ACTIVE_RGB}, ${alpha})`
                    : `rgba(${NOTE_RGB}, ${alpha})`;
                ctx.fillRect(px, py - barHeight / 2, widthPx, barHeight);
            }

            // 播放头
            if (currentTime >= start && currentTime <= end) {
                const px = x(currentTime);
                ctx.save();
                ctx.shadowColor = "rgba(245, 158, 11, 0.55)";
                ctx.shadowBlur = 6;
                ctx.fillStyle = PLAYHEAD;
                ctx.fillRect(px - 1, 0, 2, height);
                ctx.beginPath();
                ctx.moveTo(px - 5, 0);
                ctx.lineTo(px + 5, 0);
                ctx.lineTo(px, 6);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // 侧栏与标尺分隔线
            ctx.fillStyle = "rgba(127, 127, 127, 0.2)";
            ctx.fillRect(plotLeft, 0, 1, height);
            ctx.fillRect(0, plotTop, width, 1);

            if (notes.length === 0) {
                ctx.fillStyle = "rgba(127, 127, 127, 0.7)";
                ctx.font = "11px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("暂无音符", plotLeft + plotWidth / 2, plotTop + plotHeight / 2);
                ctx.textAlign = "start";
            }
        };

        draw();
        const observer = new ResizeObserver(draw);
        if (canvas.parentElement) observer.observe(canvas.parentElement);
        return () => observer.disconnect();
    }, [notes, height, currentTime, effectiveStart, windowDuration, total]);

    const seek = (clientX: number, element: HTMLElement) => {
        if (!onSeek) return;
        const rect = element.getBoundingClientRect();
        const plotWidth = rect.width - GUTTER - PAD;
        if (plotWidth <= 0) return;
        const ratio = clamp((clientX - rect.left - GUTTER) / plotWidth, 0, 1);
        onSeek(clamp(effectiveStart + ratio * windowDuration, 0, total));
    };

    const changeZoom = (delta: number) => {
        const nextIndex = clamp(zoomIndex + delta, 0, ZOOM_LEVELS.length - 1);
        if (nextIndex === zoomIndex) return;
        const nextZoom = ZOOM_LEVELS[nextIndex];
        const center =
            zoom === 1 ? (currentTime > 0 ? currentTime : total / 2) : effectiveStart + windowDuration / 2;
        const nextWindow = total / nextZoom;
        setZoomIndex(nextIndex);
        setViewStart(clamp(center - nextWindow / 2, 0, Math.max(0, total - nextWindow)));
        if (nextZoom === 1) setFollow(true);
    };

    return (
        <div className={className}>
            <div
                className={onSeek ? "cursor-pointer" : undefined}
                role={onSeek ? "slider" : undefined}
                tabIndex={onSeek ? 0 : undefined}
                aria-label={onSeek ? "钢琴卷帘，点击跳转播放位置" : undefined}
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                aria-valuenow={Math.round(currentTime)}
                onClick={(event) => seek(event.clientX, event.currentTarget)}
                onKeyDown={(event) => {
                    if (!onSeek) return;
                    if (event.key === "ArrowLeft") onSeek(Math.max(0, currentTime - 1));
                    if (event.key === "ArrowRight") onSeek(Math.min(total, currentTime + 1));
                }}
            >
                <canvas
                    ref={canvasRef}
                    role="img"
                    aria-label={`钢琴卷帘：${notes.length.toLocaleString()} 个音符`}
                    className="block w-full rounded-md bg-[var(--pb-soft)]"
                />
            </div>

            {controls && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-ore-dim">
                    <button
                        type="button"
                        title="缩小"
                        aria-label="缩小时间轴"
                        disabled={zoomIndex === 0}
                        onClick={() => changeZoom(-1)}
                        className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-[var(--pb-hover)] disabled:opacity-35"
                    >
                        <ZoomOut size={13} />
                    </button>
                    <span className="w-7 text-center tabular-nums text-ore-dimmer">{zoom}×</span>
                    <button
                        type="button"
                        title="放大"
                        aria-label="放大时间轴"
                        disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                        onClick={() => changeZoom(1)}
                        className="grid h-6 w-6 place-items-center rounded transition-colors hover:bg-[var(--pb-hover)] disabled:opacity-35"
                    >
                        <ZoomIn size={13} />
                    </button>
                    <button
                        type="button"
                        title={follow ? "跟随播放：开" : "跟随播放：关"}
                        aria-pressed={follow}
                        onClick={() => setFollow((value) => !value)}
                        className={[
                            "ml-1 inline-flex h-6 items-center gap-1 rounded px-1.5 transition-colors",
                            follow
                                ? "bg-brand/10 text-[color:var(--pb-primary-light)]"
                                : "text-ore-dimmer hover:bg-[var(--pb-hover)] hover:text-ore-text",
                        ].join(" ")}
                    >
                        <LocateFixed size={12} />
                        跟随
                    </button>
                    {zoom > 1 && (
                        <input
                            type="range"
                            min={0}
                            max={Math.max(0, total - windowDuration)}
                            step={0.05}
                            value={effectiveStart}
                            aria-label="卷帘位置"
                            onChange={(event) => {
                                setFollow(false);
                                setViewStart(Number(event.target.value));
                            }}
                            className="ml-1 h-1 min-w-[80px] flex-1 cursor-pointer accent-[var(--pb-primary)]"
                        />
                    )}
                </div>
            )}
        </div>
    );
}
