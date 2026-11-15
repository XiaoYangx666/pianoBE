import { memo, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout, Button, SongBadge, StatusPill, ThemeToggle, type AppNavItem } from "@piano/ui";
import { AudioWaveform, History, LibraryBig, PackageOpen } from "lucide-react";
import { previewPlayer } from "./player";
import { useGenerator } from "./store/generator";
import { LibraryPage } from "./pages/LibraryPage";
import { AddonPage } from "./pages/AddonPage";
import { ConvertPlaceholderPage } from "./pages/ConvertPlaceholderPage";
import { ChangelogModal } from "./components/ChangelogModal";

// 页面自身订阅 store，App 的局部状态（弹窗、loading、导出中）不应连带重渲染整个页面树
const MemoLibraryPage = memo(LibraryPage);
const MemoAddonPage = memo(AddonPage);
const MemoConvertPlaceholderPage = memo(ConvertPlaceholderPage);

/** 更新日志按钮自带弹窗状态：点开时只重渲染按钮本身，不牵动页面 */
function ChangelogButton() {
    const [opened, setOpened] = useState(false);
    return (
        <>
            <Button type="button" color="secondary" size="sm" title="更新日志" onClick={() => setOpened(true)}>
                <History size={14} />
                <span className="hidden sm:inline">更新日志</span>
            </Button>
            <ChangelogModal opened={opened} onClose={() => setOpened(false)} />
        </>
    );
}

export default function App() {
    const init = useGenerator((state) => state.init);
    const loadingText = useGenerator((state) => state.loadingText);
    const timbres = useGenerator((state) => state.timbres);
    const previewTimbreId = useGenerator((state) => state.previewTimbreId);
    const setPreviewTimbre = useGenerator((state) => state.setPreviewTimbre);
    const { pathname } = useLocation();

    useEffect(() => {
        void init();
    }, [init]);

    const nav: AppNavItem[] = [
        { to: "/", label: "音乐库", icon: <LibraryBig size={18} />, end: true },
        { to: "/addon", label: "附加包制作", icon: <PackageOpen size={18} /> },
        {
            to: "/convert",
            label: "MIDI 转换",
            icon: <AudioWaveform size={18} />,
            disabled: true,
            badge: <SongBadge tone="brand">规划中</SongBadge>,
        },
    ];

    return (
        <>
            <AppLayout
                brand={{ name: "PianoBE", subtitle: "Minecraft 音乐工具", to: "/" }}
                nav={nav}
                navLabel="工作区"
                bottomNav={nav.slice(0, 2)}
                player={previewPlayer}
                playerExtras={{
                    timbres: timbres.map((item) => ({ id: item.id, label: item.label })),
                    timbreId: previewTimbreId,
                    onTimbreChange: (id) => void setPreviewTimbre(id),
                }}
                repoUrl="https://github.com/XiaoYangx666/pianoBE"
                mobileFlush={pathname !== "/convert"}
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
                    <Route path="/convert" element={<MemoConvertPlaceholderPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AppLayout>

            <StatusPill label={loadingText} />
        </>
    );
}
