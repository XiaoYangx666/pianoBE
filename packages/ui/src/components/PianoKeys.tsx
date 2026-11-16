import type { ReactNode } from "react";

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

/**
 * 极简钢琴键盘标记。
 *
 * 不画拟真钢琴，只用几组琴键表达「PianoBE 是钢琴工具」，
 * 尺寸随 className 缩放，可放在播放器、空状态和音色入口。
 */
export function PianoKeys({
    className,
    playing,
    children,
}: {
    className?: string;
    /** 播放中时点亮中间琴键 */
    playing?: boolean;
    children?: ReactNode;
}) {
    return (
        <span
            className={cx(
                "relative inline-flex h-7 w-10 shrink-0 items-stretch gap-[1.5px] rounded-[5px] border border-ore-border bg-[var(--pb-brand-soft)] p-1",
                className
            )}
            aria-hidden="true"
        >
            {[0, 1, 2, 3, 4].map((index) => (
                <span
                    key={index}
                    className={cx(
                        "relative flex-1 rounded-[1.5px] border border-ore-border/60 bg-ore-raised transition-colors",
                        playing && index === 2 && "border-brand/60 bg-brand/25"
                    )}
                />
            ))}
            {[0.28, 0.64].map((left, index) => (
                <span
                    key={left}
                    className={cx(
                        "absolute top-1 h-2.5 w-[3px] rounded-b-[1px]",
                        playing && index === 0 ? "bg-brand" : "bg-ore-text/45"
                    )}
                    style={{ left: `${left * 100}%` }}
                />
            ))}
            {children}
        </span>
    );
}

/** 极简钢琴线稿：用于品牌标记等极小尺寸场景。 */
export function PianoMark({ size = 18, className }: { size?: number; className?: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={className}
        >
            <rect x="2.25" y="4.75" width="15.5" height="10.5" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 4.75v10.5M12 4.75v10.5M16 4.75v10.5" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
            <path d="M6.3 4.75v5.1h2.4V4.75M10.3 4.75v5.1h2.4V4.75M14.3 4.75v5.1h2.4V4.75" fill="currentColor" opacity="0.85" />
        </svg>
    );
}
