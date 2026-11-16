import {
    useEffect,
    useRef,
    useState,
    type ButtonHTMLAttributes,
    type InputHTMLAttributes,
    type KeyboardEventHandler,
    type ReactNode,
    type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

/**
 * 应用基础控件（PianoBE 自己的实现）。
 *
 * 视觉基线：石墨中性色、1px 分隔线、克制圆角；主操作只有一处品牌青绿。
 * 所有控件都支持键盘焦点与深浅色主题。
 */

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

/* ---------- 按钮 ---------- */

export type ButtonColor = "primary" | "secondary" | "ghost" | "destructive";

const BUTTON_TONE: Record<ButtonColor, string> = {
    primary:
        "bg-brand text-white shadow-[0_1px_2px_var(--pb-shadow)] hover:bg-brand-hover active:brightness-95",
    secondary:
        "border border-[var(--pb-control-border)] bg-ore-raised text-ore-text hover:bg-[var(--pb-control-hover)]",
    ghost: "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text active:bg-[var(--pb-soft)]",
    destructive:
        "bg-[#bf3b32] text-white shadow-[0_1px_2px_var(--pb-shadow)] hover:bg-[#cb443a] active:brightness-95",
};

const BUTTON_SIZE = {
    md: "h-9 min-w-[64px] px-3.5 text-[13px] rounded-md",
    sm: "h-8 min-w-0 px-2.5 text-xs rounded-md",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    color?: ButtonColor;
    size?: keyof typeof BUTTON_SIZE;
    loading?: boolean;
}

export function Button({
    color = "primary",
    size = "md",
    loading,
    disabled,
    className,
    children,
    type = "button",
    ...rest
}: ButtonProps) {
    return (
        <button
            {...rest}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={cx(
                "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 font-medium transition-[background-color,color,box-shadow,border-color]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/70",
                "disabled:cursor-not-allowed disabled:opacity-45",
                BUTTON_TONE[color],
                BUTTON_SIZE[size],
                className
            )}
        >
            <span className={cx("inline-flex items-center gap-1.5", loading && "invisible")}>{children}</span>
            {loading && (
                <span className="absolute inset-0 grid place-items-center">
                    <Spinner size={size === "sm" ? 12 : 14} />
                </span>
            )}
        </button>
    );
}

export interface IconButtonProps extends Omit<ButtonProps, "size" | "children"> {
    size?: "sm" | "md";
    children: ReactNode;
}

export function IconButton({ size = "sm", className, children, loading, color = "ghost", ...rest }: IconButtonProps) {
    return (
        <Button
            {...rest}
            color={color}
            size={size}
            loading={loading}
            className={cx(
                "aspect-square px-0",
                size === "sm" ? "h-8 w-8 min-w-8" : "h-9 w-9 min-w-9",
                color !== "ghost" && "rounded-md",
                className
            )}
        >
            {children}
        </Button>
    );
}

export function Spinner({ size = 14 }: { size?: number }) {
    return (
        <span
            role="status"
            aria-label="加载中"
            className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
            style={{ width: size, height: size }}
        />
    );
}

/* ---------- 输入框 ---------- */

const FIELD_BASE =
    "w-full rounded-md border bg-[var(--pb-field)] px-2.5 text-[13px] text-ore-text placeholder:text-ore-dimmer " +
    "transition-[border-color,box-shadow] focus:outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/15 disabled:opacity-50";

export interface TextfieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
    label?: ReactNode;
    description?: ReactNode;
    error?: string;
    /** 输入框左侧图标（例如搜索图标） */
    leading?: ReactNode;
}

export function Textfield({ label, description, error, leading, className, id, ...rest }: TextfieldProps) {
    const inputId = id ?? rest.name ?? undefined;
    return (
        <div className={cx("flex w-full flex-col gap-1", className)}>
            {label && (
                <label htmlFor={inputId} className="text-[11.5px] font-medium text-ore-dim">
                    {label}
                </label>
            )}
            <div className="relative">
                {leading && (
                    <span className="pointer-events-none absolute inset-y-0 left-0 grid w-8 place-items-center text-ore-dimmer">
                        {leading}
                    </span>
                )}
                <input
                    {...rest}
                    id={inputId}
                    aria-invalid={Boolean(error) || undefined}
                    className={cx(
                        FIELD_BASE,
                        "[height:34px]",
                        Boolean(leading) && "pl-8",
                        error ? "pb-edge-danger" : "border-ore-border"
                    )}
                />
            </div>
            {error ? (
                <span className="text-[11px] text-[color:var(--pb-danger)]">{error}</span>
            ) : (
                description && <span className="text-[11px] text-ore-dim">{description}</span>
            )}
        </div>
    );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: ReactNode;
    description?: ReactNode;
    error?: string;
}

