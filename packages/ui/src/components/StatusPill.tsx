import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface StatusPillProps {
    /** 当前状态文案；为 null 时不渲染 */
    label: string | null;
    /** 位置：默认右上角，避开顶栏 */
    position?: "top" | "bottom-left";
}

/**
 * 非阻塞状态条：解析模板、打包导出这类长任务期间显示。
 *
 * 和原来的全屏遮罩不同，它不拦截任何交互（pointer-events-none），
 * 也不会盖住页面内容，只占右上角一小块。
 */
export function StatusPill({ label, position = "top" }: StatusPillProps) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!label) return;
        setElapsed(0);
        const startedAt = performance.now();
        const timer = window.setInterval(() => {
            setElapsed(Math.floor((performance.now() - startedAt) / 1000));
        }, 500);
        return () => window.clearInterval(timer);
    }, [label]);

    if (!label) return null;

    const positionClass =
        position === "bottom-left"
            ? "left-4 bottom-4 md:bottom-[88px]"
            : "right-4 top-[68px]";

    return createPortal(
        <div
            role="status"
            aria-live="polite"
            className={`pointer-events-none fixed z-[4000] ${positionClass} animate-[pbStatusIn_160ms_ease-out]`}
        >
            <div className="flex items-center gap-2.5 rounded-full border border-ore-border bg-ore-raised/95 px-3.5 py-2 shadow-xl backdrop-blur">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-brand" />
                <span className="text-[13px] text-ore-text">{label}</span>
                {elapsed >= 1 && (
                    <span className="text-[11px] tabular-nums text-ore-dim">{elapsed}s</span>
                )}
            </div>
        </div>,
        document.body
    );
}
