import type { ReactNode } from "react";
import { IconButton } from "../primitives";

export type RowPlayState = "idle" | "playing" | "pending";

export interface SongRowProps {
    /** 列表序号；移动端自动隐藏 */
    index?: number;
    title: string;
    /** 时长、音符数等次要信息，用 · 分隔 */
    meta?: ReactNode[];
    /** 标题右侧的标签 */
    badges?: ReactNode;
    /** 等宽 ID */
    id?: string;
    active?: boolean;
    playState?: RowPlayState;
    onPlay?: () => void;
    playDisabled?: boolean;
    playLabel?: string;
    /** 游戏内导入码 */
    onOpenCode?: () => void;
    codeLabel?: string;
    /** 行末自定义操作（加歌等） */
    actions?: ReactNode;
    onRemove?: () => void;
    removeLabel?: string;
    /** 行首额外内容（封面等） */
    leading?: ReactNode;
}

function Glyph({ children }: { children: ReactNode }) {
    return (
        <span className="grid place-items-center" aria-hidden="true">
            {children}
        </span>
    );
}

export function SongRow({
    index,
    title,
    meta,
    badges,
    id,
    active,
    playState = "idle",
    onPlay,
    playDisabled,
    playLabel,
    codeLabel = "游戏内导入码",
    onOpenCode,
    actions,
    onRemove,
    removeLabel = "移除",
    leading,
}: SongRowProps) {
    return (
        <div
            className={`flex h-[60px] items-center gap-3 rounded-lg px-3 transition-colors ${
                active
                    ? "bg-brand/15 shadow-[inset_3px_0_0_var(--pb-primary)]"
                    : "hover:bg-[var(--pb-hover)]"
            }`}
        >
            {leading ?? (index !== undefined ? (
                <div className="w-[26px] shrink-0 text-center text-[13px] tabular-nums text-ore-dim">{index}</div>
            ) : null)}

            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold" title={title}>
                        {title}
                    </span>
                    {badges}
                </div>
                <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-ore-dim">
                    {meta?.map((item, i) => (
                        <span key={i} className="flex items-center gap-2">
                            {i > 0 && <span className="opacity-50">·</span>}
                            {item}
                        </span>
                    ))}
                    {id && <span className="truncate font-mono text-[11px] opacity-70">{id}</span>}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                {onOpenCode && (
                    <IconButton size="sm" aria-label={codeLabel} title={codeLabel} onClick={onOpenCode}>
                        <Glyph>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
                            </svg>
                        </Glyph>
                    </IconButton>
                )}
                {actions}
                {onPlay && (
                    <RowPlayButton
                        playState={playState}
                        onPlay={onPlay}
                        disabled={playDisabled}
                        label={playLabel}
                    />
                )}
                {onRemove && (
                    <IconButton size="sm" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
                        <Glyph>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </Glyph>
                    </IconButton>
                )}
            </div>
        </div>
    );
}

/** 行内试听按钮：统一用图标表示播放 / 停止，省掉「试听」「停止」文字。 */
export function RowPlayButton({
    playState = "idle",
    onPlay,
    disabled,
    label,
}: {
    playState?: RowPlayState;
    onPlay: () => void;
    disabled?: boolean;
    /** 自定义无障碍标签，例如「试听此音色」 */
    label?: string;
}) {
    const playing = playState === "playing";
    return (
        <button
            type="button"
            className={[
                "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-[color,border-color,background-color] disabled:cursor-not-allowed disabled:opacity-40",
                playing
                    ? "border-brand bg-brand text-white hover:bg-brand-hover"
                    : "border-ore-border bg-[var(--pb-soft)] text-ore-text hover:border-brand/60 hover:text-brand",
            ].join(" ")}
            aria-label={label ?? (playing ? "停止试听" : "试听")}
            title={disabled ? "需先加载模板" : (label ?? (playing ? "停止试听" : "试听"))}
            disabled={disabled}
            onClick={onPlay}
        >
            {playState === "pending" ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : playing ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
            ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                </svg>
            )}
        </button>
    );
}

export function SongBadge({
    children,
    tone = "default",
}: {
    children: ReactNode;
    tone?: "default" | "brand" | "success" | "warning";
}) {
    const styles =
        tone === "brand"
            ? "border-brand/45 bg-brand/15 text-[color:var(--pb-primary-light)]"
            : tone === "success"
              ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : tone === "warning"
                ? "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300"
                : "border-ore-border bg-[var(--pb-soft)] text-ore-dim";

    return (
        <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-[11px] font-medium leading-4 ${styles}`}>
            {children}
        </span>
    );
}

export function SongRowActions({ children }: { children: ReactNode }) {
    return <div className="flex items-center gap-1">{children}</div>;
}
