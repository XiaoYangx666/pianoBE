import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    Check,
    CloudDownload,
    FolderPlus,
    Library as LibraryIcon,
    ListPlus,
    Loader2,
    Music2,
    Package,
    Pause,
    Pencil,
    Play,
    Plus,
    Search,
    Sparkles,
    Trash2,
    Upload,
} from "lucide-react";
import { PLAIN_PERFORMANCE_ID, TIME_SCALE, type LibraryRecord } from "@piano/core";
import {
    Button,
    ConfirmDialog,
    Dialog,
    EmptyState,
    FileDropzone,
    ImportCodeDialog,
    PageHeader,
    Segmented,
    SongBadge,
    SongRow,
    Textfield,
    notify,
    usePlayerState,
} from "@piano/ui";
import { fetchOfficialSongBytes } from "../adapters/localAdapter";
import type { StudioSong } from "../adapters/types";
import { studioPlayer } from "../audio/player";
import { RenameSongDialog } from "../components/RenameSongDialog";
import { SongDetailDialog } from "../components/SongDetailDialog";
import { useStudio } from "../store/studio";

function formatDuration(scaled: number): string {
    const sec = Math.max(0, Math.floor(scaled / TIME_SCALE));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/**
 * 轻量虚拟列表：只渲染可视区附近的曲目行。
 * 整库（数百首）时避免每次状态变化都重排全部 SongRow。
 */
function VirtualSongList({
    count,
    rowHeight = 54,
    overscan = 5,
    children,
}: {
    count: number;
    rowHeight?: number;
    overscan?: number;
    children: (index: number) => ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [range, setRange] = useState(() => ({
        start: 0,
        end: Math.min(count, 24),
    }));

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const scroller = el.closest("main") as HTMLElement | null;
        const target: HTMLElement | Window = scroller ?? window;
        let raf = 0;

        const update = () => {
            raf = 0;
            const rect = el.getBoundingClientRect();
            const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
            const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
            const offset = Math.max(0, viewTop - rect.top);
            const start = Math.max(0, Math.min(count - 1, Math.floor(offset / rowHeight) - overscan));
            const end = Math.max(
                start + 1,
                Math.min(count, Math.ceil((offset + viewHeight) / rowHeight) + overscan),
            );
            setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(update);
        };

        update();
        target.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        const observer = scroller ? new ResizeObserver(onScroll) : null;
        if (observer && scroller) observer.observe(scroller);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            target.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            observer?.disconnect();
        };
    }, [count, rowHeight, overscan]);

    const safeStart = Math.min(range.start, Math.max(0, count - 1));
    const safeEnd = Math.min(range.end, count);

    return (
        <div ref={ref} className="relative" style={{ height: count * rowHeight }}>
            {Array.from({ length: Math.max(0, safeEnd - safeStart) }, (_, i) => safeStart + i).map((index) => (
                <div
                    key={index}
                    className="absolute inset-x-0"
                    style={{ top: index * rowHeight, height: rowHeight }}
                >
                    {children(index)}
                </div>
            ))}
        </div>
    );
}

