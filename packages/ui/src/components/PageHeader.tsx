import type { ReactNode } from "react";

export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
}: {
    eyebrow?: string;
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
                {eyebrow && (
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ore-dim">{eyebrow}</div>
                )}
                <h1 className={`text-[clamp(20px,2.4vw,26px)] font-[650] leading-tight tracking-[-0.01em] ${eyebrow ? "mt-1" : ""}`}>
                    {title}
                </h1>
                {description && (
                    <div className="mt-1.5 max-w-[680px] text-[13px] leading-relaxed text-ore-dim">{description}</div>
                )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export function SectionHeader({
    title,
    description,
    actions,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm font-semibold">{title}</div>
                {description && <div className="mt-1 text-xs text-ore-dim">{description}</div>}
            </div>
            {actions}
        </div>
    );
}
