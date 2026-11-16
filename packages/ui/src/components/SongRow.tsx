import type { ReactNode } from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import { IconButton, Menu, type MenuItem } from "../primitives";

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export type RowPlayState = "idle" | "playing" | "pending";

/** 曲库表格的统计列数量：音符 / 添加 / 播放，按需显示，避免空列。 */
export type SongTableStats = 1 | 2 | 3;

const TABLE_GRID: Record<SongTableStats, string> = {
    1: "md:grid-cols-[28px_minmax(0,1fr)_68px_48px_180px]",
    2: "md:grid-cols-[28px_minmax(0,1fr)_68px_56px_48px_180px]",
    3: "md:grid-cols-[28px_minmax(0,1fr)_68px_56px_56px_48px_180px]",
};

/** 表头与行共用同一套列宽；两处都从这里取，避免各写一份再漂移。 */
export function songTableGrid(stats: SongTableStats): string {
    return TABLE_GRID[stats];
}

export interface SongRowProps {
    /** 列表序号；同时作为播放按钮（悬停时切换成播放/暂停） */
    index?: number;
    title: string;
    /** 时长、音符数等次要信息，用 · 分隔 */
    meta?: ReactNode[];
    /** 宽屏右对齐的数据列（音符、添加、播放等）；提供后 meta 只在手机显示 */
    stats?: ReactNode[];
    /** 右对齐的时长列 */
    duration?: ReactNode;
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
    /** 桌面端悬停显示的行内操作 */
    actions?: ReactNode;
    /** 移动端收进「更多」菜单的操作 */
    menu?: MenuItem[];
    /** 常驻在行末的主要操作（例如加入） */
    trailing?: ReactNode;
    onRemove?: () => void;
    removeLabel?: string;
    /** 重命名（可选）；不传则不显示入口 */
    onRename?: () => void;
    renameLabel?: string;
    /** 行首额外内容（封面等） */
    leading?: ReactNode;
    /** 表格模式：曲库列表使用固定列，与表头共用一套网格 */
    layout?: "row" | "table";
    /** 表格模式下显示几列统计（默认 3：音符 / 添加 / 播放） */
    statsColumns?: SongTableStats;
}

function PlayGlyph({ playing, size = 12 }: { playing: boolean; size?: number }) {
    if (playing) {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
                <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
            </svg>
        );
    }
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.1v13.8c0 .8.9 1.3 1.6.9l10.2-6.9a1.1 1.1 0 0 0 0-1.8L9.6 4.2A1.1 1.1 0 0 0 8 5.1Z" />
        </svg>
    );
}

function IndexPlay({
    index,
    active,
    playState,
    onPlay,
    disabled,
    label,
}: {
    index?: number;
    active?: boolean;
    playState: RowPlayState;
    onPlay?: () => void;
    disabled?: boolean;
    label?: string;
}) {
    const playing = playState === "playing";
    const pending = playState === "pending";
    const showGlyph = playing || pending;

    return (
        <button
            type="button"
            onClick={onPlay}
            disabled={!onPlay || disabled}
            aria-label={label ?? (playing ? "暂停试听" : "试听")}
            title={disabled ? "需先加载模板" : (label ?? (playing ? "暂停试听" : "试听"))}
            className={[
                "group/index relative grid h-8 w-8 shrink-0 place-items-center rounded-md text-[12px] tabular-nums transition-colors md:h-7 md:w-7",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/70",
                active ? "text-[color:var(--pb-primary-light)]" : "text-ore-dim",
                "hover:bg-[var(--pb-hover)] hover:text-ore-text disabled:cursor-not-allowed disabled:hover:bg-transparent",
            ].join(" ")}
        >
            {showGlyph ? (
                pending ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                    <PlayGlyph playing />
                )
            ) : (
                <>
                    <span className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                        {index ?? ""}
                    </span>
                    <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        <PlayGlyph playing={false} />
                    </span>
                </>
            )}
        </button>
    );
}

