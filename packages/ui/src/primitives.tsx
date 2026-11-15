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
 * 原先这些是 OreUI（0.0.1）的 Web Component，踩到的问题太多：
 * 下拉菜单没有背景/圆角、触发器必须套它们的按钮、输入框 error 传 undefined 会显示
 * 字面量、深色配色不完整、按钮固定 44px。这里换成普通 React 组件，
 * 样式全部走 Tailwind token，行为可控、可测试。
 */

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

/* ---------- 按钮 ---------- */

export type ButtonColor = "primary" | "secondary" | "destructive";

const BUTTON_TONE: Record<ButtonColor, string> = {
    primary: "bg-brand text-white shadow-sm hover:bg-brand-hover active:bg-brand",
    secondary:
        "bg-[var(--pb-control)] text-ore-text border border-[var(--pb-control-border)] hover:bg-[var(--pb-control-hover)]",
    destructive: "bg-[#b93b32] text-white shadow-sm hover:bg-[#c8453b] active:bg-[#b93b32]",
};

const BUTTON_SIZE = {
    md: "h-9 min-w-[64px] px-3.5 text-[13px] rounded-lg",
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
                "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 font-medium transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
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

export function IconButton({ size = "sm", className, children, loading, ...rest }: IconButtonProps) {
    return (
        <Button
            {...rest}
            size={size}
            loading={loading}
            className={cx("aspect-square px-0", size === "sm" ? "h-8 w-8 min-w-8" : "h-9 w-9 min-w-9", className)}
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
    "transition-colors focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/40 disabled:opacity-50";

export interface TextfieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
    label?: ReactNode;
    description?: ReactNode;
    error?: string;
}

export function Textfield({ label, description, error, className, id, ...rest }: TextfieldProps) {
    const inputId = id ?? rest.name ?? undefined;
    return (
        <div className={cx("flex w-full flex-col gap-1", className)}>
            {label && (
                <label htmlFor={inputId} className="text-xs font-medium text-ore-dim">
                    {label}
                </label>
            )}
            <input
                {...rest}
                id={inputId}
                aria-invalid={Boolean(error) || undefined}
                className={cx(FIELD_BASE, "h-9", error ? "border-red-500/60" : "border-ore-border")}
            />
            {error ? (
                <span className="text-[11px] text-red-600 dark:text-red-600 dark:text-red-400">{error}</span>
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
                <label htmlFor={id} className="text-xs font-medium text-ore-dim">
                    {label}
                </label>
            )}
            <textarea
                {...rest}
                id={id}
                rows={rows}
                className={cx(FIELD_BASE, "resize-y py-2", error ? "border-red-500/60" : "border-ore-border")}
            />
            {error ? (
                <span className="text-[11px] text-red-600 dark:text-red-600 dark:text-red-400">{error}</span>
            ) : (
                description && <span className="text-[11px] text-ore-dim">{description}</span>
            )}
        </div>
    );
}

/* ---------- 标签 / 分页标签 ---------- */

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "brand" | "success" }) {
    const styles =
        tone === "brand"
            ? "border-brand/45 bg-brand/15 text-[color:var(--pb-primary-light)]"
            : tone === "success"
              ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : "border-ore-border bg-[var(--pb-soft)] text-ore-dim";
    return (
        <span className={cx("inline-flex shrink-0 items-center rounded px-1.5 py-px text-[11px] font-medium leading-4", styles)}>
            {children}
        </span>
    );
}

export function TabBar({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div role="tablist" className={cx("flex items-center gap-1", className)}>
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
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                selected
                    ? "bg-brand/15 text-[color:var(--pb-primary-light)]"
                    : "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text",
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
}

/** 轻量下拉菜单：挂到 body、自动判断上下方向，避免被滚动容器或底栏裁掉。 */
export function Menu({ trigger, items, align = "start", side = "bottom", className }: MenuProps) {
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
            const width = Math.max(180, Math.round(rect.width));
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
    }, [open, align, side]);

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
                        className="z-[3000] max-h-[min(70vh,360px)] overflow-y-auto rounded-lg border border-[color:var(--pb-border)] bg-ore-raised p-1 shadow-2xl"
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
                                    "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors",
                                    item.danger
                                        ? "text-red-600 hover:bg-red-500/12 dark:text-red-300"
                                        : "text-ore-text hover:bg-[var(--pb-hover)]",
                                    item.selected && "text-[color:var(--pb-primary-light)]"
                                )}
                            >
                                {item.icon}
                                <span className="flex-1 truncate">{item.label}</span>
                                {item.selected && <span className="text-[11px]">✓</span>}
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
                "inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--pb-control-border)] bg-[var(--pb-control)] px-2.5",
                "text-[13px] text-ore-text transition-colors hover:bg-[var(--pb-control-hover)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                className
            )}
        >
            {children}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ore-dim" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
            </svg>
        </button>
    );
}

export type FieldKeyDown = KeyboardEventHandler<HTMLInputElement>;
