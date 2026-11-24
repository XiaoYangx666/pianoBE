import { Suspense, lazy, useEffect, useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AudioWaveform, Boxes, HardDrive, LogOut, Music2, PackageCheck, Server } from "lucide-react";
import { PIANO_TIMBRES } from "@piano/core";
import { AppLayout, PianoMark, Spinner, ThemeToggle, type AppNavItem } from "@piano/ui";
import { studioPlayer } from "./audio/player";
import { LoginView } from "./components/LoginView";
import { useStudio } from "./store/studio";

// 路由级懒加载：四个工作台页面各自成 chunk，首屏不再一次性加载
// 音乐库 / 扩展中心 / 音乐工具 / 附加包里的大依赖（pdf、onnx 等）。
const LibraryPage = lazy(() =>
    import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })),
);
const ExtensionsPage = lazy(() =>
    import("./pages/ExtensionsPage").then((m) => ({ default: m.ExtensionsPage })),
);
const ToolsPage = lazy(() => import("./pages/ToolsPage").then((m) => ({ default: m.ToolsPage })));
const AddonPage = lazy(() => import("./pages/AddonPage").then((m) => ({ default: m.AddonPage })));

export default function App() {
    const initialized = useStudio((s) => s.initialized);
    const loading = useStudio((s) => s.loading);
    const mode = useStudio((s) => s.mode);
    const serverAvailable = useStudio((s) => s.serverAvailable);
    const authRequired = useStudio((s) => s.authRequired);
    const authenticated = useStudio((s) => s.authenticated);
    const songsCount = useStudio((s) => s.songs.length);
    const installedPluginsCount = useStudio((s) => s.plugins.filter((p) => p.installed).length);
    const timbreIndex = useStudio((s) => s.timbreIndex);
    const installedTimbreIds = useStudio((s) => s.installedTimbreIds);
    const previewTimbreId = useStudio((s) => s.previewTimbreId);
    const normalizeLoudness = useStudio((s) => s.normalizeLoudness);

    const init = useStudio((s) => s.init);
    const switchMode = useStudio((s) => s.switchMode);
    const loginServer = useStudio((s) => s.loginServer);
    const logoutServer = useStudio((s) => s.logoutServer);
    const setPreviewTimbre = useStudio((s) => s.setPreviewTimbre);
    const setNormalizeLoudness = useStudio((s) => s.setNormalizeLoudness);

    useEffect(() => {
        void init();
    }, [init]);

    const playerTimbres = useMemo(() => {
        const installedSet = new Set(["piano", ...(installedTimbreIds ?? [])]);
        const filtered = timbreIndex
            .filter((item) => item.bundled || installedSet.has(item.id))
            .map((item) => ({
                id: item.id,
                label: item.label,
            }));
        return filtered.length > 0
            ? filtered
            : [{ id: PIANO_TIMBRES[0].id, label: PIANO_TIMBRES[0].label }];
    }, [timbreIndex, installedTimbreIds]);

    const nav = useMemo<AppNavItem[]>(
        () => [
            { to: "/", end: true, label: "音乐库", icon: <Music2 size={16} />, badge: songsCount },
            {
                to: "/extensions",
                label: "扩展中心",
                icon: <Boxes size={16} />,
                badge: installedPluginsCount,
            },
            { to: "/tools", label: "音乐工具", icon: <AudioWaveform size={16} /> },
            {
                to: "/addon",
                label: "附加包",
                icon: mode === "server" ? <Server size={16} /> : <PackageCheck size={16} />,
            },
        ],
        [songsCount, installedPluginsCount, mode],
    );

    if (!initialized && loading) {
        return (
            <div className="grid min-h-dvh place-items-center bg-ore-sunken text-ore-dim">
                <div className="flex flex-col items-center gap-3">
                    <Spinner size={24} />
                    <span className="text-[13px]">正在初始化 PianoBE Studio...</span>
                </div>
            </div>
        );
    }

    if (mode === "server" && authRequired && !authenticated) {
        return (
            <LoginView
                onLogin={loginServer}
                onUseLocal={() => void switchMode("local")}
            />
        );
    }

    return (
        <AppLayout
            brand={{
                name: "PianoBE Studio",
                subtitle: mode === "server" ? "服务器管理模式" : "本地工作区模式",
                mark: <PianoMark size={15} />,
                to: "/",
            }}
            nav={nav}
            bottomNav={nav}
            mobileDrawer={false}
            player={studioPlayer}
            playerExtras={{
                timbres: playerTimbres,
                timbreId: previewTimbreId,
                onTimbreChange: (id) => void setPreviewTimbre(id),
                normalize: {
                    enabled: normalizeLoudness,
                    onToggle: setNormalizeLoudness,
                },
            }}
            headerActions={
                <div className="flex items-center gap-1.5">
                    {serverAvailable && (
                        <button
                            type="button"
                            onClick={() => void switchMode(mode === "server" ? "local" : "server")}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-ore-border bg-ore-raised px-2 text-[11.5px] font-medium text-ore-dim hover:text-ore-text md:hidden"
                            title={mode === "server" ? "切换到本地模式" : "切换到服务器模式"}
                        >
                            {mode === "server" ? <Server size={13} /> : <HardDrive size={13} />}
                            <span>{mode === "server" ? "服务器" : "本地"}</span>
                        </button>
                    )}
                    {mode === "server" && authenticated && (
                        <button
                            type="button"
                            onClick={() => void logoutServer()}
                            aria-label="退出登录"
                            title="退出登录"
                            className="grid h-8 w-8 place-items-center rounded-md border border-ore-border bg-ore-raised text-ore-dim hover:text-ore-text md:hidden"
                        >
                            <LogOut size={14} />
                        </button>
                    )}
                    <ThemeToggle />
                </div>
            }
            sidebarFooter={
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between rounded-md border border-ore-divider bg-ore-raised px-2.5 py-1.5 text-[11.5px]">
                        <span className="flex items-center gap-1.5 text-ore-dim">
                            {mode === "server" ? <Server size={13} /> : <HardDrive size={13} />}
                            {mode === "server" ? "服务器模式" : "本地模式"}
                        </span>
                        {serverAvailable && (
                            <button
                                type="button"
                                onClick={() => void switchMode(mode === "server" ? "local" : "server")}
                                className="font-medium text-brand hover:underline"
                            >
                                切换{mode === "server" ? "本地" : "服务器"}
                            </button>
                        )}
                    </div>
                    {mode === "server" && authenticated && (
                        <button
                            type="button"
                            onClick={() => void logoutServer()}
                            className="flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                        >
                            <LogOut size={14} /> 退出登录
                        </button>
                    )}
                </div>
            }
        >
            <Suspense
                fallback={
                    <div className="grid min-h-[45vh] place-items-center text-ore-dim">
                        <div className="flex flex-col items-center gap-3">
                            <Spinner size={22} />
                            <span className="text-[12.5px]">正在加载页面…</span>
                        </div>
                    </div>
                }
            >
                <Routes>
                    <Route path="/" element={<LibraryPage />} />
                    <Route path="/extensions" element={<ExtensionsPage />} />
                    <Route path="/tools" element={<ToolsPage />} />
                    <Route path="/addon" element={<AddonPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
        </AppLayout>
    );
}