/** 行尾试听按钮：与「加入附加包」放在一起，鼠标不用横跨整行。 */
function TablePlayButton({
    playState,
    onPlay,
    disabled,
    label,
}: {
    playState: RowPlayState;
    onPlay?: () => void;
    disabled?: boolean;
    label?: string;
}) {
    const playing = playState === "playing";
    const pending = playState === "pending";

    return (
        <button
            type="button"
            onClick={onPlay}
            disabled={!onPlay || disabled}
            aria-label={label ?? (playing ? "暂停试听" : "试听")}
            title={disabled ? "需先加载模板" : (label ?? (playing ? "暂停试听" : "试听"))}
            className={cx(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/70",
                playing
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "text-ore-dim hover:bg-brand/10 hover:text-brand",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            )}
        >
            {pending ? (
                <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
            ) : (
                <PlayGlyph playing={playing} size={14} />
            )}
        </button>
    );
}

export function SongRow({
    index,
    title,
    meta,
    stats,
    duration,
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
    menu,
    trailing,
    onRemove,
    removeLabel = "移除",
    onRename,
    renameLabel = "重命名",
    leading,
    layout = "row",
    statsColumns = 3,
}: SongRowProps) {
    const playAtEnd = layout === "table";
    const menuItems: MenuItem[] = [...(menu ?? [])];
    if (onOpenCode) {
        menuItems.unshift({
            key: "code",
            label: codeLabel,
            icon: <span className="font-mono text-[10px]">{"</>"}</span>,
            onSelect: onOpenCode,
        });
    }
    if (onRename) {
        menuItems.push({
            key: "rename",
            label: renameLabel,
            icon: <Pencil size={13} />,
            onSelect: onRename,
        });
    }
    if (onRemove) {
        menuItems.push({
            key: "remove",
            label: removeLabel,
            icon: <span aria-hidden="true">×</span>,
            danger: true,
            onSelect: onRemove,
        });
    }

    return (
        <div
            className={[
                "group relative h-full items-center gap-3 border-b border-ore-divider/80 px-3 transition-colors",
                layout === "table"
                    ? `grid grid-cols-[minmax(0,1fr)_44px_104px] ${songTableGrid(statsColumns)}`
                    : "flex",
                active
                    ? "bg-[var(--pb-active)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-brand before:content-['']"
                    : "hover:bg-[var(--pb-hover)]",
            ].join(" ")}
        >
            {leading ?? (
                playAtEnd ? (
                    <span
                        className={cx(
                            "hidden h-7 w-7 items-center justify-center text-[12px] tabular-nums md:grid",
                            active ? "font-medium text-[color:var(--pb-primary-light)]" : "text-ore-dim"
                        )}
                    >
                        {index ?? ""}
                    </span>
                ) : (
                    <IndexPlay
                        index={index}
                        active={active}
                        playState={playState}
                        onPlay={onPlay}
                        disabled={playDisabled}
                        label={playLabel}
                    />
                )
            )}

            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className={[
                            "truncate text-[13px] leading-5",
                            active ? "font-semibold text-[color:var(--pb-primary-light)]" : "font-medium text-ore-text",
                        ].join(" ")}
                        title={title}
                    >
                        {title}
                    </span>
                    {badges}
                </div>
                {(meta?.length || id) && (
                    <div
                        className={[
                            "mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px] text-ore-dim",
                            stats && stats.length > 0 ? "md:hidden" : "",
                        ].join(" ")}
                    >
                        {meta?.map((item, i) => (
                            <span key={i} className="flex shrink-0 items-center gap-1.5">
                                {i > 0 && <span className="text-ore-dimmer">·</span>}
                                {item}
                            </span>
                        ))}
                        {id && <span className="truncate font-mono text-[10.5px] text-ore-dimmer">{id}</span>}
                    </div>
                )}
            </div>

            {layout === "table" ? (
                <>
                    {Array.from({ length: statsColumns }, (_, index) => (
                        <span
                            key={index}
                            className="hidden min-w-0 truncate text-right text-[11px] tabular-nums text-ore-dim md:block"
                        >
                            {stats?.[index] || <span className="text-ore-dimmer/60">—</span>}
                        </span>
                    ))}
                </>
            ) : (
                stats &&
                stats.length > 0 && (
                    <div className="hidden shrink-0 items-center gap-5 pr-1 md:flex">
                        {stats.map((item, index) => (
                            <span
                                key={index}
                                className="min-w-[54px] text-right text-[11px] tabular-nums text-ore-dim"
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                )
            )}

            {duration !== undefined && (
                <span
                    className={cx(
                        "shrink-0 text-right text-[10.5px] tabular-nums text-ore-dim sm:text-[11.5px]",
                        layout === "table" ? "min-w-0 truncate" : "w-9 sm:w-11"
                    )}
                >
                    {duration}
                </span>
            )}

            <div className={cx("flex shrink-0 items-center gap-0.5", layout === "table" && "justify-end")}>
                {(actions || onOpenCode || onRename || onRemove) && (
                    <div className="hidden items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 md:flex">
                        {onOpenCode && (
                            <IconButton size="sm" aria-label={codeLabel} title={codeLabel} onClick={onOpenCode}>
                                <span className="font-mono text-[10px]">{"</>"}</span>
                            </IconButton>
                        )}
                        {actions}
                        {onRename && (
                            <IconButton size="sm" aria-label={renameLabel} title={renameLabel} onClick={onRename}>
                                <Pencil size={14} />
                            </IconButton>
                        )}
                        {onRemove && (
                            <IconButton
                                size="sm"
                                aria-label={removeLabel}
                                title={removeLabel}
                                className="hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                                onClick={onRemove}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                    <path d="M6 6l12 12M18 6L6 18" />
                                </svg>
                            </IconButton>
                        )}
                    </div>
                )}
                {trailing}
                {menuItems.length > 0 && (
                    <div className="md:hidden">
                        <Menu
                            align="end"
                            minWidth={168}
                            trigger={
                                <IconButton size="sm" aria-label="更多操作" title="更多操作">
                                    <MoreHorizontal size={16} />
                                </IconButton>
                            }
                            items={menuItems}
                        />
                    </div>
                )}
                {playAtEnd && (
                    <TablePlayButton
                        playState={playState}
                        onPlay={onPlay}
                        disabled={playDisabled}
                        label={playLabel}
                    />
                )}
            </div>
        </div>
    );
}

/** 独立的圆形试听按钮，供音色列表等非歌曲行使用。 */
export function RowPlayButton({
    playState = "idle",
    onPlay,
    disabled,
    label,
}: {
    playState?: RowPlayState;
    onPlay: () => void;
    disabled?: boolean;
    label?: string;
}) {
    const playing = playState === "playing";
    return (
        <button
            type="button"
            className={[
                "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                playing
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text",
            ].join(" ")}
            aria-label={label ?? (playing ? "停止试听" : "试听")}
            title={disabled ? "需先加载模板" : (label ?? (playing ? "停止试听" : "试听"))}
            disabled={disabled}
            onClick={onPlay}
        >
            {playState === "pending" ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
                <PlayGlyph playing={playing} />
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
            ? "pb-tint-brand"
            : tone === "success"
              ? "pb-tint-success"
              : tone === "warning"
                ? "pb-tint-warning"
                : "bg-[var(--pb-soft)] text-ore-dim";

    return (
        <span className={`inline-flex shrink-0 items-center rounded-[4px] px-1.5 py-px text-[10.5px] font-medium leading-4 ${styles}`}>
            {children}
        </span>
    );
}

export function SongRowActions({ children }: { children: ReactNode }) {
    return <div className="flex items-center gap-1">{children}</div>;
}
