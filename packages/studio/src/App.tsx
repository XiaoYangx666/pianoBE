import { useEffect, useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AudioWaveform, Boxes, HardDrive, LogOut, Music2, PackageCheck, Server } from "lucide-react";
import { AppLayout, PianoMark, Spinner, ThemeToggle, type AppNavItem } from "@piano/ui";
import { studioPlayer } from "./audio/player";
import { LoginView } from "./components/LoginView";
import { AddonPage } from "./pages/AddonPage";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ToolsPage } from "./pages/ToolsPage";
import { useStudio } from "./store/studio";

export default function App() {
    const initialized = useStudio((s) => s.initialized);
    const loading = useStudio((s) => s.loading);
    const mode = useStudio((s) => s.mode);
    const serverAvailable = useStudio((s) => s.serverAvailable);
    const authRequired = useStudio((s) => s.authRequired);
    const authenticated = useStudio((s) => s.authenticated);
    const songsCount = useStudio((s) => s.songs.length);
    const pluginsCount = useStudio((s) => s.plugins.length);

    const init = useStudio((s) => s.init);
    const switchMode = useStudio((s) => s.switchMode);
    const loginServer = useStudio((s) => s.loginServer);
    const logoutServer = useStudio((s) => s.logoutServer);

    useEffect(() => {
        void init();
    }, [init]);

    const nav = useMemo<AppNavItem[]>(
        () => [
            { to: "/", end: true, label: "音乐库", icon: <Music2 size={16} />, badge: songsCount },
            { to: "/extensions", label: "扩展中心", icon: <Boxes size={16} />, badge: pluginsCount },
            { to: "/tools", label: "音乐工具", icon: <AudioWaveform size={16} /> },
            {
                to: "/addon",
                label: "附加包",
                icon: mode === "server" ? <Server size={16} /> : <PackageCheck size={16} />,
            },
        ],
        [songsCount, pluginsCount, mode],
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
            player={studioPlayer}
            headerActions={<ThemeToggle />}
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
            <Routes>
                <Route path="/" element={<LibraryPage />} />
                <Route path="/extensions" element={<ExtensionsPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/addon" element={<AddonPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </AppLayout>
    );
}
