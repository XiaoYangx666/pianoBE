import { memo, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout, PianoMark, StatusPill, ThemeToggle, type AppNavItem } from "@piano/ui";
import { AudioWaveform, Info, LibraryBig, PackageOpen } from "lucide-react";
import { appPlayer, previewPlayer } from "./music/player";
import { useGenerator } from "./store/generator";
import { LibraryPage } from "./pages/LibraryPage";
import { AddonPage } from "./pages/AddonPage";
import { AboutPage } from "./pages/AboutPage";
import { ConvertPage } from "./pages/ConvertPage";
import { ChangelogButton } from "./components/ChangelogButton";

// 页面自身订阅 store，App 的局部状态（弹窗、loading、导出中）不应连带重渲染整个页面树
const MemoLibraryPage = memo(LibraryPage);
const MemoAddonPage = memo(AddonPage);
const MemoAboutPage = memo(AboutPage);
const MemoConvertPage = memo(ConvertPage);

export default function App() {
    const init = useGenerator((state) => state.init);
    const loadingText = useGenerator((state) => state.loadingText);
    const timbres = useGenerator((state) => state.timbres);
    const previewTimbreId = useGenerator((state) => state.previewTimbreId);
    const setPreviewTimbre = useGenerator((state) => state.setPreviewTimbre);

    const [normalizeLoudness, setNormalizeLoudness] = useState(() => {
        try {
            return localStorage.getItem("pbe:normalize-loudness") === "1";
        } catch {
            return false;
        }
    });

    useEffect(() => {
        previewPlayer.setNormalizeLoudness(normalizeLoudness);
        try {
            localStorage.setItem("pbe:normalize-loudness", normalizeLoudness ? "1" : "0");
        } catch {
            // 隐私模式下 localStorage 可能不可用，不影响播放。
        }
    }, [normalizeLoudness]);

    useEffect(() => {
        void init();
    }, [init]);

    const nav: AppNavItem[] = [
        { to: "/", label: "音乐库", icon: <LibraryBig size={18} />, end: true },
        { to: "/addon", label: "附加包制作", icon: <PackageOpen size={18} /> },
        {
            to: "/convert",
            label: "音频转 MIDI",
            icon: <AudioWaveform size={18} />,
        },
        { to: "/about", label: "关于", icon: <Info size={18} /> },
    ];

    return (
        <>
            <AppLayout
                brand={{
                    name: "PianoBE",
                    subtitle: "Minecraft 音乐工具",
                    to: "/",
                    mark: <PianoMark size={17} />,
                }}
                nav={nav}
                navLabel="工作区"
                bottomNav={[
                    nav[0],
                    nav[1],
                    nav[2],
                    nav[3],
                ]}
                mobileDrawer={false}
                player={appPlayer}
                playerExtras={{
                    timbres: timbres.map((item) => ({ id: item.id, label: item.label })),
                    timbreId: previewTimbreId,
                    onTimbreChange: (id) => void setPreviewTimbre(id),
                    normalize: { enabled: normalizeLoudness, onToggle: setNormalizeLoudness },
                }}
                repoUrl="https://github.com/XiaoYangx666/pianoBE"
                mobileFlush
                headerActions={
                    <>
                        <ThemeToggle />
                        <ChangelogButton />
                    </>
                }
                sidebarFooter={
                    <div>
                        <div>PianoBE · Minecraft 钢琴</div>
                        <div>MIDI 曲库与附加包制作</div>
                    </div>
                }
            >
                <Routes>
                    <Route path="/" element={<MemoLibraryPage />} />
                    <Route path="/addon" element={<MemoAddonPage />} />
                    <Route path="/about" element={<MemoAboutPage />} />
                    <Route path="/convert" element={<MemoConvertPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AppLayout>

            <StatusPill label={loadingText} />
        </>
    );
}
