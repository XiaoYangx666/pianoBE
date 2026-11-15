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
    teal: { ring: "border-emerald-500/40", icon: "text-emerald-600 dark:text-emerald-400", iconNode: <CheckCircle2 size={16} /> },
    red: { ring: "border-red-500/40", icon: "text-red-600 dark:text-red-400", iconNode: <AlertTriangle size={16} /> },
    yellow: { ring: "border-amber-500/40", icon: "text-amber-600 dark:text-amber-400", iconNode: <AlertTriangle size={16} /> },
    gray: { ring: "border-[color:var(--pb-border)]", icon: "text-ore-dim", iconNode: <Info size={16} /> },
    blue: { ring: "border-brand/40", icon: "text-brand", iconNode: <Info size={16} /> },
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
        <div className="pointer-events-none fixed right-4 top-4 z-[6000] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
            {list.map((item) => {
                const tone = TONE[item.color ?? "gray"];
                return (
                    <div
                        key={item.id}
                        className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border ${tone.ring} bg-ore-raised/95 px-3 py-2.5 shadow-xl backdrop-blur`}
                        role="status"
                    >
                        <span className={`mt-0.5 shrink-0 ${tone.icon}`}>{tone.iconNode}</span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold leading-snug">{item.title}</div>
                            {item.message && (
                                <div className="mt-0.5 break-words text-xs leading-relaxed text-ore-dim">
                                    {item.message}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            aria-label="关闭通知"
                            className="shrink-0 rounded p-0.5 text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={() => dismiss(item.id)}
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
