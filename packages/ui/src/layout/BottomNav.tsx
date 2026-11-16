import { NavLink } from "react-router-dom";
import type { AppNavItem } from "./Sidebar";

export interface BottomNavProps {
    items: AppNavItem[];
}

/** 移动端底部导航：只放主入口，尊重系统安全区域。 */
export function BottomNav({ items }: BottomNavProps) {
    return (
        <nav
            className="flex items-stretch border-t border-ore-divider bg-ore-raised px-1 pb-[env(safe-area-inset-bottom)]"
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
                                "flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] transition-colors",
                                isActive ? "font-medium text-[color:var(--pb-primary-light)]" : "text-ore-dim hover:text-ore-text",
                            ].join(" ")
                        }
                    >
                        {({ isActive }) => (
                            <>
                                <span
                                    className={[
                                        "grid h-5 w-9 place-items-center rounded-full transition-colors",
                                        isActive ? "bg-[var(--pb-brand-soft)]" : "",
                                    ].join(" ")}
                                >
                                    {item.icon}
                                </span>
                                <span className="leading-none">{item.label}</span>
                            </>
                        )}
                    </NavLink>
                ))}
        </nav>
    );
}
