import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { KeyRound, LibraryBig, LogOut, AudioWaveform } from "lucide-react";
import { PIANO_TIMBRES } from "@piano/core";
import { AppLayout, IconButton, PianoMark, ThemeToggle, type AppNavItem } from "@piano/ui";
import { getToken, setToken } from "./api";
import { Login } from "./Login";
import { SongsPage } from "./SongsPage";
import { TokensPage } from "./TokensPage";
import { TranscribePage } from "./TranscribePage";
import { appPlayer, midiPlayer } from "./midiPlayer";

const nav: AppNavItem[] = [
    { to: "/", label: "曲目库", icon: <LibraryBig size={18} />, end: true },
    { to: "/transcribe", label: "音频转 MIDI", icon: <AudioWaveform size={18} /> },
    { to: "/tokens", label: "令牌管理", icon: <KeyRound size={18} /> },
];

export default function App() {
    const [token, setTokenState] = useState<string | null>(getToken());

    // 与生成器共用同一套播放偏好：响度归一化开关的 localStorage key 一致
    const [normalizeLoudness, setNormalizeLoudness] = useState(() => {
        try {
            return localStorage.getItem("pbe:normalize-loudness") === "1";
        } catch {
            return false;
        }
    });
    const [timbreId, setTimbreId] = useState(() => {
        try {
            const saved = localStorage.getItem("pbe:preview-timbre");
            if (saved && PIANO_TIMBRES.some((item) => item.id === saved)) return saved;
        } catch {
            // 隐私模式下 localStorage 可能不可用
        }
        return PIANO_TIMBRES[0].id;
    });

    useEffect(() => {
        midiPlayer.setNormalizeLoudness(normalizeLoudness);
        try {
            localStorage.setItem("pbe:normalize-loudness", normalizeLoudness ? "1" : "0");
        } catch {
            // 忽略持久化失败
        }
    }, [normalizeLoudness]);

    useEffect(() => {
        const meta = PIANO_TIMBRES.find((item) => item.id === timbreId) ?? PIANO_TIMBRES[0];
        midiPlayer.setTimbre(meta.value);
        try {
            localStorage.setItem("pbe:preview-timbre", meta.id);
        } catch {
            // 忽略持久化失败
        }
    }, [timbreId]);

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
            player={appPlayer}
            playerExtras={{
                timbres: PIANO_TIMBRES.map((item) => ({ id: item.id, label: item.label })),
                timbreId,
                onTimbreChange: setTimbreId,
                normalize: { enabled: normalizeLoudness, onToggle: setNormalizeLoudness },
            }}
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
                    <div>曲目与令牌管理</div>
                </div>
            }
        >
            <Routes>
                <Route path="/" element={<SongsPage />} />
                <Route path="/transcribe" element={<TranscribePage />} />
                <Route path="/tokens" element={<TokensPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </AppLayout>
    );
}
