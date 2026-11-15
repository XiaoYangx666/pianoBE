import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Sidebar, type AppNavItem } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { MiniPlayer, PlayerBar, type PlayerLike } from "./PlayerBar";

export interface BrandConfig {
    name: string;
    subtitle?: string;
    mark?: ReactNode;
    to?: string;
}

export interface AppLayoutProps {
    brand: BrandConfig;
    nav: AppNavItem[];
    navLabel?: string;
    bottomNav?: AppNavItem[];
    headerActions?: ReactNode;
    sidebarFooter?: ReactNode;
    /** 播放器单例；跨页面保持播放，桌面显示底栏、移动端显示迷你播放器。 */
    player?: PlayerLike;
    children: ReactNode;
    /** 是否套用默认页面容器（最大宽度与内边距）。 */
    padded?: boolean;
    pageClassName?: string;
    /** 兼容旧接口：OreUI 只有深色主题，此参数已无效。 */
    withColorSchemeToggle?: boolean;
}

function Brand({ brand }: { brand: BrandConfig }) {
    const content = (
        <>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#6b8afd] to-[#3f5edb] text-white">
                {brand.mark}
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-bold leading-tight">{brand.name}</span>
                {brand.subtitle && (
                    <span className="hidden text-[11px] text-ore-dim sm:block">{brand.subtitle}</span>
                )}
            </span>
        </>
    );
    return brand.to ? (
        <Link to={brand.to} className="flex min-w-0 items-center gap-2.5">
            {content}
        </Link>
    ) : (
        <div className="flex min-w-0 items-center gap-2.5">{content}</div>
    );
}

function usePlayerActive(player?: PlayerLike) {
    const [active, setActive] = useState(false);
    useEffect(() => {
        if (!player) return;
        const update = () => setActive(player.getState().status !== "idle");
        update();
        return player.subscribe(update);
    }, [player]);
    return active;
}

export function AppLayout({
    brand,
    nav,
    navLabel = "导航",
    bottomNav,
    headerActions,
    sidebarFooter,
    player,
    children,
    padded = true,
    pageClassName,
}: AppLayoutProps) {
    const [mobileOpened, setMobileOpened] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const playerActive = usePlayerActive(player);

    return (
        <div className="flex min-h-dvh flex-col bg-ore-sunken">
            <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-ore-divider bg-ore-raised/95 px-3 backdrop-blur md:px-4">
                <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text md:hidden"
                    aria-label="打开导航"
                    onClick={() => setMobileOpened((value) => !value)}
                >
                    <Menu size={17} />
                </button>
                <button
                    type="button"
                    className="hidden h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text md:grid"
                    aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                    onClick={() => setCollapsed((value) => !value)}
                >
                    {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                </button>
                <Brand brand={brand} />
                <div className="flex-1" />
                <div className="flex items-center gap-1.5">{headerActions}</div>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside
                    className={[
                        "hidden shrink-0 border-r border-ore-divider bg-ore-raised md:block",
                        collapsed ? "w-16" : "w-[216px]",
                    ].join(" ")}
                >
                    <div className="sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto">
                        <Sidebar items={nav} collapsed={collapsed} label={navLabel} footer={sidebarFooter} />
                    </div>
                </aside>

                <main className="flex min-w-0 flex-1 flex-col">
                    {padded ? (
                        <div
                            className={[
                                "mx-auto w-full max-w-[1360px] p-4 md:p-6",
                                playerActive ? "pb-[104px]" : "pb-8",
                                pageClassName ?? "",
                            ].join(" ")}
                        >
                            {children}
                        </div>
                    ) : (
                        children
                    )}
                </main>
            </div>

            {player && <PlayerBar player={player} />}

            {mobileOpened && (
                <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMobileOpened(false)}>
                    <div
                        className="h-full w-[248px] border-r border-ore-divider bg-ore-raised"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex h-14 items-center justify-between border-b border-ore-divider px-3">
                            <span className="text-xs font-semibold uppercase tracking-widest text-ore-dim">
                                {navLabel}
                            </span>
                            <button
                                type="button"
                                className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)]"
                                aria-label="关闭导航"
                                onClick={() => setMobileOpened(false)}
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="h-[calc(100dvh-3.5rem)] overflow-y-auto">
                            <Sidebar
                                items={nav}
                                label={navLabel}
                                footer={sidebarFooter}
                                onNavigate={() => setMobileOpened(false)}
                            />
                        </div>
                    </div>
                </div>
            )}

            {(bottomNav?.length || player) && (
                <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
                    {player && <MiniPlayer player={player} />}
                    {bottomNav && bottomNav.length > 0 && <BottomNav items={bottomNav} />}
                </div>
            )}
        </div>
    );
}
