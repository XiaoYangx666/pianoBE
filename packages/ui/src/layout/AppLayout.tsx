import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Menu as MenuIcon, X } from "lucide-react";
import { Sidebar, type AppNavItem } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { MiniPlayer, PlayerBar, type PlayerExtras, type PlayerLike } from "./PlayerBar";

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

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
    /** 侧栏底部的仓库地址；传了才显示 GitHub 入口 */
    repoUrl?: string;
    /** 播放器单例；跨页面保持播放，桌面显示底栏、移动端显示迷你播放器。 */
    player?: PlayerLike;
    /** 播放器附带的音色切换等控件 */
    playerExtras?: PlayerExtras;
    children: ReactNode;
    /** 是否套用默认页面容器（最大宽度与内边距）。 */
    padded?: boolean;
    /** 手机端去掉页面内边距，让列表贴边。 */
    mobileFlush?: boolean;
    /** 手机端是否显示抽屉导航（默认 true）；底栏已覆盖全部入口时可关掉。 */
    mobileDrawer?: boolean;
    pageClassName?: string;
    /** 兼容旧接口：OreUI 只有深色主题，此参数已无效。 */
    withColorSchemeToggle?: boolean;
}

function Brand({ brand, compact, markOnly }: { brand: BrandConfig; compact?: boolean; markOnly?: boolean }) {
    if (markOnly) {
        return (
            <span
                className="grid h-8 w-8 place-items-center rounded-md bg-[var(--pb-brand-soft)] text-[12px] font-semibold text-[color:var(--pb-primary-light)]"
                title={brand.name}
            >
                {brand.name.slice(0, 1)}
            </span>
        );
    }
    const content = (
        <>
            {brand.mark && (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]">
                    {brand.mark}
                </span>
            )}
            <span className="min-w-0">
                <span className={cx("block font-semibold leading-tight tracking-[-0.02em]", compact ? "text-[13px]" : "text-[14px]")}>
                    {brand.name}
                </span>
                {brand.subtitle && !compact && (
                    <span className="mt-0.5 block truncate text-[10.5px] text-ore-dimmer">{brand.subtitle}</span>
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
    repoUrl,
    player,
    playerExtras,
    children,
    padded = true,
    mobileFlush = false,
    mobileDrawer = true,
    pageClassName,
}: AppLayoutProps) {
    const [mobileOpened, setMobileOpened] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const playerActive = usePlayerActive(player);
    const hasBottomNav = Boolean(bottomNav && bottomNav.length > 0);
    // 底部已承载常用工作区，抽屉只放其余入口与设置，避免两处重复。
    const drawerNav = hasBottomNav
        ? nav.filter((item) => !bottomNav!.some((bottom) => bottom.to === item.to))
        : nav;

    // 移动端底部是固定导航与迷你播放器，正文需要等高的滚动余量。
    const mobilePad = hasBottomNav
        ? playerActive
            ? "h-[calc(128px+env(safe-area-inset-bottom))]"
            : "h-[calc(60px+env(safe-area-inset-bottom))]"
        : playerActive
          ? "h-16"
          : "h-4";
    const desktopPad = playerActive ? "lg:h-[88px]" : "lg:h-6";

    return (
        <div className="flex h-dvh overflow-hidden bg-ore-sunken">
            {/* 桌面侧栏：品牌、导航、次要操作全部收在一条 220px 的列里 */}
            <aside
                className={cx(
                    "hidden shrink-0 border-r border-ore-divider bg-[var(--pb-sidebar)] transition-[width] duration-200 ease-out lg:block",
                    collapsed ? "w-[64px]" : "w-[220px]",
                    playerActive && "lg:pb-[76px]"
                )}
            >
                <div className="h-full overflow-hidden">
                    <Sidebar
                        items={nav}
                        collapsed={collapsed}
                        label={navLabel}
                        footer={sidebarFooter}
                        header={<Brand brand={brand} compact={collapsed} markOnly={collapsed} />}
                        actions={headerActions}
                        repoUrl={repoUrl}
                        onToggleCollapse={() => setCollapsed((value) => !value)}
                    />
                </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* 移动端顶栏：窄、安静，只保留导航与少量操作 */}
                <header className="flex h-12 shrink-0 items-center gap-1 border-b border-ore-divider bg-ore-sunken/95 px-2 lg:hidden">
                    {mobileDrawer && (
                        <button
                            type="button"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            aria-label="打开导航"
                            onClick={() => setMobileOpened(true)}
                        >
                            <MenuIcon size={18} />
                        </button>
                    )}
                    <div className="min-w-0 px-1">
                        <Brand brand={brand} compact />
                    </div>
                    <div className="flex-1" />
                    <div className="flex items-center gap-0.5">{headerActions}</div>
                </header>

                <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                    {padded ? (
                        <div
                            className={cx(
                                "mx-auto flex h-full w-full max-w-[1240px] flex-1 flex-col",
                                mobileFlush ? "p-0" : "px-4 py-4",
                                "md:px-8 md:py-6",
                                pageClassName
                            )}
                        >
                            {children}
                            <div aria-hidden className={cx("shrink-0", mobilePad, desktopPad)} />
                        </div>
                    ) : (
                        children
                    )}
                </main>
            </div>

            {player && <PlayerBar player={player} extras={playerExtras} />}

            {mobileDrawer && mobileOpened && (
                <div
                    className="fixed inset-0 z-50 animate-[pbFadeIn_140ms_ease-out] bg-black/55 lg:hidden"
                    onClick={() => setMobileOpened(false)}
                >
                    <div
                        className="h-full w-[260px] animate-[pbDrawerIn_200ms_ease-out] border-r border-ore-divider bg-[var(--pb-sidebar)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex h-12 items-center justify-between px-3">
                            <Brand brand={brand} compact />
                            <button
                                type="button"
                                className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)]"
                                aria-label="关闭导航"
                                onClick={() => setMobileOpened(false)}
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="h-[calc(100dvh-3rem)] overflow-y-auto">
                            <Sidebar
                                items={drawerNav}
                                label={drawerNav.length > 0 ? "更多" : "设置"}
                                footer={sidebarFooter}
                                actions={headerActions}
                                repoUrl={repoUrl}
                                onNavigate={() => setMobileOpened(false)}
                            />
                        </div>
                    </div>
                </div>
            )}

            {(hasBottomNav || player) && (
                <div className="fixed inset-x-0 bottom-0 z-30 lg:hidden">
                    {player && <MiniPlayer player={player} extras={playerExtras} />}
                    {hasBottomNav && <BottomNav items={bottomNav!} />}
                </div>
            )}
        </div>
    );
}
