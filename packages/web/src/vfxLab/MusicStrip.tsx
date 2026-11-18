import { useEffect, useRef } from "react";
import type { NoteEvent } from "../midiPlayer";

export function MusicStrip({ notes, duration, time, loop, seek }: {
    notes: readonly NoteEvent[];
    duration: number;
    time: number;
    loop?: readonly [number, number];
    seek: (time: number) => void;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const element = canvas.current!;
        function paint() {
            const ctx = element.getContext("2d");
            if (!ctx) return;
            const ratio = window.devicePixelRatio || 1;
            const width = element.clientWidth;
            const height = element.clientHeight;
            element.width = width * ratio;
            element.height = height * ratio;
            ctx.scale(ratio, ratio);
            ctx.fillStyle = "#111827";
            ctx.fillRect(0, 0, width, height);
            if (loop) {
                ctx.fillStyle = "#202943";
                ctx.fillRect(loop[0] / duration * width, 0, (loop[1] - loop[0]) / duration * width, height);
            }
            ctx.fillStyle = "#3a4660";
            for (const midi of [36, 48, 60, 72, 84]) {
                ctx.fillRect(0, Math.round(height - 4 - (midi - 21) / 87 * (height - 8)), width, 1);
            }
            ctx.fillStyle = "#bbcbff";
            for (const note of notes) {
                ctx.globalAlpha = 0.30 + 0.65 * note.velocity;
                const y = height - 5 - (note.midi - 21) / 87 * (height - 10);
                ctx.fillRect(note.time / duration * width, y, Math.max(1.2, note.duration / duration * width), 2);
            }
        }
        const observer = new ResizeObserver(paint);
        observer.observe(element);
        return () => observer.disconnect();
    }, [notes, duration, loop?.[0], loop?.[1]]);

    return <div className="vfx-roll" title="点击音符图跳转">
        <canvas ref={canvas} aria-hidden="true" onPointerDown={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            seek((event.clientX - rect.left) / rect.width * duration);
        }} />
        <span style={{ left: `${Math.min(100, time / duration * 100)}%` }} />
    </div>;
}
