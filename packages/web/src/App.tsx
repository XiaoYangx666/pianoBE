import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { KeyRound, LibraryBig, ListMusic, LogOut, FlaskConical, AudioWaveform } from "lucide-react";
import { AppLayout, IconButton, PianoMark, ThemeToggle, type AppNavItem } from "@piano/ui";
import { getToken, setToken } from "./api";
import { Login } from "./Login";
import { SongsPage } from "./SongsPage";
import { PlaylistsPage } from "./PlaylistsPage";
import { TokensPage } from "./TokensPage";
import { AudioLabPage } from "./audioLab/AudioLabPage";
import { TranscribePage } from "./TranscribePage";
import { midiPlayer } from "./midiPlayer";

const nav: AppNavItem[] = [
    { to: "/", label: "曲目库", icon: <LibraryBig size={18} />, end: true },
    { to: "/transcribe", label: "音频转 MIDI", icon: <AudioWaveform size={18} /> },
    { to: "/playlists", label: "播放列表", icon: <ListMusic size={18} /> },
    { to: "/tokens", label: "令牌管理", icon: <KeyRound size={18} /> },
    { to: "/lab", label: "音频实验室", icon: <FlaskConical size={18} /> },
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
            brand={{
                name: "PianoBE",
                subtitle: "服务端控制台",
                to: "/",
                mark: <PianoMark size={17} />,
            }}
            nav={nav}
            navLabel="管理"
            bottomNav={nav}
            player={midiPlayer}
            repoUrl="https://github.com/XiaoYangx666/pianoBE"
            headerActions={
                <>
                    <ThemeToggle />
                    <IconButton
                        type="button"
                        title="退出登录"
                        aria-label="退出登录"
                        onClick={() => {
                            setToken(null);
                            setTokenState(null);
                        }}
                    >
                        <LogOut size={15} />
                    </IconButton>
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
                <Route path="/transcribe" element={<TranscribePage />} />
                <Route path="/playlists" element={<PlaylistsPage />} />
                <Route path="/tokens" element={<TokensPage />} />
                <Route path="/lab" element={<AudioLabPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </AppLayout>
    );
}
