import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

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
    onNavigate?: () => void;
}

const itemBase =
    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors";

export function Sidebar({ items, collapsed = false, label, footer, onNavigate }: SidebarProps) {
    return (
        <div className="flex h-full flex-col p-2">
            <nav className="flex flex-col gap-0.5" aria-label="主导航">
                {label && !collapsed && (
                    <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ore-dimmer">
                        {label}
                    </div>
                )}
                {items.map((item) => {
                    const inner = (
                        <>
                            <span className="grid h-5 w-5 place-items-center">{item.icon}</span>
                            {!collapsed && (
                                <>
                                    <span className="flex-1 truncate">{item.label}</span>
                                    {item.badge}
                                </>
                            )}
                        </>
                    );

                    if (item.disabled) {
                        return (
                            <span
                                key={item.to}
                                className={`${itemBase} cursor-not-allowed text-ore-dimmer opacity-60 ${collapsed ? "justify-center" : ""}`}
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
                                    collapsed ? "justify-center" : "",
                                    isActive
                                        ? "bg-brand/18 text-[color:var(--pb-primary-light)]"
                                        : "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text",
                                ].join(" ")
                            }
                        >
                            {inner}
                        </NavLink>
                    );
                })}
            </nav>
            {footer && !collapsed && (
                <div className="mt-auto border-t border-ore-divider px-2.5 pt-2.5 text-[11px] leading-relaxed text-ore-dimmer">
                    {footer}
                </div>
            )}
        </div>
    );
}
