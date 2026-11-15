import type { ReactNode } from "react";

export function SongList({ children }: { children: ReactNode }) {
    return <div className="flex flex-col gap-0.5">{children}</div>;
}

export function EmptyState({
    icon,
    title,
    description,
    action,
    compact = false,
}: {
    icon?: ReactNode;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    compact?: boolean;
}) {
    return (
        <div className={`flex flex-col items-center justify-center px-4 text-center ${compact ? "py-7" : "py-12"}`}>
            {icon && (
                <div className="mb-2.5 grid h-11 w-11 place-items-center rounded-xl border border-ore-border bg-[var(--pb-soft)] text-ore-dim">
                    {icon}
                </div>
            )}
            <div className="max-w-[420px] text-sm font-semibold">{title}</div>
            {description && <div className="mt-1 max-w-[420px] text-xs text-ore-dim">{description}</div>}
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}
