import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface DialogProps {
    opened: boolean;
    onClose: () => void;
    title?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    /** 面板最大宽度，默认 680px */
    size?: "sm" | "md" | "lg";
    closeOnClickOutside?: boolean;
}

const WIDTH = { sm: "max-w-[420px]", md: "max-w-[640px]", lg: "max-w-[860px]" } as const;

/** 通用弹窗：overlay + 居中面板，ESC / 点击遮罩关闭。 */
export function Dialog({
    opened,
    onClose,
    title,
    children,
    footer,
    size = "md",
    closeOnClickOutside = true,
}: DialogProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    // onClose 通常是内联箭头函数：用 ref 保存，避免每次父组件渲染都重跑焦点/键盘副作用
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!opened) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== "Tab") return;

            // 焦点陷阱：Tab 只在弹窗内循环
            const panel = panelRef.current;
            if (!panel) return;
            const focusables = panel.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusables.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && (active === first || active === panel)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", onKeyDown, true);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const panel = panelRef.current;
        // 输入框等元素可能已经通过 autoFocus 取得焦点：不要把它抢回面板
        if (panel && !panel.contains(document.activeElement)) {
            const autofocus = panel.querySelector<HTMLElement>("[data-autofocus]");
            (autofocus ?? panel).focus();
        }

        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            document.body.style.overflow = previousOverflow;
            previouslyFocused?.focus?.();
        };
    }, [opened]);

    if (!opened) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/50 p-4 animate-[pbFadeIn_120ms_ease-out]"
            onMouseDown={(event) => {
                if (closeOnClickOutside && event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className={`flex max-h-[86vh] w-full ${WIDTH[size]} flex-col overflow-hidden rounded-xl border border-ore-border bg-ore-raised shadow-[0_24px_64px_-16px_var(--pb-shadow)] outline-none animate-[pbDialogIn_160ms_ease-out]`}
            >
                {title && (
                    <header className="flex flex-none items-center gap-3 border-b border-ore-divider px-4 py-3">
                        <div className="min-w-0 flex-1 text-[13px] font-semibold">{title}</div>
                        <button
                            type="button"
                            aria-label="关闭"
                            className="grid h-7 w-7 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={onClose}
                        >
                            <X size={16} />
                        </button>
                    </header>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
                {footer && <footer className="flex flex-none justify-end gap-2 border-t border-ore-divider px-4 py-3">{footer}</footer>}
            </div>
        </div>,
        document.body
    );
}
