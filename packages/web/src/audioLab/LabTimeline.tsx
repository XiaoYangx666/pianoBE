import { useEffect, useRef } from "react";
import { scheduleNotes, type LabNote, type VelocityMode } from "@piano/core/audioLab";
import type { LabConfig } from "./labAssets";

const LAYER_COLORS = ["#5b8def", "#38a169", "#dd8a1e"];

interface Props {
    notes: readonly LabNote[];
    config: LabConfig;
    playhead: number;
    duration: number;
    label: string;
    accent: string;
}

/** 简化的钢琴卷帘：浅色 = MIDI 原始位置，实色 = 当前方案的排定位置。 */
export function LabTimeline({ notes, config, playhead, duration, label, accent }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (!parent) return;
        const draw = () => {
            const ratio = window.devicePixelRatio || 1;
            const width = parent.clientWidth;
            const height = 168;
            canvas.width = Math.max(1, Math.floor(width * ratio));
            canvas.height = Math.max(1, Math.floor(height * ratio));
            canvas.style.width = "100%";
            canvas.style.height = `${height}px`;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = "rgba(127,127,127,0.045)";
            ctx.fillRect(0, 0, width, height);

            const scheduled = scheduleNotes(notes, {
                mode: config.scheduleMode,
                tickSeconds: config.tickSeconds,
                velocityMode: config.sampleSet === "fluidr3" ? "single" : config.velocityMode,
                velocityExponent: config.velocityExponent,
            });
            const midis = notes.map((note) => note.midi);
            const min = Math.min(...midis, 48) - 2;
            const max = Math.max(...midis, 72) + 2;
            const span = Math.max(12, max - min);
            const x = (time: number) => 8 + (Math.min(Math.max(0, time), duration) / Math.max(0.001, duration)) * (width - 16);
            const y = (midi: number) => 8 + (1 - (midi - min) / span) * (height - 16);

            // 0.5s 网格
            ctx.strokeStyle = "rgba(127,127,127,0.12)";
            ctx.lineWidth = 1;
            for (let t = 0; t <= duration; t += 0.5) {
                const px = x(t);
                ctx.beginPath();
                ctx.moveTo(px, 0);
                ctx.lineTo(px, height);
                ctx.stroke();
            }

            for (const note of scheduled) {
                const color = config.sampleSet === "fluidr3" ? accent : LAYER_COLORS[note.layer] ?? accent;
                const px = x(note.start);
                const py = y(note.midi);
                const originalPx = x(note.time);
                // 原始位置
                ctx.strokeStyle = "rgba(127,127,127,0.28)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(originalPx, py - 2.5);
                ctx.lineTo(originalPx, py + 2.5);
                ctx.stroke();
                // 实际时值
                ctx.globalAlpha = 0.2 + 0.35 * note.velocity;
                ctx.fillStyle = color;
                const widthPx = Math.max(1.5, x(note.start + Math.min(note.duration, 1.2)) - px);
                ctx.fillRect(px, py - 1.6, widthPx, 3.2);
                ctx.globalAlpha = 1;
                // 起点
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(px, py, 2.2 + note.velocity * 1.4, 0, Math.PI * 2);
                ctx.fill();
            }

            if (playhead > 0) {
                const px = x(playhead);
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(px, 0);
                ctx.lineTo(px, height);
                ctx.stroke();
            }

            ctx.fillStyle = "rgba(127,127,127,0.75)";
            ctx.font = "11px ui-monospace, monospace";
            ctx.fillText(label, 10, height - 8);
        };
        draw();
        const observer = new ResizeObserver(draw);
        observer.observe(parent);
        return () => observer.disconnect();
    }, [notes, config, playhead, duration, label, accent]);

    return (
        <div className="overflow-hidden rounded-md border border-ore-divider bg-[var(--pb-soft)]">
            <canvas ref={canvasRef} />
        </div>
    );
}
