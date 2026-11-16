import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type NotifyTone = "teal" | "red" | "yellow" | "gray" | "blue";

export interface NotifyOptions {
    title: string;
    message?: ReactNode;
    /** 与旧 Mantine 调用保持一致：teal=成功、red=错误、yellow=警告、gray=中性 */
    color?: NotifyTone;
    duration?: number;
}

interface ToastItem extends NotifyOptions {
    id: number;
}

const DISMISS_AFTER = 4000;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

export function notify(options: NotifyOptions): number {
    const id = ++seq;
    items = [...items, { ...options, id }];
    emit();
    window.setTimeout(() => dismiss(id), options.duration ?? DISMISS_AFTER);
    return id;
}

export function dismiss(id: number) {
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return;
    items = next;
    emit();
}

/** 兼容旧调用点：notifications.show(...) */
export const notifications = { show: notify };

const TONE: Record<NotifyTone, { ring: string; icon: string; iconNode: ReactNode }> = {
    teal: {
        ring: "pb-edge-success",
        icon: "text-[color:var(--pb-success)]",
        iconNode: <CheckCircle2 size={15} />,
    },
    red: {
        ring: "pb-edge-danger",
        icon: "text-[color:var(--pb-danger)]",
        iconNode: <AlertTriangle size={15} />,
    },
    yellow: {
        ring: "pb-edge-warning",
        icon: "text-[color:var(--pb-warning)]",
        iconNode: <AlertTriangle size={15} />,
    },
    gray: { ring: "border-[color:var(--pb-border)]", icon: "text-ore-dim", iconNode: <Info size={15} /> },
    blue: { ring: "pb-edge-brand", icon: "text-[color:var(--pb-primary-light)]", iconNode: <Info size={15} /> },
};

/** 通知容器：每个应用在根部挂一次 */
export function ToastHost() {
    const [list, setList] = useState<ToastItem[]>(items);

    useEffect(() => {
        const listener = () => setList(items);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return (
        <div className="pointer-events-none fixed inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top))] z-[6000] flex flex-col gap-2 md:inset-x-auto md:right-5 md:top-4 md:w-[360px]">
            {list.map((item) => {
                const tone = TONE[item.color ?? "gray"];
                return (
                    <div
                        key={item.id}
                        className={`pointer-events-auto flex items-start gap-2.5 rounded-[10px] border ${tone.ring} bg-ore-raised px-3 py-2.5 shadow-[0_16px_40px_-12px_var(--pb-shadow)] animate-[pbStatusIn_160ms_ease-out]`}
                        role="status"
                    >
                        <span className={`mt-0.5 shrink-0 ${tone.icon}`}>{tone.iconNode}</span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-medium leading-snug">{item.title}</div>
                            {item.message && (
                                <div className="mt-0.5 break-words text-[11.5px] leading-relaxed text-ore-dim">
                                    {item.message}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            aria-label="关闭通知"
                            className="grid h-5 w-5 shrink-0 place-items-center rounded text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={() => dismiss(item.id)}
                        >
                            <X size={13} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
