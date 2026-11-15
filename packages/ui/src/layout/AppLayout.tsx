import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
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
    /** 手机端去掉页面内边距，让内容贴边（列表页更省空间）。 */
    mobileFlush?: boolean;
    pageClassName?: string;
    /** 兼容旧接口：OreUI 只有深色主题，此参数已无效。 */
    withColorSchemeToggle?: boolean;
}

function Brand({ brand }: { brand: BrandConfig }) {
    const content = (
        <>
            {brand.mark && (
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#6b8afd] to-[#3f5edb] text-white">
                    {brand.mark}
                </span>
            )}
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
    repoUrl,
    player,
    playerExtras,
    children,
    padded = true,
    mobileFlush = false,
    pageClassName,
}: AppLayoutProps) {
    const [mobileOpened, setMobileOpened] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const playerActive = usePlayerActive(player);
    const hasBottomNav = Boolean(bottomNav && bottomNav.length > 0);

    // 移动端底部是 fixed 的迷你播放器 + 导航，正文必须留出等高的内边距，
    // 否则最后一行会被压住。桌面端只需避开 72px 的播放条。
    const mobilePad = hasBottomNav
        ? playerActive
            ? "pb-[calc(136px+env(safe-area-inset-bottom))]"
            : "pb-[calc(64px+env(safe-area-inset-bottom))]"
        : playerActive
          ? "pb-[64px]"
          : "pb-4";
    const desktopPad = playerActive ? "md:pb-[104px]" : "md:pb-6";

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-ore-sunken">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ore-divider bg-ore-raised/95 px-3 backdrop-blur md:px-4">
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
                    className={cx(
                        "hidden shrink-0 overflow-hidden border-r border-ore-divider bg-ore-raised transition-[width] duration-200 ease-out md:block",
                        collapsed ? "w-16" : "w-[216px]"
                    )}
                >
                    <div className="sticky top-0 h-full overflow-y-auto">
                        <Sidebar
                            items={nav}
                            collapsed={collapsed}
                            label={navLabel}
                            footer={sidebarFooter}
                            repoUrl={repoUrl}
                        />
                    </div>
                </aside>

                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                    {padded ? (
                        <div
                            className={cx(
                                "mx-auto flex min-h-0 w-full max-w-[1360px] flex-1 flex-col md:p-6",
                                mobileFlush ? "p-0" : "p-4",
                                pageClassName
                            )}
                        >
                            {children}
                            {/* 底部播放器/导航是 fixed 的，用真实占位块撑出滚动空间 */}
                            <div aria-hidden className={cx("shrink-0", mobilePad, desktopPad)} />
                        </div>
                    ) : (
                        children
                    )}
                </main>
            </div>

            {player && <PlayerBar player={player} extras={playerExtras} />}

            {mobileOpened && (
                <div
                    className="fixed inset-0 z-50 animate-[pbFadeIn_140ms_ease-out] bg-black/60 md:hidden"
                    onClick={() => setMobileOpened(false)}
                >
                    <div
                        className="h-full w-[248px] animate-[pbDrawerIn_200ms_ease-out] border-r border-ore-divider bg-ore-raised"
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
                                repoUrl={repoUrl}
                                onNavigate={() => setMobileOpened(false)}
                            />
                        </div>
                    </div>
                </div>
            )}

            {(hasBottomNav || player) && (
                <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
                    {player && <MiniPlayer player={player} extras={playerExtras} />}
                    {hasBottomNav && <BottomNav items={bottomNav!} />}
                </div>
            )}
        </div>
    );
}
