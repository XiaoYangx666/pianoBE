import { useCallback, useDeferredValue, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowUpDown,
    Boxes,
    ChevronDown,
    FolderOpen,
    FolderPlus,
    Library as LibraryIcon,
    ListPlus,
    Package,
    PackageCheck,
    PackagePlus,
    Pencil,
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
    IconButton,
    ImportCodeDialog,
    Menu,
    PageHeader,
    PianoKeys,
    SongBadge,
    SongRow,
    Textfield,
    VirtualSongList,
    notify,
    songTableGrid,
    usePlayingSongId,
} from "@piano/ui";
import type { StudioSong } from "../adapters/types";
import { studioPlayer } from "../audio/player";
import { PluginContentDialog } from "../components/PluginContentDialog";
import { RenameSongDialog } from "../components/RenameSongDialog";
import { SongDetailDialog } from "../components/SongDetailDialog";
import { useStudio } from "../store/studio";

type SongSort = "recent" | "name" | "duration" | "notes";

const SORT_LABELS: Record<SongSort, string> = {
    recent: "最近添加",
    name: "按曲名",
    duration: "按时长",
    notes: "按音符数",
};

function formatDuration(scaled: number): string {
    const sec = Math.max(0, Math.floor(scaled / TIME_SCALE));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function LibraryPage() {
    const navigate = useNavigate();
    const mode = useStudio((s) => s.mode);
    const songs = useStudio((s) => s.songs);
    const libraries = useStudio((s) => s.libraries);
    const plugins = useStudio((s) => s.plugins);
    const selectedSongIds = useStudio((s) => s.selectedSongIds);
    const busy = useStudio((s) => s.busy);

    const importFiles = useStudio((s) => s.importFiles);
    const createLibrary = useStudio((s) => s.createLibrary);
    const renameLibrary = useStudio((s) => s.renameLibrary);
    const deleteLibrary = useStudio((s) => s.deleteLibrary);
    const clearLibrary = useStudio((s) => s.clearLibrary);
    const addSongsToLibrary = useStudio((s) => s.addSongsToLibrary);
    const removeSongFromLibrary = useStudio((s) => s.removeSongFromLibrary);
    const exportLibraryPlugin = useStudio((s) => s.exportLibraryPlugin);
    const renameSong = useStudio((s) => s.renameSong);
    const deleteSong = useStudio((s) => s.deleteSong);
    const importPerformanceFile = useStudio((s) => s.importPerformanceFile);
    const deletePerformance = useStudio((s) => s.deletePerformance);
    const getSongBytes = useStudio((s) => s.getSongBytes);
    const getImportCode = useStudio((s) => s.getImportCode);
    const toggleSongInAddon = useStudio((s) => s.toggleSongInAddon);
    const loadPluginArchive = useStudio((s) => s.loadPluginArchive);
    const installBuiltinPlugin = useStudio((s) => s.installBuiltinPlugin);
    const importSingleSongFromPlugin = useStudio((s) => s.importSingleSongFromPlugin);

    const [activeLibId, setActiveLibId] = useState<string>("all");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<SongSort>("recent");
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const [detailSongId, setDetailSongId] = useState<string | null>(null);
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
    const [clearLibTarget, setClearLibTarget] = useState<LibraryRecord | null>(null);
    const [assignSong, setAssignSong] = useState<StudioSong | null>(null);
    const [pickerPluginId, setPickerPluginId] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const activePlayId = usePlayingSongId(studioPlayer);
    const deferredQuery = useDeferredValue(query);

    const detailSong = useMemo(
        () => (detailSongId ? songs.find((s) => s.id === detailSongId) ?? null : null),
        [detailSongId, songs],
    );

    const activeLibrary = useMemo(
        () => libraries.find((l) => l.id === activeLibId) ?? null,
        [libraries, activeLibId],
    );

    const addonSet = useMemo(() => new Set(selectedSongIds), [selectedSongIds]);

    const officialPacks = useMemo(
        () => plugins.filter((p) => p.source === "builtin" && p.contents.songs > 0),
        [plugins],
    );
    const pickerPlugin = useMemo(
        () => (pickerPluginId ? officialPacks.find((p) => p.id === pickerPluginId) ?? null : null),
        [pickerPluginId, officialPacks],
    );
    const existingSongIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);
    const existingFingerprints = useMemo(
        () => new Set(songs.map((s) => s.musicFingerprint).filter((x): x is string => Boolean(x))),
        [songs],
    );

    const openOfficialPicker = useCallback(() => {
        const target =
            officialPacks.find((p) => p.id === "pianobe.pack.featured") ?? officialPacks[0];
        if (target) setPickerPluginId(target.id);
        else navigate("/extensions?tab=libraries");
    }, [navigate, officialPacks]);

    const filteredSongs = useMemo(() => {
        const q = deferredQuery.trim().toLowerCase();
        const lib = activeLibId !== "all" ? libraries.find((l) => l.id === activeLibId) : undefined;
        const libSongSet = lib ? new Set(lib.songIds) : null;
        const list = songs.filter((song) => {
            if (activeLibId !== "all") {
                const inLib =
                    song.libraries?.includes(activeLibId) || Boolean(libSongSet?.has(song.id));
                if (!inLib) return false;
            }
            if (!q) return true;
            return (
                song.name.toLowerCase().includes(q) ||
                song.id.toLowerCase().includes(q) ||
                Boolean(song.aliases?.some((a) => a.toLowerCase().includes(q)))
            );
        });
        switch (sort) {
            case "name":
                return [...list].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
            case "duration":
                return [...list].sort((a, b) => b.duration - a.duration);
            case "notes":
                return [...list].sort((a, b) => b.noteCount - a.noteCount);
            default:
                return list;
        }
    }, [songs, activeLibId, libraries, deferredQuery, sort]);

    const handlePlay = useCallback(
        async (song: StudioSong) => {
            setPendingId(song.id);
            try {
                await studioPlayer.toggleSong(
                    song.id,
                    song.name,
                    () => getSongBytes(song.id),
                    "pbe3",
                );
            } catch (err) {
                notify({
                    title: "试听失败",
                    message: err instanceof Error ? err.message : String(err),
                    color: "red",
                });
            } finally {
                setPendingId(null);
            }
        },
        [getSongBytes],
    );

    const handleOpenCode = useCallback(
        async (song: StudioSong) => {
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
        },
        [getImportCode],
    );

    const handleDownloadPbe3 = useCallback(
        async (song: StudioSong) => {
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
        },
        [getSongBytes],
    );

    const renderSongRow = useCallback(
        (song: StudioSong, idx: number) => {
            const isPlaying = activePlayId === song.id;
            const isPending = pendingId === song.id;
            const perfList = song.performanceEntries.filter(
                (p) => p.id !== PLAIN_PERFORMANCE_ID,
            );
            const inAddon = addonSet.has(song.id);
            const canRemoveFromLib = Boolean(activeLibrary && !activeLibrary.readonly);
            const isPluginOnly =
                song.origin?.kind === "plugin" &&
                !(song.origins ?? []).some((o) => o.kind === "user");

            return (
                <SongRow
                    layout="table"
                    statsColumns={1}
                    menuMode="always"
                    index={idx + 1}
                    title={song.name}
                    stats={[song.noteCount.toLocaleString()]}
                    meta={[`${song.noteCount} 音符`]}
                    duration={formatDuration(song.duration)}
                    active={isPlaying}
                    playState={isPending ? "pending" : isPlaying ? "playing" : "idle"}
                    onPlay={() => void handlePlay(song)}
                    onOpenCode={() => void handleOpenCode(song)}
                    onRename={
                        mode === "server" || !isPluginOnly ? () => setRenameTarget(song) : undefined
                    }
                    onRemove={
                        canRemoveFromLib
                            ? () => void removeSongFromLibrary(activeLibrary!.id, song.id)
                            : mode === "server" || !isPluginOnly
                              ? () => setDeleteTarget(song)
                              : undefined
                    }
                    removeLabel={canRemoveFromLib ? "从当前曲库移出" : "移除曲目"}
                    badges={
                        <>
                            {perfList.length > 0 && (
                                <SongBadge tone="brand">{perfList.length} 套演出</SongBadge>
                            )}
                            {song.aliases && song.aliases.length > 0 && (
                                <SongBadge>多名称合并</SongBadge>
                            )}
                        </>
                    }
                    actions={
                        <>
                            <IconButton
                                size="sm"
                                title="详情与演出编排"
                                aria-label="详情与演出编排"
                                onClick={() => setDetailSongId(song.id)}
                            >
                                <Sparkles size={14} />
                            </IconButton>
                            {mode === "local" && (
                                <IconButton
                                    size="sm"
                                    title={inAddon ? "移出当前附加包清单" : "加入当前附加包清单"}
                                    aria-label={inAddon ? "移出当前附加包清单" : "加入当前附加包清单"}
                                    className={inAddon ? "text-brand" : undefined}
                                    onClick={() => toggleSongInAddon(song.id)}
                                >
                                    {inAddon ? <PackageCheck size={14} /> : <PackagePlus size={14} />}
                                </IconButton>
                            )}
                        </>
                    }
                    menu={[
                        {
                            key: "detail",
                            label: "详情与演出编排",
                            icon: <Sparkles size={13} />,
                            onSelect: () => setDetailSongId(song.id),
                        },
                        {
                            key: "assign",
                            label: "加入曲库",
                            icon: <ListPlus size={13} />,
                            onSelect: () => setAssignSong(song),
                        },
                        ...(mode === "local"
                            ? [
                                  {
                                      key: "addon",
                                      label: inAddon ? "移出附加包清单" : "加入附加包清单",
                                      icon: inAddon ? (
                                          <PackageCheck size={13} />
                                      ) : (
                                          <PackagePlus size={13} />
                                      ),
                                      onSelect: () => toggleSongInAddon(song.id),
                                  },
                              ]
                            : []),
                    ]}
                />
            );
        },
        [
            activeLibrary,
            activePlayId,
            addonSet,
            handleOpenCode,
            handlePlay,
            mode,
            pendingId,
            removeSongFromLibrary,
            toggleSongInAddon,
        ],
    );

    const targetLibForImport =
        activeLibId !== "all" && !activeLibrary?.readonly ? activeLibId : undefined;

    return (
        <div
            className="relative mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 flex-col gap-3"
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                    e.preventDefault();
                    setDragOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragOver(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length > 0) void importFiles(files, targetLibForImport);
            }}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".mid,.midi,.pbe3,.pbeplugin"
                multiple
                hidden
                onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length > 0) void importFiles(files, targetLibForImport);
                }}
            />
            <input
                ref={folderInputRef}
                type="file"
                multiple
                hidden
                {...({ webkitdirectory: "", directory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => {
                    const files = Array.from(e.target.files ?? []).filter((f) =>
                        /\.(mid|midi|pbe3)$/i.test(f.name),
                    );
                    e.target.value = "";
                    if (files.length > 0) void importFiles(files, targetLibForImport);
                    else {
                        notify({
                            title: "文件夹里没有曲目文件",
                            message: "请选择包含 .mid / .midi / .pbe3 的文件夹",
                            color: "yellow",
                        });
                    }
                }}
            />

            {dragOver && (
                <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-[1px]">
                    <div className="rounded-xl border-2 border-dashed border-brand bg-ore-raised px-8 py-6 text-center shadow-xl">
                        <Upload size={26} className="mx-auto text-brand" />
                        <div className="mt-2 text-[14px] font-semibold">松开以导入到音乐库</div>
                        <div className="mt-1 text-[12px] text-ore-dim">
                            支持 .mid / .pbe3 曲目与 .pbeplugin 扩展包（自动按音乐指纹去重合并）
                        </div>
                    </div>
                </div>
            )}

            <PageHeader
                eyebrow={mode === "server" ? "Server Music Catalog" : "Local Music Workspace"}
                title="音乐库"
                description="从官方曲包挑歌或拖入 MIDI / PBE3，选好后直接导出为游戏附加包。"
                actions={
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            color="secondary"
                            size="sm"
                            onClick={openOfficialPicker}
                        >
                            <Boxes size={14} /> 从官方曲包添加
                        </Button>
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
                        <Menu
                            align="end"
                            trigger={
                                <Button
                                    type="button"
                                    color={mode === "local" && selectedSongIds.length > 0 ? "secondary" : "primary"}
                                    size="sm"
                                    loading={busy}
                                >
                                    <Upload size={14} />
                                    <span>导入</span>
                                    <ChevronDown size={12} />
                                </Button>
                            }
                            items={[
                                {
                                    key: "files",
                                    label: "选择 MIDI / PBE3 / 插件文件",
                                    icon: <Upload size={13} />,
                                    onSelect: () => fileInputRef.current?.click(),
                                },
                                {
                                    key: "folder",
                                    label: "批量导入文件夹",
                                    icon: <FolderOpen size={13} />,
                                    onSelect: () => folderInputRef.current?.click(),
                                },
                            ]}
                        />
                        {mode === "local" && selectedSongIds.length > 0 && (
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => navigate("/addon?tab=export")}
                            >
                                <PackageCheck size={14} /> 导出附加包 ({selectedSongIds.length})
                            </Button>
                        )}
                    </div>
                }
            />

            {/* 曲库标签与搜索排序工具栏 */}
            <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
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

                <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[180px] flex-1 sm:max-w-[280px]">
                        <Textfield
                            leading={<Search size={14} />}
                            placeholder="搜索曲名 / 别名 / ID…"
                            value={query}
                            onInput={(e) => {
                                const t = e.target as unknown as { value?: unknown };
                                if (typeof t?.value === "string") setQuery(t.value);
                            }}
                        />
                    </div>
                    <Menu
                        align="end"
                        trigger={
                            <Button type="button" color="ghost" size="sm">
                                <ArrowUpDown size={13} />
                                <span>{SORT_LABELS[sort]}</span>
                            </Button>
                        }
                        items={(Object.keys(SORT_LABELS) as SongSort[]).map((key) => ({
                            key,
                            label: SORT_LABELS[key],
                            selected: sort === key,
                            onSelect: () => setSort(key),
                        }))}
                    />
                    {activeLibrary && (
                        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[12px]">
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => void exportLibraryPlugin(activeLibrary.id)}
                            >
                                <Package size={13} /> 打包为 .pbeplugin
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
                                    {activeLibrary.songIds.length > 0 && (
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={() => setClearLibTarget(activeLibrary)}
                                        >
                                            <Trash2 size={13} /> 清空曲库
                                        </Button>
                                    )}
                                    {activeLibrary.id !== "default" &&
                                        activeLibrary.id !== "user-default" && (
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
                    )}
                </div>
            </div>

            {/* 对齐表头 */}
            <div
                className={`hidden items-center gap-3 border-b border-ore-border bg-[var(--pb-surface)] px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dim md:grid ${songTableGrid(1)}`}
            >
                <span className="text-center">#</span>
                <span>曲目</span>
                <span className="text-right">音符</span>
                <span className="text-right">时长</span>
                <span />
            </div>

            <VirtualSongList
                className="min-h-[260px] flex-1 rounded-lg border border-ore-border bg-ore-raised [scrollbar-gutter:stable]"
                items={filteredSongs}
                rowHeight={52}
                gap={0}
                getKey={(song) => song.id}
                renderItem={renderSongRow}
                empty={
                    <div className="flex flex-col items-center px-6 py-14 text-center">
                        <PianoKeys playing={false} className="mb-4 h-10 w-12 p-1.5" />
                        <p className="text-[13.5px] font-medium">
                            {songs.length === 0 ? "当前还没有曲目" : "没有匹配的曲目"}
                        </p>
                        <p className="mx-auto mt-1.5 max-w-[420px] text-[12px] leading-relaxed text-ore-dim">
                            {songs.length === 0
                                ? "可直接从官方曲包试听并挑选单曲加入，或拖入本地 MIDI / PBE3 文件。"
                                : "尝试清空搜索关键词或切换曲库筛选。"}
                        </p>
                        {songs.length === 0 && (
                            <div className="mt-4 flex flex-wrap justify-center gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={openOfficialPicker}
                                >
                                    <Boxes size={14} /> 从官方曲包选歌
                                </Button>
                                <Button
                                    type="button"
                                    color="secondary"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Upload size={14} /> 导入本地 MIDI / PBE3
                                </Button>
                            </div>
                        )}
                    </div>
                }
            />

            <SongDetailDialog
                song={detailSong}
                libraries={libraries}
                plugins={plugins}
                isServerMode={mode === "server"}
                onClose={() => setDetailSongId(null)}
                onImportPerformance={importPerformanceFile}
                onDeletePerformance={(songId, perfId) => void deletePerformance(songId, perfId)}
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
                description={deleteTarget ? `确定移除「${deleteTarget.name}」吗？` : ""}
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
                        <Button
                            type="button"
                            color="secondary"
                            size="sm"
                            onClick={() => setNewLibOpen(false)}
                        >
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
                    onInput={(e) => {
                        const t = e.target as unknown as { value?: unknown };
                        if (typeof t?.value === "string") setNewLibName(t.value);
                    }}
                />
            </Dialog>

            <RenameSongDialog
                opened={Boolean(renameLibTarget)}
                title="重命名曲库"
                initialName={renameLibTarget?.name ?? ""}
                onClose={() => setRenameLibTarget(null)}
                onConfirm={(name) => {
                    if (renameLibTarget) void renameLibrary(renameLibTarget.id, name);
                }}
            />

            <ConfirmDialog
                opened={Boolean(clearLibTarget)}
                title="清空曲库"
                danger
                description={
                    clearLibTarget
                        ? clearLibTarget.id === "user-default"
                            ? `确定清空「${clearLibTarget.name}」里的全部曲目吗？未加入其他自定义曲库的本地曲目将被一并移除。`
                            : `确定清空「${clearLibTarget.name}」里的全部曲目吗？`
                        : ""
                }
                confirmLabel="清空"
                onConfirm={() => {
                    if (clearLibTarget) void clearLibrary(clearLibTarget.id);
                    setClearLibTarget(null);
                }}
                onCancel={() => setClearLibTarget(null)}
            />

            <PluginContentDialog
                plugin={pickerPlugin}
                plugins={officialPacks}
                onSelectPlugin={(p) => setPickerPluginId(p.id)}
                libraries={libraries}
                existingSongIds={existingSongIds}
                existingFingerprints={existingFingerprints}
                onClose={() => setPickerPluginId(null)}
                onLoadArchive={loadPluginArchive}
                onInstallPack={installBuiltinPlugin}
                onImportSingle={importSingleSongFromPlugin}
            />

            <ConfirmDialog
                opened={Boolean(deleteLibTarget)}
                title="删除曲库"
                danger
                description={
                    deleteLibTarget
                        ? `确定删除曲库「${deleteLibTarget.name}」吗？歌曲本体不会丢失，仅解除该曲库归属。`
                        : ""
                }
                confirmLabel="删除"
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
                            const has = Boolean(
                                assignSong &&
                                    (assignSong.libraries?.includes(lib.id) ||
                                        lib.songIds.includes(assignSong.id)),
                            );
                            return (
                                <button
                                    key={lib.id}
                                    type="button"
                                    disabled={!assignSong || has}
                                    onClick={() => {
                                        if (!assignSong) return;
                                        void addSongsToLibrary(lib.id, [assignSong.id]);
                                        setAssignSong(null);
                                    }}
                                    className="flex items-center justify-between rounded-lg border border-ore-border bg-ore-raised px-3 py-2 text-left text-[13px] hover:border-brand disabled:opacity-50"
                                >
                                    <span>{lib.name}</span>
                                    <span className="text-[11px] text-ore-dim">
                                        {has ? "已在此曲库" : "点击加入"}
                                    </span>
                                </button>
                            );
                        })}
                </div>
            </Dialog>
        </div>
    );
}
