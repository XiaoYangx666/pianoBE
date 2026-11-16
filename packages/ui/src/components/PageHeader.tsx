import type { ReactNode } from "react";

/**
 * 页面标题：22px 标题 + 一行说明 + 右侧操作。
 * 不再使用大图标或卡片包裹，让标题与内容共享同一条左边线。
 */
export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
    meta,
}: {
    eyebrow?: string;
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    /** 标题下方的补充信息，例如计数 */
    meta?: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.02em] sm:text-[21px] md:text-[22px]">{title}</h1>
                    {eyebrow && (
                        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pb-primary-light)] sm:inline">
                            {eyebrow}
                        </span>
                    )}
                    {meta}
                </div>
                {description && (
                    <p className="mt-1.5 hidden max-w-[640px] text-[12.5px] leading-relaxed text-ore-dim sm:block">
                        {description}
                    </p>
                )}
            </div>
            {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
    );
}

export function SectionHeader({
    title,
    description,
    actions,
    className,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    className?: string;
}) {
    return (
        <div className={`flex flex-wrap items-end justify-between gap-3 ${className ?? ""}`}>
            <div className="min-w-0">
                <div className="text-[13px] font-semibold">{title}</div>
                {description && <div className="mt-0.5 text-[11.5px] text-ore-dim">{description}</div>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
    );
}
