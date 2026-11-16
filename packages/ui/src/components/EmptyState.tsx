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
        <div className={`flex flex-col items-center justify-center px-4 text-center ${compact ? "py-8" : "py-14"}`}>
            {icon && <div className="mb-3 text-ore-dimmer">{icon}</div>}
            <div className="max-w-[420px] text-[13px] font-medium">{title}</div>
            {description && <div className="mt-1 max-w-[420px] text-[11.5px] leading-relaxed text-ore-dim">{description}</div>}
            {action && <div className="mt-3.5">{action}</div>}
        </div>
    );
}