export function Textarea({ label, description, error, className, id, rows = 3, ...rest }: TextareaProps) {
    return (
        <div className={cx("flex w-full flex-col gap-1", className)}>
            {label && (
                <label htmlFor={id} className="text-[11.5px] font-medium text-ore-dim">
                    {label}
                </label>
            )}
            <textarea
                {...rest}
                id={id}
                rows={rows}
                className={cx(FIELD_BASE, "resize-y py-2 leading-relaxed", error ? "pb-edge-danger" : "border-ore-border")}
            />
            {error ? (
                <span className="text-[11px] text-[color:var(--pb-danger)]">{error}</span>
            ) : (
                description && <span className="text-[11px] text-ore-dim">{description}</span>
            )}
        </div>
    );
}

/* ---------- 标签 / 分段 / 分页标签 ---------- */

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "brand" | "success" }) {
    const styles =
        tone === "brand"
            ? "pb-tint-brand"
            : tone === "success"
              ? "pb-tint-success"
              : "bg-[var(--pb-soft)] text-ore-dim";
    return (
        <span className={cx("inline-flex shrink-0 items-center rounded-[4px] px-1.5 py-px text-[10.5px] font-medium leading-4 tabular-nums", styles)}>
            {children}
        </span>
    );
}

export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
    count?: ReactNode;
}

