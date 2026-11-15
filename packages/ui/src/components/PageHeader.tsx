import type { ReactNode } from "react";

/**
 * 页面标题条：单行紧凑布局。
 * 大标题时代已经过去，这里只保留 17px 的标题 + 可选说明/操作，
 * 把纵向空间尽量留给内容。
 */
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-baseline gap-2.5">
                <h1 className="shrink-0 text-[17px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
                {eyebrow && (
                    <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-ore-dimmer sm:inline">
                        {eyebrow}
                    </span>
                )}
                {description && (
                    <span className="hidden min-w-0 truncate text-xs text-ore-dim lg:inline">{description}</span>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm font-semibold">{title}</div>
                {description && <div className="mt-0.5 text-xs text-ore-dim">{description}</div>}
            </div>
            {actions}
        </div>
    );
}
