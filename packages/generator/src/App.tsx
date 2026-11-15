import { memo, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Button } from "@piano/ui";
import { AudioWaveform, Download, History, LibraryBig, PackageOpen } from "lucide-react";
import { AppLayout, SongBadge, StatusPill, ThemeToggle, type AppNavItem } from "@piano/ui";
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

const brandMark = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="currentColor" opacity="0.92" />
        <path d="M7 5v9M12 5v9M17 5v9" stroke="#243056" strokeWidth="1.9" />
        <path d="M4 14h16" stroke="#243056" strokeWidth="1.4" opacity="0.55" />
    </svg>
);

export default function App() {
    const init = useGenerator((state) => state.init);
    const loadingText = useGenerator((state) => state.loadingText);
    const template = useGenerator((state) => state.template);
    const exporting = useGenerator((state) => state.exporting);
    const exportAddon = useGenerator((state) => state.exportAddon);

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
                brand={{ name: "PianoBE", subtitle: "Minecraft 音乐工具", mark: brandMark, to: "/" }}
                nav={nav}
                navLabel="工作区"
                bottomNav={nav.slice(0, 2)}
                player={previewPlayer}
                headerActions={
                    <>
                        <ThemeToggle />
                        <ChangelogButton />
                        <Button
                            type="button"
                            size="sm"
                            loading={exporting}
                            disabled={!template || exporting}
                            onClick={() => void exportAddon()}
                        >
                            <Download size={14} />
                            <span className="hidden sm:inline">导出附加包</span>
                        </Button>
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
