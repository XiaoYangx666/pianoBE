import { useCallback, useDeferredValue, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import {
    Button,
    ConfirmDialog,
    IconButton,
    ImportCodeDialog,
    Menu,
    MenuTrigger,
    RowPlayButton,
    TabBar,
    TabButton,
    Tag,
    Textfield,
    VirtualSongList,
    notifications,
    usePlayingSongId,
} from "@piano/ui";
import { Check, ChevronDown, FolderOpen, Info, LibraryBig, Music2, Plus, Trash2, Upload } from "lucide-react";
import { previewPlayer } from "../player";
import { useGenerator, type LibrarySort } from "../store/generator";
import type { LibraryMeta } from "../library";
import type { SongEntry } from "../types";
import type { StoredSong } from "../localLibrary";

const ROW_HEIGHT = 60;

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

    const addonIds = useMemo(() => new Set(songs.map((song) => song.id)), [songs]);
    const myMusicIds = useMemo(() => new Set(myMusic.map((song) => song.id)), [myMusic]);

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
        (meta: LibraryMeta, index: number) => (
            <div
                className={`flex h-full items-center gap-3 rounded-lg px-3 ${
                    activeId === meta.id ? "bg-brand/13 shadow-[inset_3px_0_0_var(--pb-primary)]" : "hover:bg-[var(--pb-hover)]"
                }`}
            >
                <span className="w-[26px] shrink-0 text-center text-[13px] tabular-nums text-ore-dim">
                    {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{meta.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-ore-dim">
                        <span>{formatDuration(meta.duration)}</span>
                        <span className="opacity-50">·</span>
                        <span>{meta.noteCount.toLocaleString()} 音符</span>
                        <span className="opacity-50">·</span>
                        <span className="hidden sm:inline">{meta.adds.toLocaleString()} 添加</span>
                        <span className="hidden opacity-50 sm:inline">·</span>
                        <span className="hidden sm:inline">{meta.plays.toLocaleString()} 播放</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <IconButton
                        color="secondary"
                        size="sm"
                        aria-label="游戏内导入码"
                        title="游戏内导入码"
                        onClick={() => void openCodeForLibrary(meta)}
                    >
                        {"</>"}
                    </IconButton>
                    {myMusicIds.has(meta.id) ? (
                        <span className="grid h-8 w-8 place-items-center text-emerald-600 dark:text-emerald-400" title="已在我的音乐中">
                            <Check size={16} />
                        </span>
                    ) : (
                        <IconButton
                            color="secondary"
                            size="sm"
                            aria-label="加入我的音乐"
                            title="加入我的音乐"
                            loading={pendingAddId === meta.id}
                            onClick={() => void addLibrarySong(meta.id)}
                        >
                            <Plus size={14} />
                        </IconButton>
                    )}
                    <RowPlayButton
                        playState={rowState(meta.id)}
                        disabled={playDisabled}
                        onPlay={() => void previewLibrarySong(meta)}
                    />
                </div>
            </div>
        ),
        [
            activeId,
            addLibrarySong,
            myMusicIds,
            openCodeForLibrary,
            pendingAddId,
            playDisabled,
            previewLibrarySong,
            rowState,
        ]
    );

    const renderMyRow = useCallback(
        (song: StoredSong, index: number) => (
            <div
                className={`flex h-full items-center gap-3 rounded-lg px-3 ${
                    activeId === song.id ? "bg-brand/13 shadow-[inset_3px_0_0_var(--pb-primary)]" : "hover:bg-[var(--pb-hover)]"
                }`}
            >
                <span className="w-[26px] shrink-0 text-center text-[13px] tabular-nums text-ore-dim">
                    {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{song.name}</span>
                        {song.fromLibrary ? <Tag>曲库</Tag> : <Tag>本地导入</Tag>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-ore-dim">
                        <span>{formatDuration(song.duration)}</span>
                        <span className="opacity-50">·</span>
                        <span>{(song.noteCount ?? 0).toLocaleString()} 音符</span>
                        <span className="opacity-50">·</span>
                        <span className="hidden sm:inline">PBE2</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <IconButton
                        color="secondary"
                        size="sm"
                        aria-label="游戏内导入码"
                        title="游戏内导入码"
                        onClick={() => openCodeForEntry(song)}
                    >
                        {"</>"}
                    </IconButton>
                    <IconButton
                        color="secondary"
                        size="sm"
                        aria-label="从我的音乐删除"
                        title="从我的音乐删除"
                        onClick={() => setDeleteTarget(song)}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                    {addonIds.has(song.id) ? (
                        <span className="grid h-8 w-8 place-items-center text-emerald-600 dark:text-emerald-400" title="已在附加包中">
                            <Check size={16} />
                        </span>
                    ) : (
                        <IconButton
                            color="secondary"
                            size="sm"
                            aria-label="加入附加包"
                            title="加入附加包"
                            onClick={() => addToAddon(song)}
                        >
                            <Plus size={14} />
                        </IconButton>
                    )}
                    <RowPlayButton
                        playState={rowState(song.id)}
                        disabled={playDisabled}
                        onPlay={() => void togglePreview(song)}
                    />
                </div>
            </div>
        ),
        [activeId, addToAddon, addonIds, openCodeForEntry, playDisabled, rowState, togglePreview]
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-ore-raised md:rounded-xl md:border md:border-ore-border">
                <header className="flex flex-none flex-wrap items-center gap-2.5 border-b border-ore-divider px-3 py-2">
                    <TabBar>
                        <TabButton type="button" selected={tab === "online"} onClick={() => setTab("online")}>
                            <LibraryBig size={14} /> 在线曲库
                            <Tag>{library?.length ?? "…"}</Tag>
                        </TabButton>
                        <TabButton type="button" selected={tab === "mine"} onClick={() => setTab("mine")}>
                            <Music2 size={14} /> 我的音乐
                            <Tag>{myMusic.length}</Tag>
                        </TabButton>
                    </TabBar>
                    <div className="ml-auto flex items-center gap-1.5">
                        {tab === "online" && (
                            <span
                                className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)]"
                                title="曲库内歌曲仅供学习交流使用，版权归原作者所有；如涉及侵权，请联系我们删除。"
                            >
                                <Info size={16} />
                            </span>
                        )}
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
                                const files = Array.from(event.target.files ?? []).filter((file) =>
                                    /\.(mid|midi)$/i.test(file.name)
                                );
                                event.target.value = "";
                                if (files.length > 0) void addMidiFiles(files);
                                else notifications.show({
                                    title: "文件夹里没有 MIDI",
                                    message: "请选择包含 .mid / .midi 的文件夹",
                                    color: "gray",
                                });
                            }}
                        />
                        <Menu
                            align="end"
                            trigger={
                                <Button type="button">
                                    <Upload size={14} />
                                    <span className="hidden sm:inline">导入 MIDI</span>
                                    <span className="sm:hidden">导入</span>
                                    <ChevronDown size={13} className="opacity-70" />
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
                </header>

                <div className="flex flex-none flex-wrap items-center gap-2.5 px-3 py-2">
                    <Textfield
                        className="min-w-0 flex-1 sm:w-[240px] sm:flex-none sm:shrink-0"
                        placeholder={tab === "online" ? "搜索歌曲或 ID…" : "搜索我的曲目…"}
                        value={query}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setQuery(target.value);
                        }}
                    />
                    {tab === "online" && (
                        <Menu
                            trigger={<MenuTrigger>{SORT_LABELS[libSort]}</MenuTrigger>}
                            items={(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => ({
                                key,
                                label: SORT_LABELS[key],
                                selected: libSort === key,
                                onSelect: () => setLibSort(key),
                            }))}
                        />
                    )}
                    <div className="flex-1" />
                </div>

                {tab === "online" ? (
                    <VirtualSongList
                        className="flex-1 px-1 pb-1"
                        items={filteredLibrary}
                        rowHeight={ROW_HEIGHT}
                        getKey={(meta) => meta.id}
                        renderItem={renderLibraryRow}
                        empty={
                            <p className="px-4 py-10 text-center text-sm text-ore-dim">
                                {library ? "没有匹配的曲目" : "曲库加载中…"}
                            </p>
                        }
                    />
                ) : (
                    <VirtualSongList
                        className="flex-1 px-1 pb-1"
                        items={filteredSongs}
                        rowHeight={ROW_HEIGHT}
                        getKey={(song) => song.id}
                        renderItem={renderMyRow}
                        empty={
                            <div className="px-6 py-12 text-center">
                                <p className="text-sm text-ore-dim">我的音乐还是空的</p>
                                <p className="mt-1 text-xs text-ore-dimmer">
                                    从在线曲库点「+」，或导入 MIDI / 文件夹；只保存转码后的 PBE2
                                </p>
                            </div>
                        }
                    />
                )}
            </section>

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