/** 紧凑分段切换：用于同一页面内的两个视图（在线曲库 / 我的音乐）。 */
export function Segmented<T extends string>({
    value,
    options,
    onChange,
    className,
    ariaLabel,
}: {
    value: T;
    options: SegmentedOption<T>[];
    onChange: (value: T) => void;
    className?: string;
    ariaLabel?: string;
}) {
    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const index = options.findIndex((option) => option.value === value);
                const next =
                    event.key === "ArrowRight"
                        ? (index + 1 + options.length) % options.length
                        : (index - 1 + options.length) % options.length;
                onChange(options[next].value);
            }}
            className={cx(
                "inline-flex w-full items-center gap-0.5 rounded-lg bg-[var(--pb-soft)] p-0.5 md:w-auto",
                className
            )}
        >
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => onChange(option.value)}
                        className={cx(
                            "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-[background-color,color,box-shadow] md:flex-none",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand/70",
                            selected
                                ? "bg-ore-raised text-[color:var(--pb-primary-light)] shadow-[0_1px_2px_var(--pb-shadow)]"
                                : "text-ore-dim hover:text-ore-text"
                        )}
                    >
                        {option.label}
                        {option.count !== undefined && (
                            <span className={cx("text-[10.5px] tabular-nums", selected ? "text-brand/80" : "text-ore-dimmer")}>
                                {option.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function TabBar({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div role="tablist" className={cx("flex items-center gap-6", className)}>
            {children}
        </div>
    );
}

export interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    selected?: boolean;
}

export function TabButton({ selected, className, children, ...rest }: TabButtonProps) {
    return (
        <button
            {...rest}
            type={rest.type ?? "button"}
            role="tab"
            aria-selected={Boolean(selected)}
            className={cx(
                "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 text-[13px] transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/70",
                selected
                    ? "border-brand font-medium text-[color:var(--pb-primary-light)]"
                    : "border-transparent text-ore-dim hover:text-ore-text",
                className
            )}
        >
            {children}
        </button>
    );
}

/* ---------- 下拉菜单 ---------- */

export interface MenuItem {
    key: string;
    label: ReactNode;
    icon?: ReactNode;
    selected?: boolean;
    danger?: boolean;
    onSelect?: () => void;
}

export interface MenuProps {
    trigger: ReactNode;
    items: MenuItem[];
    align?: "start" | "end";
    /** 展开方向；贴底部的播放条需要向上弹 */
    side?: "bottom" | "top";
    className?: string;
    /** 面板最小宽度 */
    minWidth?: number;
}

/** 轻量下拉菜单：挂到 body、自动判断上下方向，避免被滚动容器或底栏裁掉。 */
export function Menu({ trigger, items, align = "start", side = "bottom", className, minWidth = 180 }: MenuProps) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{
        left: number;
        width: number;
        top?: number;
        bottom?: number;
    } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLSpanElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const focusItem = (index: number) => {
        const nodes = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
        if (!nodes || nodes.length === 0) return;
        const target = nodes[(index + nodes.length) % nodes.length];
        target.focus();
    };

    const close = (restoreFocus = true) => {
        setOpen(false);
        if (restoreFocus) {
            triggerRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
        }
    };

    useEffect(() => {
        if (!open) {
            setPosition(null);
            return;
        }

        const place = () => {
            const el = triggerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const width = Math.max(minWidth, Math.round(rect.width));
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            // 播放条在页面底部：优先向上；其它位置空间不足时自动翻转
            const openUp =
                side === "top" ? spaceAbove > 120 : spaceBelow < 280 && spaceAbove > spaceBelow;
            const rawLeft = align === "end" ? rect.right - width : rect.left;
            const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));

            setPosition(
                openUp
                    ? { left, width, bottom: window.innerHeight - rect.top + 6 }
                    : { left, width, top: rect.bottom + 6 }
            );
        };

        place();

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onScroll = (event: Event) => {
            if (menuRef.current?.contains(event.target as Node)) return;
            setOpen(false);
        };
        const onResize = () => setOpen(false);

        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);

        requestAnimationFrame(() => focusItem(0));
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
        };
    }, [open, align, side, minWidth]);

    return (
        <div ref={rootRef} className={cx("relative inline-flex", className)}>
            <span
                ref={triggerRef}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex"
            >
                {trigger}
            </span>
            {open &&
                position &&
                createPortal(
                    <div
                        ref={menuRef}
                        role="menu"
                        style={{
                            position: "fixed",
                            left: position.left,
                            width: position.width,
                            top: position.top,
                            bottom: position.bottom,
                        }}
                        onKeyDown={(event) => {
                            const nodes = [
                                ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
                            ];
                            const index = nodes.indexOf(document.activeElement as HTMLButtonElement);

                            if (event.key === "Escape") {
                                event.preventDefault();
                                close();
                            } else if (event.key === "ArrowDown") {
                                event.preventDefault();
                                focusItem(index + 1);
                            } else if (event.key === "ArrowUp") {
                                event.preventDefault();
                                focusItem(index - 1);
                            } else if (event.key === "Home") {
                                event.preventDefault();
                                focusItem(0);
                            } else if (event.key === "End") {
                                event.preventDefault();
                                focusItem(nodes.length - 1);
                            } else if (event.key === "Tab") {
                                setOpen(false);
                            }
                        }}
                        className="z-[5500] max-h-[min(70vh,360px)] overflow-y-auto rounded-[10px] border border-ore-border bg-ore-raised p-1 shadow-[0_16px_40px_-12px_var(--pb-shadow)] animate-[pbDialogIn_120ms_ease-out]"
                    >
                        {items.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                onClick={() => {
                                    close();
                                    item.onSelect?.();
                                }}
                                className={cx(
                                    "flex h-8 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[12.5px] transition-colors",
                                    item.danger
                                        ? "text-[color:var(--pb-danger)] hover:bg-[var(--pb-danger-soft)]"
                                        : "text-ore-text hover:bg-[var(--pb-hover)]",
                                    item.selected && "text-[color:var(--pb-primary-light)]"
                                )}
                            >
                                <span className="grid w-4 shrink-0 place-items-center text-ore-dim">{item.icon}</span>
                                <span className="flex-1 truncate">{item.label}</span>
                                {item.selected && <span className="text-[11px] text-brand">✓</span>}
                            </button>
                        ))}
                    </div>,
                    document.body
                )}
        </div>
    );
}

/** 带下拉箭头的触发器外观，供 Menu 的 trigger 使用。 */
export function MenuTrigger({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <button
            type="button"
            className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--pb-control-border)] bg-ore-raised px-2.5",
                "text-[12.5px] text-ore-text transition-colors hover:bg-[var(--pb-control-hover)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/70",
                className
            )}
        >
            {children}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ore-dimmer" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
            </svg>
        </button>
    );
}

export type FieldKeyDown = KeyboardEventHandler<HTMLInputElement>;
