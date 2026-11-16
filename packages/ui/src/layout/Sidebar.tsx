import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Github, PanelLeftClose, PanelLeftOpen } from "lucide-react";

export interface AppNavItem {
    /** 路由地址；为空时视为不可导航的占位项 */
    to: string;
    label: string;
    icon: ReactNode;
    end?: boolean;
    /** 右侧徽标，例如数量 */
    badge?: ReactNode;
    /** 规划中的入口：显示但不可点击 */
    disabled?: boolean;
}

export interface SidebarProps {
    items: AppNavItem[];
    collapsed?: boolean;
    label?: string;
    footer?: ReactNode;
    /** 品牌区（折叠时只显示简短内容） */
    header?: ReactNode;
    /** 主题切换、更新日志等次要操作 */
    actions?: ReactNode;
    /** 仓库地址；有值时在底部显示 GitHub 入口 */
    repoUrl?: string;
    onNavigate?: () => void;
    /** 桌面端折叠按钮 */
    onToggleCollapse?: () => void;
}

const itemBase =
    "relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors";

export function Sidebar({
    items,
    collapsed = false,
    label,
    footer,
    header,
    actions,
    repoUrl,
    onNavigate,
    onToggleCollapse,
}: SidebarProps) {
    return (
        <div className="flex h-full flex-col px-2.5 pb-3 pt-2.5">
            {header && (
                <div className={collapsed ? "flex justify-center px-0 py-0.5" : "flex items-center px-0 py-1"}>
                    <div className={collapsed ? "shrink-0" : "min-w-0 flex-1 pl-2"}>{header}</div>
                </div>
            )}

            {onToggleCollapse && (
                <button
                    type="button"
                    onClick={onToggleCollapse}
                    aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                    title={collapsed ? "展开侧栏" : "收起侧栏"}
                    className={
                        collapsed
                            ? "mx-auto mt-3 grid h-8 w-8 place-items-center rounded-md text-ore-dimmer transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            : "mt-3 flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] text-ore-dimmer transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                    }
                >
                    {collapsed ? (
                        <PanelLeftOpen size={16} />
                    ) : (
                        <>
                            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">
                                <PanelLeftClose size={16} />
                            </span>
                            <span className="flex-1">收起侧栏</span>
                        </>
                    )}
                </button>
            )}

            <nav
                className={
                    collapsed
                        ? "mt-3 flex flex-col items-center gap-0.5"
                        : "mt-3 flex flex-col gap-0.5"
                }
                aria-label="主导航"
            >
                {label && !collapsed && (
                    <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dim">
                        {label}
                    </div>
                )}
                {items.map((item) => {
                    const inner = (
                        <>
                            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">{item.icon}</span>
                            {!collapsed && (
                                <>
                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                    {item.badge}
                                </>
                            )}
                        </>
                    );

                    if (item.disabled) {
                        return (
                            <span
                                key={item.to}
                                className={`${itemBase} text-ore-dimmer opacity-55 ${collapsed ? "w-8 justify-center px-0" : ""}`}
                                title={collapsed ? `${item.label}（规划中）` : undefined}
                                aria-disabled="true"
                            >
                                {inner}
                            </span>
                        );
                    }

                    return (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            onClick={onNavigate}
                            title={collapsed ? item.label : undefined}
                            className={({ isActive }) =>
                                [
                                    itemBase,
                                    collapsed ? "w-8 justify-center px-0" : "",
                                    isActive
                                        ? [
                                              "bg-[var(--pb-brand-soft)] font-medium text-[color:var(--pb-primary-light)]",
                                              !collapsed &&
                                                  "before:absolute before:-left-1 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-full before:bg-brand before:content-['']",
                                          ].join(" ")
                                        : "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text",
                                ].join(" ")
                            }
                        >
                            {inner}
                        </NavLink>
                    );
                })}
            </nav>

            <div className="mt-auto flex flex-col gap-2 pt-4">
                {(actions || repoUrl) && (
                    <div
                        className={[
                            "flex items-center gap-0.5 border-t border-ore-divider pt-2.5",
                            collapsed ? "flex-col" : "flex-wrap px-2",
                        ].join(" ")}
                    >
                        {actions}
                        {repoUrl && (
                            <a
                                href={repoUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="在 GitHub 上查看项目"
                                aria-label="在 GitHub 上查看项目"
                                className="grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            >
                                <Github size={15} />
                            </a>
                        )}
                    </div>
                )}

                {footer && !collapsed && (
                    <div className="px-1.5 text-[10.5px] leading-relaxed text-ore-dimmer">{footer}</div>
                )}
            </div>
        </div>
    );
}
