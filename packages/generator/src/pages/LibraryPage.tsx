import { useCallback, useDeferredValue, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import {
    Button,
    ConfirmDialog,
    IconButton,
    ImportCodeDialog,
    Menu,
    PageHeader,
    PianoKeys,
    Segmented,
    SongRow,
    SongBadge,
    Textfield,
    VirtualSongList,
    notifications,
    songTableGrid,
    usePlayingSongId,
} from "@piano/ui";
import {
    ArrowUpDown,
    BookmarkPlus,
    Check,
    ChevronDown,
    FolderOpen,
    Info,
    Plus,
    Search,
    Upload,
} from "lucide-react";
import { previewPlayer } from "../player";
import { useGenerator, type LibrarySort } from "../store/generator";
import type { LibraryMeta } from "../library";
import type { SongEntry } from "../types";
import type { StoredSong } from "../localLibrary";
import { useMediaQuery } from "../hooks/useMediaQuery";

const SORT_LABELS: Record<LibrarySort, string> = {
    adds: "按添加量",
    plays: "按播放量",
    name: "按曲名",
    default: "曲库默认",
};

function formatDuration(scaled: number): string {
    const seconds = Math.max(0, Math.floor(scaled / 40));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function LibraryPage() {
    const isMobile = useMediaQuery("(max-width: 47.99em)");
    const library = useGenerator((state) => state.library);
    const songs = useGenerator((state) => state.songs);
    const myMusic = useGenerator((state) => state.myMusic);
    const template = useGenerator((state) => state.template);
    const libSort = useGenerator((state) => state.libSort);
    const setLibSort = useGenerator((state) => state.setLibSort);
    const pendingPreviewId = useGenerator((state) => state.pendingPreviewId);
    const pendingAddId = useGenerator((state) => state.pendingAddId);
    const addMidiFiles = useGenerator((state) => state.addMidiFiles);
    const addLibrarySong = useGenerator((state) => state.addLibrarySong);
    const saveLibrarySong = useGenerator((state) => state.saveLibrarySong);
    const addToAddon = useGenerator((state) => state.addToAddon);
    const removeMyMusicSong = useGenerator((state) => state.removeMyMusicSong);
    const previewLibrarySong = useGenerator((state) => state.previewLibrarySong);
    const togglePreview = useGenerator((state) => state.togglePreview);
    const loadLibraryEntry = useGenerator((state) => state.loadLibraryEntry);
    const scoreChunks = useGenerator((state) => state.scoreChunks);
    const setLoading = useGenerator((state) => state.setLoading);

    const [tab, setTab] = useState<"online" | "mine">("online");
    const [query, setQuery] = useState("");
    const [code, setCode] = useState<{ name: string; chunks: string[] } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<StoredSong | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const folderRef = useRef<HTMLInputElement>(null);

    const activeId = usePlayingSongId(previewPlayer);
    const playDisabled = !template;
    const deferredQuery = useDeferredValue(query);
    const rowHeight = isMobile ? 54 : 50;

    const addonIds = useMemo(() => new Set(songs.map((song) => song.id)), [songs]);
    const myMusicIds = useMemo(() => new Set(myMusic.map((song) => song.id)), [myMusic]);
    // 在线曲库只有确实有统计数据时才显示「添加 / 播放」列，避免整列空占位。
    const hasRanking = useMemo(
        () => (library ?? []).some((meta) => meta.adds > 0 || meta.plays > 0),
        [library]
    );
    const statsColumns = tab === "online" && hasRanking ? 3 : 1;

    const filteredLibrary = useMemo(() => {
        const list = (library ?? []).slice();
        const keyword = deferredQuery.trim().toLowerCase();
        const items = keyword
            ? list.filter((meta) => meta.name.toLowerCase().includes(keyword) || meta.id === keyword)
            : list;
        switch (libSort) {
            case "adds":
                return items.sort((a, b) => b.adds - a.adds || b.plays - a.plays);
            case "plays":
                return items.sort((a, b) => b.plays - a.plays || b.adds - a.adds);
            case "name":
                return items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
            default:
                return items;
        }
    }, [library, libSort, deferredQuery]);

    const filteredSongs = useMemo(() => {
        const keyword = deferredQuery.trim().toLowerCase();
        if (!keyword) return myMusic;
        return myMusic.filter(
            (song) => song.name.toLowerCase().includes(keyword) || song.id === keyword
        );
    }, [myMusic, deferredQuery]);

    const openCodeForEntry = useCallback(
        (entry: SongEntry) => {
            const chunks = scoreChunks(entry);
            if (chunks.length === 0) {
                notifications.show({ title: "无法生成导入码", message: "该曲目没有可导出的 PBE2 数据", color: "red" });
                return;
            }
            setCode({ name: entry.name, chunks });
        },
        [scoreChunks]
    );

    const openCodeForLibrary = useCallback(
        async (meta: LibraryMeta) => {
            setLoading("正在准备导入码...");
            try {
                openCodeForEntry(await loadLibraryEntry(meta));
            } catch (error) {
                notifications.show({
                    title: "生成导入码失败",
                    message: (error as Error).message,
                    color: "red",
                });
            } finally {
                setLoading(null);
            }
        },
        [loadLibraryEntry, openCodeForEntry, setLoading]
    );

    const rowState = useCallback(
        (id: string): "idle" | "playing" | "pending" =>
            pendingPreviewId === id ? "pending" : activeId === id ? "playing" : "idle",
        [activeId, pendingPreviewId]
    );

    const renderLibraryRow = useCallback(
        (meta: LibraryMeta, index: number) => {
            const inAddon = addonIds.has(meta.id);
            const inMine = myMusicIds.has(meta.id);
            const addAction = inAddon ? (
                <span
                    className="grid h-8 w-8 place-items-center rounded-md pb-tint-success"
                    title="已在附加包中"
                >
                    <Check size={15} />
                </span>
            ) : (
                <IconButton
                    size="sm"
                    color="ghost"
                    aria-label="加入附加包"
                    title="加入附加包"
                    className="text-ore-dim hover:bg-brand/10 hover:text-brand"
                    loading={pendingAddId === meta.id}
                    onClick={() => void addLibrarySong(meta.id)}
                >
                    <Plus size={16} />
                </IconButton>
            );
            const metaItems = [
                meta.noteCount > 0 ? meta.noteCount.toLocaleString() : "",
                meta.adds > 0 ? meta.adds.toLocaleString() : "",
                meta.plays > 0 ? meta.plays.toLocaleString() : "",
            ];

            return (
                <SongRow
                    layout="table"
                    statsColumns={statsColumns}
                    index={index + 1}
                    title={meta.name}
                    meta={[<span key="notes">{meta.noteCount.toLocaleString()} 音符</span>]}
                    stats={metaItems}
                    duration={formatDuration(meta.duration)}
                    active={activeId === meta.id}
                    playState={rowState(meta.id)}
                    onPlay={() => void previewLibrarySong(meta)}
                    playDisabled={playDisabled}
                    onOpenCode={() => void openCodeForLibrary(meta)}
                    actions={
                        inMine ? undefined : (
                            <IconButton
                                size="sm"
                                aria-label="保存到我的音乐"
                                title="保存到我的音乐"
                                onClick={() => void saveLibrarySong(meta.id)}
                            >
                                <BookmarkPlus size={14} />
                            </IconButton>
                        )
                    }
                    trailing={addAction}
                    menu={
                        inMine
                            ? []
                            : [
                                  {
                                      key: "save",
                                      label: "保存到我的音乐",
                                      icon: <BookmarkPlus size={13} />,
                                      onSelect: () => void saveLibrarySong(meta.id),
                                  },
                              ]
                    }
                />
            );
        },
        [
            activeId,
            addLibrarySong,
            addonIds,
            myMusicIds,
            openCodeForLibrary,
            pendingAddId,
            playDisabled,
            previewLibrarySong,
            rowState,
            saveLibrarySong,
            statsColumns,
        ]
    );

    const renderMyRow = useCallback(
        (song: StoredSong, index: number) => {
            const inAddon = addonIds.has(song.id);
            const addAction = inAddon ? (
                <span
                    className="grid h-8 w-8 place-items-center rounded-md pb-tint-success"
                    title="已在附加包中"
                >
                    <Check size={15} />
                </span>
            ) : (
                <IconButton
                    size="sm"
                    color="ghost"
                    aria-label="加入附加包"
                    title="加入附加包"
                    className="text-ore-dim hover:bg-brand/10 hover:text-brand"
                    onClick={() => addToAddon(song)}
                >
                    <Plus size={16} />
                </IconButton>
            );

            return (
                <SongRow
                    layout="table"
                    statsColumns={1}
                    index={index + 1}
                    title={song.name}
                    meta={[<span key="notes">{(song.noteCount ?? 0).toLocaleString()} 音符</span>]}
                    stats={[(song.noteCount ?? 0).toLocaleString(), "", ""]}
                    duration={formatDuration(song.duration)}
                    badges={song.fromLibrary ? <SongBadge>曲库</SongBadge> : <SongBadge>本地</SongBadge>}
                    active={activeId === song.id}
                    playState={rowState(song.id)}
                    onPlay={() => void togglePreview(song)}
                    playDisabled={playDisabled}
                    onOpenCode={() => openCodeForEntry(song)}
                    onRemove={() => setDeleteTarget(song)}
                    removeLabel="从我的音乐删除"
                    trailing={addAction}
                    menu={
                        inAddon
                            ? []
                            : [
                                  {
                                      key: "add",
                                      label: "加入附加包",
                                      icon: <Plus size={13} />,
                                      onSelect: () => addToAddon(song),
                                  },
                              ]
                    }
                />
            );
        },
        [activeId, addToAddon, addonIds, openCodeForEntry, playDisabled, rowState, togglePreview]
    );

    return (
        <div className="mx-auto flex min-h-0 w-full max-w-[1040px] flex-1 flex-col">
            <input
                ref={fileRef}
                type="file"
                accept=".mid,.midi"
                multiple
                hidden
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length > 0) void addMidiFiles(files);
                }}
            />
            <input
                ref={folderRef}
                type="file"
                hidden
                multiple
                {...({ webkitdirectory: "", directory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)}
                onChange={(event) => {
                    const files = Array.from(event.target.files ?? []).filter((file) => /\.(mid|midi)$/i.test(file.name));
                    event.target.value = "";
                    if (files.length > 0) void addMidiFiles(files);
                    else
                        notifications.show({
                            title: "文件夹里没有 MIDI",
                            message: "请选择包含 .mid / .midi 的文件夹",
                            color: "gray",
                        });
                }}
            />

            <div className="px-4 pt-3 md:px-0 md:pt-0">
                <PageHeader
                    title="音乐库"
                    description="在线曲库、本地曲目与附加包素材，都从这里开始。"
                    actions={
                        <button
                            type="button"
                            aria-label="曲库版权说明"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dimmer transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-dim"
                            title="曲库内歌曲仅供学习交流使用，版权归原作者所有；如涉及侵权，请联系我们删除。"
                            onClick={() =>
                                notifications.show({
                                    title: "关于在线曲库",
                                    message: "曲库内歌曲仅供学习交流使用，版权归原作者所有；如涉及侵权，请联系我们删除。",
                                    color: "gray",
                                })
                            }
                        >
                            <Info size={15} />
                        </button>
                    }
                />

                <div className="mt-3 flex flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
                    <Segmented
                        ariaLabel="曲库视图"
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: "online", label: "在线曲库", count: library?.length ?? "…" },
                            { value: "mine", label: "我的音乐", count: myMusic.length },
                        ]}
                    />

                    <div className="flex items-center gap-2 md:ml-auto">
                        <Textfield
                            className="min-w-0 flex-1 md:w-[220px] md:flex-none"
                            leading={<Search size={14} />}
                            placeholder={tab === "online" ? "搜索歌曲或 ID…" : "搜索我的音乐…"}
                            value={query}
                            onInput={(event) => {
                                const target = event.target as unknown as { value?: unknown };
                                if (typeof target?.value === "string") setQuery(target.value);
                            }}
                        />
                        {tab === "online" ? (
                            <Menu
                                align="end"
                                trigger={
                                    <Button type="button" color="ghost" size="sm" title="排序">
                                        <ArrowUpDown size={13} />
                                        <span className="hidden sm:inline">{SORT_LABELS[libSort]}</span>
                                    </Button>
                                }
                                items={(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => ({
                                    key,
                                    label: SORT_LABELS[key],
                                    selected: libSort === key,
                                    onSelect: () => setLibSort(key),
                                }))}
                            />
                        ) : (
                            <span className="hidden shrink-0 text-[11px] text-ore-dimmer sm:inline">
                                仅保存在本机浏览器
                            </span>
                        )}
                        <Menu
                            align="end"
                            trigger={
                                <Button type="button" color="secondary" size="sm" title="导入 MIDI">
                                    <Upload size={14} />
                                    <span className="hidden sm:inline">导入 MIDI</span>
                                    <ChevronDown size={12} className="text-ore-dimmer" />
                                </Button>
                            }
                            items={[
                                {
                                    key: "files",
                                    label: "选择 MIDI 文件",
                                    icon: <Upload size={13} />,
                                    onSelect: () => fileRef.current?.click(),
                                },
                                {
                                    key: "folder",
                                    label: "导入 MIDI 文件夹",
                                    icon: <FolderOpen size={13} />,
                                    onSelect: () => folderRef.current?.click(),
                                },
                            ]}
                        />
                    </div>
                </div>
            </div>

            <div
                className={`mt-3 hidden grid-cols-[28px_minmax(0,1fr)_68px_56px_56px_48px_108px] items-center gap-3 border-b border-ore-border bg-[var(--pb-surface)] px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dim md:mr-2.5 md:grid ${songTableGrid(statsColumns)}`}
            >
                <span className="text-center">#</span>
                <span>曲目</span>
                <span className="text-right">音符</span>
                {statsColumns >= 2 && (
                    <>
                        <span className="text-right">添加</span>
                        <span className="text-right">播放</span>
                    </>
                )}
                <span className="text-right">时长</span>
                <span />
            </div>

            {tab === "online" ? (
                <VirtualSongList
                    className="mt-1 min-h-0 flex-1 px-1 pb-2 [scrollbar-gutter:stable] md:px-0"
                    items={filteredLibrary}
                    rowHeight={rowHeight}
                    gap={0}
                    getKey={(meta) => meta.id}
                    renderItem={renderLibraryRow}
                    empty={
                        <div className="px-4 py-12 text-center">
                            <p className="text-[13px] font-medium">{library ? "没有匹配的曲目" : "曲库加载中…"}</p>
                            {library && (
                                <p className="mt-1 text-[11.5px] text-ore-dim">换个关键词，或清空搜索再看一遍</p>
                            )}
                        </div>
                    }
                />
            ) : (
                <VirtualSongList
                    className="mt-1 min-h-0 flex-1 px-1 pb-2 [scrollbar-gutter:stable] md:px-0"
                    items={filteredSongs}
                    rowHeight={rowHeight}
                    gap={0}
                    getKey={(song) => song.id}
                    renderItem={renderMyRow}
                    empty={
                        <div className="flex flex-col items-center px-6 py-12 text-center">
                            <PianoKeys playing={false} className="mb-4 h-10 w-12 p-1.5" />
                            <p className="text-[13px] font-medium">
                                {myMusic.length === 0 ? "我的音乐还是空的" : "没有匹配的曲目"}
                            </p>
                            <p className="mx-auto mt-1 max-w-[360px] text-[11.5px] leading-relaxed text-ore-dim">
                                {myMusic.length === 0
                                    ? "从在线曲库保存曲目，或导入 MIDI 文件 / 文件夹。这里只保存转码后的 PBE2。"
                                    : "换个关键词试试"}
                            </p>
                        </div>
                    }
                />
            )}

            <ImportCodeDialog
                opened={Boolean(code)}
                onClose={() => setCode(null)}
                songName={code?.name ?? ""}
                chunks={code?.chunks ?? []}
            />

            <ConfirmDialog
                opened={Boolean(deleteTarget)}
                title="从我的音乐删除？"
                description={
                    <>
                        将从本地删除 <b>{deleteTarget?.name}</b>，不会影响已经加入附加包的副本。
                    </>
                }
                confirmLabel="删除"
                danger
                onConfirm={() => {
                    if (deleteTarget) void removeMyMusicSong(deleteTarget.id);
                    setDeleteTarget(null);
                }}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    );
}
