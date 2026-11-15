import { NavLink } from "react-router-dom";
import type { AppNavItem } from "./Sidebar";

export interface BottomNavProps {
    items: AppNavItem[];
}

/** 移动端底部导航：只放主入口，尊重系统安全区域。 */
export function BottomNav({ items }: BottomNavProps) {
    return (
        <nav
            className="flex items-stretch gap-1 border-t border-ore-divider bg-ore-raised/95 px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] backdrop-blur"
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
                                "group flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[10.5px] transition-colors",
                                isActive
                                    ? "text-[color:var(--pb-primary-light)]"
                                    : "text-ore-dim hover:text-ore-text",
                            ].join(" ")
                        }
                    >
                        <span className="grid h-6 w-10 place-items-center rounded-full transition-colors group-aria-[current=page]:bg-brand/12">
                            {item.icon}
                        </span>
                        <span>{item.label}</span>
                    </NavLink>
                ))}
        </nav>
    );
}
