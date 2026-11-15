import { NavLink } from "react-router-dom";
import type { AppNavItem } from "./Sidebar";

export interface BottomNavProps {
    items: AppNavItem[];
}

/** 移动端底部导航：只放主入口，尊重系统安全区域。 */
export function BottomNav({ items }: BottomNavProps) {
    return (
        <nav
            className="flex items-stretch border-t border-ore-divider bg-ore-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
            aria-label="底部导航"
        >
            {items
                .filter((item) => !item.disabled)
                .map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                            [
                                "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors",
                                isActive
                                    ? "text-[color:var(--pb-primary-light)]"
                                    : "text-ore-dim hover:text-ore-text",
                            ].join(" ")
                        }
                    >
                        {item.icon}
                        <span>{item.label}</span>
                    </NavLink>
                ))}
        </nav>
    );
}
