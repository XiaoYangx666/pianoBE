import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Button } from "@piano/ui";
import { KeyRound, LibraryBig, ListMusic, LogOut } from "lucide-react";
import { AppLayout, ThemeToggle, type AppNavItem } from "@piano/ui";
import { getToken, setToken } from "./api";
import { Login } from "./Login";
import { SongsPage } from "./SongsPage";
import { PlaylistsPage } from "./PlaylistsPage";
import { TokensPage } from "./TokensPage";
import { midiPlayer } from "./midiPlayer";

const brandMark = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="currentColor" opacity="0.92" />
        <path d="M7 5v9M12 5v9M17 5v9" stroke="#243056" strokeWidth="1.9" />
        <path d="M5 17h14" stroke="#243056" strokeWidth="1.6" opacity="0.6" />
    </svg>
);

const nav: AppNavItem[] = [
    { to: "/", label: "曲目库", icon: <LibraryBig size={18} />, end: true },
    { to: "/playlists", label: "播放列表", icon: <ListMusic size={18} /> },
    { to: "/tokens", label: "令牌管理", icon: <KeyRound size={18} /> },
];

export default function App() {
    const [token, setTokenState] = useState<string | null>(getToken());

    if (!token) {
        return (
            <Login
                onLogin={(value) => {
                    setTokenState(value);
                }}
            />
        );
    }

    return (
        <AppLayout
            brand={{ name: "PianoBE", subtitle: "服务端控制台", mark: brandMark, to: "/" }}
            nav={nav}
            navLabel="管理"
            bottomNav={nav}
            player={midiPlayer}
            headerActions={
                <>
                    <ThemeToggle />
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        title="退出登录"
                        onClick={() => {
                            setToken(null);
                            setTokenState(null);
                        }}
                    >
                        <LogOut size={14} />
                        <span className="hidden sm:inline">退出</span>
                    </Button>
                </>
            }
            sidebarFooter={
                <div>
                    <div>PianoBE 服务端</div>
                    <div>曲目、播放列表与令牌管理</div>
                </div>
            }
        >
            <Routes>
                <Route path="/" element={<SongsPage />} />
                <Route path="/playlists" element={<PlaylistsPage />} />
                <Route path="/tokens" element={<TokensPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </AppLayout>
    );
}
