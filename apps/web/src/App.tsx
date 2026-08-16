import { useState } from "react";
import { getToken, setToken } from "./api";
import { Login } from "./Login";
import { SongsPage } from "./SongsPage";
import { PlaylistsPage } from "./PlaylistsPage";
import { TokensPage } from "./TokensPage";

type Tab = "songs" | "playlists" | "tokens";

export default function App() {
    const [token, setTokenState] = useState<string | null>(getToken());
    const [tab, setTab] = useState<Tab>("songs");

    if (!token) {
        return (
            <Login
                onLogin={(t) => {
                    setTokenState(t);
                }}
            />
        );
    }

    return (
        <div className="app">
            <header>
                <h1>🎹 PianoBE 曲库管理</h1>
                <nav>
                    <button className={tab === "songs" ? "active" : ""} onClick={() => setTab("songs")}>
                        曲库
                    </button>
                    <button className={tab === "playlists" ? "active" : ""} onClick={() => setTab("playlists")}>
                        播放列表
                    </button>
                    <button className={tab === "tokens" ? "active" : ""} onClick={() => setTab("tokens")}>
                        令牌管理
                    </button>
                    <button
                        className="logout"
                        onClick={() => {
                            setToken(null);
                            setTokenState(null);
                        }}
                    >
                        退出
                    </button>
                </nav>
            </header>
            <main>
                {tab === "songs" && <SongsPage />}
                {tab === "playlists" && <PlaylistsPage />}
                {tab === "tokens" && <TokensPage />}
            </main>
        </div>
    );
}