export function LibraryPage() {
    const mode = useStudio((s) => s.mode);
    const songs = useStudio((s) => s.songs);
    const libraries = useStudio((s) => s.libraries);
    const officialCatalog = useStudio((s) => s.officialCatalog);
    const plugins = useStudio((s) => s.plugins);
    const selectedSongIds = useStudio((s) => s.selectedSongIds);
    const busy = useStudio((s) => s.busy);
    const importProgress = useStudio((s) => s.importProgress);

    const importFiles = useStudio((s) => s.importFiles);
    const importOfficialSongs = useStudio((s) => s.importOfficialSongs);
    const importOfficialCollection = useStudio((s) => s.importOfficialCollection);
    const createLibrary = useStudio((s) => s.createLibrary);
    const renameLibrary = useStudio((s) => s.renameLibrary);
    const deleteLibrary = useStudio((s) => s.deleteLibrary);
    const addSongsToLibrary = useStudio((s) => s.addSongsToLibrary);
    const removeSongFromLibrary = useStudio((s) => s.removeSongFromLibrary);
    const exportLibraryPlugin = useStudio((s) => s.exportLibraryPlugin);
    const renameSong = useStudio((s) => s.renameSong);
    const deleteSong = useStudio((s) => s.deleteSong);
    const deletePerformance = useStudio((s) => s.deletePerformance);
    const getSongBytes = useStudio((s) => s.getSongBytes);
    const getImportCode = useStudio((s) => s.getImportCode);
    const toggleSongInAddon = useStudio((s) => s.toggleSongInAddon);

    const [viewTab, setViewTab] = useState<"mine" | "official">("mine");
    const [activeLibId, setActiveLibId] = useState<string>("all");
    const [officialCatId, setOfficialCatId] = useState<string>("featured-performances");
    const [query, setQuery] = useState("");
    const [playingId, setPlayingId] = useState<string | null>(null);

    const [detailSong, setDetailSong] = useState<StudioSong | null>(null);
    const [renameTarget, setRenameTarget] = useState<StudioSong | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<StudioSong | null>(null);
    const [codeDialog, setCodeDialog] = useState<{
        name: string;
        chunks: string[];
        bytes: number;
    } | null>(null);

    const [newLibOpen, setNewLibOpen] = useState(false);
    const [newLibName, setNewLibName] = useState("");
    const [renameLibTarget, setRenameLibTarget] = useState<LibraryRecord | null>(null);
    const [deleteLibTarget, setDeleteLibTarget] = useState<LibraryRecord | null>(null);
    const [assignSong, setAssignSong] = useState<StudioSong | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const playerState = usePlayerState(studioPlayer);

    const existingSongIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);

    const filteredSongs = useMemo(() => {
        const q = query.trim().toLowerCase();
        return songs.filter((song) => {
            if (activeLibId !== "all") {
                const lib = libraries.find((l) => l.id === activeLibId);
                const inLib =
                    song.libraries?.includes(activeLibId) || lib?.songIds.includes(song.id);
                if (!inLib) return false;
            }
            if (!q) return true;
            return (
                song.name.toLowerCase().includes(q) ||
                song.id.toLowerCase().includes(q) ||
                Boolean(song.aliases?.some((a) => a.toLowerCase().includes(q)))
            );
        });
    }, [songs, activeLibId, libraries, query]);

    const officialSongs = useMemo(() => {
        if (!officialCatalog) return [];
        const q = query.trim().toLowerCase();
        const col = officialCatalog.collections.find((c) => c.id === officialCatId);
        const allowSet =
            officialCatId === "all" ? null : new Set(col?.songIds ?? []);
        return officialCatalog.songs.filter((s) => {
            if (allowSet && !allowSet.has(s.id)) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
        });
    }, [officialCatalog, officialCatId, query]);

    const activeLibrary = libraries.find((l) => l.id === activeLibId) ?? null;

    const activeOfficialCollection = useMemo(() => {
        if (!officialCatalog) return null;
        if (officialCatId === "all") {
            return {
                id: "all",
                name: "完整曲库",
                description: "在线曲库中的全部曲目",
                count: officialCatalog.songs.length,
            };
        }
        const col = officialCatalog.collections.find((c) => c.id === officialCatId);
        return col ? { ...col, count: col.songIds.length } : null;
    }, [officialCatalog, officialCatId]);

    const handlePlay = async (id: string, name: string, load: () => Promise<Uint8Array>) => {
        setPlayingId(id);
        try {
            await studioPlayer.toggleSong(id, name, load, "pbe3");
        } catch (err) {
            notify({
                title: "试听失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setPlayingId(null);
        }
    };

    const handleOpenCode = async (song: StudioSong) => {
        try {
            const res = await getImportCode(song.id);
            setCodeDialog(res);
        } catch (err) {
            notify({
                title: "生成导入码失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const handleDownloadPbe3 = async (song: StudioSong) => {
        try {
            const bytes = await getSongBytes(song.id);
            const blob = new Blob([bytes.slice().buffer], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${song.name}.pbe3`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            notify({
                title: "导出 PBE3 失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                eyebrow={mode === "server" ? "Server Music Catalog" : "Local Music Workspace"}
                title="音乐库"
                description="统一管理歌曲本体、独立演出编排与逻辑曲库，支持导入 MIDI / PBE3 / .pbeplugin 与在线曲库。"
                actions={
                    <div className="flex flex-wrap gap-2">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".mid,.midi,.pbe3,.pbeplugin"
                            multiple
                            hidden
                            onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                e.target.value = "";
                                if (files.length > 0) {
                                    void importFiles(
                                        files,
                                        activeLibId !== "all" ? activeLibId : undefined,
                                    );
                                }
                            }}
                        />
                        <Button
                            type="button"
                            color="secondary"
                            size="sm"
                            onClick={() => {
                                setNewLibName("");
                                setNewLibOpen(true);
                            }}
                        >
                            <FolderPlus size={14} /> 新建曲库
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            loading={busy}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload size={14} /> 导入 MIDI / PBE3 / 插件
                        </Button>
                    </div>
                }
            />

            {importProgress && (
                <div className="rounded-lg border border-ore-border bg-ore-raised px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-3 text-[12px]">
                        <span className="text-ore-dim">{importProgress.label}</span>
                        <span className="tabular-nums text-ore-dim">
                            {importProgress.done} / {importProgress.total}
                        </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ore-sunken">
                        <div
                            className="h-full rounded-full bg-brand transition-[width] duration-200"
                            style={{
                                width: `${importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0}%`,
                            }}
                        />
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                    value={viewTab}
                    onChange={(v) => setViewTab(v as "mine" | "official")}
                    options={[
                        {
                            value: "mine",
                            label: mode === "server" ? "服务器曲库" : "我的曲库",
                            count: songs.length,
                        },
                        {
                            value: "official",
                            label: "在线曲库",
                            count: officialCatalog?.totalSongs ?? 0,
                        },
                    ]}
                />

                <div className="relative w-full sm:w-[260px]">
                    <Search
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ore-dimmer"
                    />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索曲名 / 别名 / ID..."
                        className="h-8 w-full rounded-md border border-[var(--pb-control-border)] bg-ore-raised pl-8 pr-3 text-[12.5px] text-ore-text outline-none focus:border-brand"
                    />
                </div>
            </div>

            <p className="text-[12px] leading-5 text-ore-dim">
                {viewTab === "mine"
                    ? "「我的曲库」是已经保存到本地的曲目：左侧勾选决定是否打包进附加包，下方标签按曲库集合筛选。"
                    : "「在线曲库」是随应用分发的曲目目录，分类按曲名自动推断、仅供检索；点击「添加」后才会写入我的曲库。"}
            </p>

            {viewTab === "mine" ? (
                <>
                    {/* 曲库逻辑集合标签栏 */}
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setActiveLibId("all")}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                                activeLibId === "all"
                                    ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                    : "border-ore-border bg-ore-raised text-ore-dim hover:text-ore-text"
                            }`}
                        >
                            <LibraryIcon size={13} /> 全部 ({songs.length})
                        </button>
                        {libraries.map((lib) => {
                            const count = songs.filter(
                                (s) => s.libraries?.includes(lib.id) || lib.songIds.includes(s.id),
                            ).length;
                            const active = activeLibId === lib.id;
                            return (
                                <button
                                    key={lib.id}
                                    type="button"
                                    onClick={() => setActiveLibId(lib.id)}
                                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                                        active
                                            ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                            : "border-ore-border bg-ore-raised text-ore-dim hover:text-ore-text"
                                    }`}
                                >
                                    <span>{lib.name}</span>
                                    <span className="text-[11px] opacity-75">({count})</span>
                                    {lib.kind === "plugin" && (
                                        <span className="text-[10px] opacity-65">· 插件</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {activeLibrary && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ore-border bg-ore-raised px-3.5 py-2.5 text-[12px]">
                            <div className="min-w-0">
                                <span className="font-semibold">{activeLibrary.name}</span>
                                {activeLibrary.description && (
                                    <span className="ml-2 text-ore-dim">{activeLibrary.description}</span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <Button
                                    type="button"
                                    color="secondary"
                                    size="sm"
                                    onClick={() => void exportLibraryPlugin(activeLibrary.id)}
                                >
                                    <Package size={13} /> 导出为 .pbeplugin
                                </Button>
                                {!activeLibrary.readonly && (
                                    <>
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={() => setRenameLibTarget(activeLibrary)}
                                        >
                                            <Pencil size={13} /> 改名
                                        </Button>
                                        {activeLibrary.id !== "default" && activeLibrary.id !== "user-default" && (
                                            <Button
                                                type="button"
                                                color="ghost"
                                                size="sm"
                                                onClick={() => setDeleteLibTarget(activeLibrary)}
                                            >
                                                <Trash2 size={13} /> 删除曲库
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <FileDropzone
                        accept={[".mid", ".midi", ".pbe3", ".pbeplugin"]}
                        multiple
                        title="导入曲目或扩展"
                        description="拖拽 .mid / .pbe3 / .pbeplugin 到此处，相同音乐会自动复用本体并叠加演出编排"
                        onDrop={(files) =>
                            void importFiles(
                                files,
                                activeLibId !== "all" ? activeLibId : undefined,
                            )
                        }
                    />

                    {filteredSongs.length === 0 ? (
                        <EmptyState
                            icon={<Music2 size={24} />}
                            title="暂无曲目"
                            description="点击上方导入文件，或切换到「在线曲库」按分类挑选曲目。"
                        />
                    ) : (
                        <div className="overflow-hidden rounded-lg border border-ore-border bg-ore-raised">
                            <VirtualSongList count={filteredSongs.length}>
                                {(idx) => {
                                    const song = filteredSongs[idx];
                                    const isPlaying =
                                        playerState.songId === song.id && playerState.status === "playing";
                                    const isPending = playingId === song.id;
                                    const perfList = song.performanceEntries.filter(
                                        (p) => p.id !== PLAIN_PERFORMANCE_ID,
                                    );
                                    const inAddon = selectedSongIds.includes(song.id);

                                    return (
                                        <SongRow
                                            key={song.id}
                                            index={idx + 1}
                                            title={song.name}
                                            id={song.id}
                                            duration={formatDuration(song.duration)}
                                            active={playerState.songId === song.id}
                                            playState={isPending ? "pending" : isPlaying ? "playing" : "idle"}
                                            onPlay={() =>
                                                void handlePlay(song.id, song.name, () => getSongBytes(song.id))
                                            }
                                            onOpenCode={() => void handleOpenCode(song)}
                                            onRename={() => setRenameTarget(song)}
                                            onRemove={() => setDeleteTarget(song)}
                                            leading={
                                                <div className="flex items-center gap-1.5">
                                                    {mode === "local" && (
                                                        <input
                                                            type="checkbox"
                                                            title="是否包含到附加包中"
                                                            checked={inAddon}
                                                            onChange={() => toggleSongInAddon(song.id)}
                                                            className="h-3.5 w-3.5 shrink-0 accent-[var(--pb-primary)]"
                                                        />
                                                    )}
                                                    <button
                                                        type="button"
                                                        title={isPlaying ? "暂停" : "试听"}
                                                        onClick={() =>
                                                            void handlePlay(song.id, song.name, () =>
                                                                getSongBytes(song.id),
                                                            )
                                                        }
                                                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                                    >
                                                        {isPending ? (
                                                            <Loader2 size={13} className="animate-spin" />
                                                        ) : isPlaying ? (
                                                            <Pause size={13} />
                                                        ) : (
                                                            <Play size={13} />
                                                        )}
                                                    </button>
                                                </div>
                                            }
                                            badges={
                                                <>
                                                    {perfList.length > 0 && (
                                                        <SongBadge tone="brand">
                                                            {perfList.length} 套演出
                                                        </SongBadge>
                                                    )}
                                                    {song.aliases && song.aliases.length > 0 && (
                                                        <SongBadge>多名称合并</SongBadge>
                                                    )}
                                                </>
                                            }
                                            meta={[`${song.noteCount} 音符`, formatDuration(song.duration)]}
                                            actions={
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        title="详情与演出编排"
                                                        onClick={() => setDetailSong(song)}
                                                        className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11.5px] text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                                    >
                                                        <Sparkles size={12} /> 演出/详情
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title="加入曲库"
                                                        onClick={() => setAssignSong(song)}
                                                        className="grid h-7 w-7 place-items-center rounded text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                                    >
                                                        <ListPlus size={14} />
                                                    </button>
                                                    {activeLibrary && !activeLibrary.readonly && (
                                                        <button
                                                            type="button"
                                                            title="从该曲库移出"
                                                            onClick={() =>
                                                                void removeSongFromLibrary(
                                                                    activeLibrary.id,
                                                                    song.id,
                                                                )
                                                            }
                                                            className="grid h-7 w-7 place-items-center rounded text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                                        >
                                                            ×
                                                        </button>
                                                    )}
                                                </div>
                                            }
                                        />
                                    );
                                }}
                            </VirtualSongList>
                        </div>
                    )}
                </>
            ) : (
                <>
                    {/* 在线曲库分类浏览 */}
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 text-[11px] uppercase tracking-wide text-ore-dimmer">
                            自动分类
                        </span>
                        {officialCatalog?.collections.map((col) => {
                            const active = officialCatId === col.id;
                            return (
                                <button
                                    key={col.id}
                                    type="button"
                                    onClick={() => setOfficialCatId(col.id)}
                                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                                        active
                                            ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                            : "border-ore-border bg-ore-raised text-ore-dim hover:text-ore-text"
                                    }`}
                                >
                                    <span>{col.name}</span>
                                    <span className="text-[11px] opacity-75">
                                        ({col.songIds.length})
                                    </span>
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            onClick={() => setOfficialCatId("all")}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                                officialCatId === "all"
                                    ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                    : "border-ore-border bg-ore-raised text-ore-dim hover:text-ore-text"
                            }`}
                        >
                            <span>全部曲目</span>
                            <span className="text-[11px] opacity-75">
                                ({officialCatalog?.totalSongs ?? 0})
                            </span>
                        </button>
                    </div>

                    {activeOfficialCollection && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ore-border bg-ore-raised px-3.5 py-2.5 text-[12px]">
                            <div>
                                <span className="font-semibold">{activeOfficialCollection.name}</span>
                                <span className="ml-2 text-ore-dim">
                                    {activeOfficialCollection.description}
                                </span>
                                <span className="ml-2 text-ore-dimmer">
                                    共 {activeOfficialCollection.count} 首
                                </span>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                loading={busy}
                                onClick={() => void importOfficialCollection(activeOfficialCollection.id)}
                            >
                                <CloudDownload size={14} /> 整库添加到我的曲库
                            </Button>
                        </div>
                    )}

                    <div className="flex flex-col divide-y divide-ore-divider rounded-lg border border-ore-border bg-ore-raised">
                        {officialSongs.slice(0, 120).map((song, idx) => {
                            const perfs = officialCatalog?.performances[song.id] ?? [];
                            const added = existingSongIds.has(song.id);
                            const isPlaying =
                                playerState.songId === song.id && playerState.status === "playing";
                            return (
                                <SongRow
                                    key={song.id}
                                    index={idx + 1}
                                    title={song.name}
                                    id={song.id}
                                    duration={formatDuration(song.duration)}
                                    active={playerState.songId === song.id}
                                    playState={
                                        playingId === song.id
                                            ? "pending"
                                            : isPlaying
                                              ? "playing"
                                              : "idle"
                                    }
                                    onPlay={() =>
                                        void handlePlay(song.id, song.name, () =>
                                            fetchOfficialSongBytes(song.id),
                                        )
                                    }
                                    meta={[`${song.noteCount} 音符`, formatDuration(song.duration)]}
                                    badges={
                                        perfs.length > 0 ? (
                                            <SongBadge tone="brand">
                                                演出 · {perfs[0].name}
                                            </SongBadge>
                                        ) : undefined
                                    }
                                    trailing={
                                        added ? (
                                            <span className="inline-flex items-center gap-1 text-[11.5px] text-brand">
                                                <Check size={13} /> 已在曲库
                                            </span>
                                        ) : (
                                            <Button
                                                type="button"
                                                color="secondary"
                                                size="sm"
                                                onClick={() =>
                                                    void importOfficialSongs(
                                                        [song.id],
                                                        activeLibId !== "all" ? activeLibId : undefined,
                                                    )
                                                }
                                            >
                                                <Plus size={13} /> 添加
                                            </Button>
                                        )
                                    }
                                />
                            );
                        })}
                        {officialSongs.length > 120 && (
                            <div className="px-4 py-2.5 text-center text-[12px] text-ore-dim">
                                仅展示前 120 首，请使用右上角搜索框定位更多在线曲目（共 {officialSongs.length} 首）
                            </div>
                        )}
                    </div>
                </>
            )}

            <SongDetailDialog
                song={detailSong}
                libraries={libraries}
                plugins={plugins}
                canDeletePerformance={mode === "server"}
                onClose={() => setDetailSong(null)}
                onDeletePerformance={(songId, perfId) => {
                    void deletePerformance(songId, perfId);
                    setDetailSong(null);
                }}
                onDownloadPbe3={(song) => void handleDownloadPbe3(song)}
            />

            <RenameSongDialog
                opened={Boolean(renameTarget)}
                initialName={renameTarget?.name ?? ""}
                onClose={() => setRenameTarget(null)}
                onConfirm={(name) => {
                    if (renameTarget) void renameSong(renameTarget.id, name);
                }}
            />

            <ConfirmDialog
                opened={Boolean(deleteTarget)}
                title="移除曲目"
                danger
                description={
                    deleteTarget ? `确定移除「${deleteTarget.name}」吗？` : ""
                }
                confirmLabel="移除"
                onConfirm={() => {
                    if (deleteTarget) void deleteSong(deleteTarget.id);
                    setDeleteTarget(null);
                }}
                onCancel={() => setDeleteTarget(null)}
            />

            <ImportCodeDialog
                opened={Boolean(codeDialog)}
                onClose={() => setCodeDialog(null)}
                songName={codeDialog?.name ?? ""}
                chunks={codeDialog?.chunks ?? []}
                bytes={codeDialog?.bytes}
            />

            <Dialog
                opened={newLibOpen}
                onClose={() => setNewLibOpen(false)}
                title="新建曲库"
                size="sm"
                footer={
                    <>
                        <Button type="button" color="secondary" size="sm" onClick={() => setNewLibOpen(false)}>
                            取消
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={!newLibName.trim()}
                            onClick={() => {
                                const name = newLibName.trim();
                                setNewLibOpen(false);
                                void createLibrary(name).then((lib) => setActiveLibId(lib.id));
                            }}
                        >
                            创建
                        </Button>
                    </>
                }
            >
                <Textfield
                    label="曲库名称"
                    placeholder="例如：晚会演出备选"
                    value={newLibName}
                    autoFocus
                    onInput={(e) => {
                        const target = e.target as unknown as { value?: unknown };
                        if (typeof target?.value === "string") setNewLibName(target.value);
                    }}
                />
            </Dialog>

            <RenameSongDialog
                opened={Boolean(renameLibTarget)}
                initialName={renameLibTarget?.name ?? ""}
                title="重命名曲库"
                label="曲库名称"
                onClose={() => setRenameLibTarget(null)}
                onConfirm={(name) => {
                    if (renameLibTarget) void renameLibrary(renameLibTarget.id, name);
                }}
            />

            <ConfirmDialog
                opened={Boolean(deleteLibTarget)}
                title="删除曲库"
                danger
                description={
                    deleteLibTarget
                        ? `删除曲库「${deleteLibTarget.name}」只会移除该逻辑集合，不会删除已关联的音乐本体或玩家存储卡数据。`
                        : ""
                }
                confirmLabel="删除曲库"
                onConfirm={() => {
                    if (deleteLibTarget) {
                        void deleteLibrary(deleteLibTarget.id);
                        if (activeLibId === deleteLibTarget.id) setActiveLibId("all");
                    }
                    setDeleteLibTarget(null);
                }}
                onCancel={() => setDeleteLibTarget(null)}
            />

            <Dialog
                opened={Boolean(assignSong)}
                onClose={() => setAssignSong(null)}
                title={assignSong ? `将「${assignSong.name}」加入曲库` : "加入曲库"}
                size="sm"
            >
                <div className="flex flex-col gap-2">
                    {libraries
                        .filter((l) => !l.readonly)
                        .map((lib) => {
                            const already = assignSong
                                ? assignSong.libraries?.includes(lib.id) || lib.songIds.includes(assignSong.id)
                                : false;
                            return (
                                <button
                                    key={lib.id}
                                    type="button"
                                    disabled={already}
                                    onClick={() => {
                                        if (!assignSong) return;
                                        void addSongsToLibrary(lib.id, [assignSong.id]);
                                        setAssignSong(null);
                                    }}
                                    className="flex items-center justify-between rounded-md border border-ore-border bg-ore-raised px-3 py-2 text-left text-[13px] hover:border-brand disabled:opacity-50"
                                >
                                    <span>{lib.name}</span>
                                    <span className="text-[11px] text-ore-dim">
                                        {already ? "已包含" : "加入"}
                                    </span>
                                </button>
                            );
                        })}
                    {libraries.filter((l) => !l.readonly).length === 0 && (
                        <div className="text-[12px] text-ore-dim">
                            暂无自定义曲库，请先点击右上角「新建曲库」。
                        </div>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
