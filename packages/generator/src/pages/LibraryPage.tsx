import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import {
    Button,
    IconButton,
    ImportCodeDialog,
    Menu,
    MenuTrigger,
    TabBar,
    TabButton,
    Tag,
    Textfield,
    VirtualSongList,
    notifications,
    usePlayingSongId,
} from "@piano/ui";
import { Check, Info, LibraryBig, Music2, Plus, Trash2, Upload } from "lucide-react";
import { previewPlayer } from "../player";
import { useGenerator, type LibrarySort } from "../store/generator";
import type { LibraryMeta } from "../library";
import type { SongEntry } from "../types";

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
    const template = useGenerator((state) => state.template);
    const libSort = useGenerator((state) => state.libSort);
    const setLibSort = useGenerator((state) => state.setLibSort);
    const pendingPreviewId = useGenerator((state) => state.pendingPreviewId);
    const pendingAddId = useGenerator((state) => state.pendingAddId);
    const addMidiFiles = useGenerator((state) => state.addMidiFiles);
    const addLibrarySong = useGenerator((state) => state.addLibrarySong);
    const previewLibrarySong = useGenerator((state) => state.previewLibrarySong);
    const togglePreview = useGenerator((state) => state.togglePreview);
    const loadLibraryEntry = useGenerator((state) => state.loadLibraryEntry);
    const removeSong = useGenerator((state) => state.removeSong);
    const clearSongs = useGenerator((state) => state.clearSongs);
    const scoreChunks = useGenerator((state) => state.scoreChunks);
    const setLoading = useGenerator((state) => state.setLoading);
    const timbres = useGenerator((state) => state.timbres);
    const previewTimbreId = useGenerator((state) => state.previewTimbreId);
    const setPreviewTimbre = useGenerator((state) => state.setPreviewTimbre);

    const [tab, setTab] = useState<"online" | "mine">("online");
    const [query, setQuery] = useState("");
    const [code, setCode] = useState<{ name: string; chunks: string[] } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const activeId = usePlayingSongId(previewPlayer);
    const playDisabled = !template;
    const deferredQuery = useDeferredValue(query);

    const addedIds = useMemo(() => new Set(songs.map((song) => song.id)), [songs]);

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
        if (!keyword) return songs;
        return songs.filter(
            (song) => song.name.toLowerCase().includes(keyword) || song.id === keyword
        );
    }, [songs, deferredQuery]);

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
                        size="sm"
                        aria-label="游戏内导入码"
                        title="游戏内导入码"
                        onClick={() => void openCodeForLibrary(meta)}
                    >
                        {"</>"}
                    </IconButton>
                    {addedIds.has(meta.id) ? (
                        <span className="grid h-8 w-8 place-items-center text-emerald-600 dark:text-emerald-400" title="已在制作清单中">
                            <Check size={16} />
                        </span>
                    ) : (
                        <IconButton
                            size="sm"
                            aria-label="加入制作清单"
                            title="加入制作清单"
                            loading={pendingAddId === meta.id}
                            onClick={() => void addLibrarySong(meta.id)}
                        >
                            <Plus size={14} />
                        </IconButton>
                    )}
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        disabled={playDisabled}
                        loading={rowState(meta.id) === "pending"}
                        onClick={() => void previewLibrarySong(meta)}
                    >
                        {rowState(meta.id) === "playing" ? "停止" : "试听"}
                    </Button>
                </div>
            </div>
        ),
        [
            activeId,
            addedIds,
            addLibrarySong,
            openCodeForLibrary,
            pendingAddId,
            playDisabled,
            previewLibrarySong,
            rowState,
        ]
    );

    const renderMyRow = useCallback(
        (song: SongEntry, index: number) => (
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
                        {song.isOriginal ? (
                            <Tag>模板</Tag>
                        ) : song.fromLibrary ? (
                            <Tag>曲库</Tag>
                        ) : (
                            <Tag>新导入</Tag>
                        )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-ore-dim">
                        <span>{formatDuration(song.duration)}</span>
                        <span className="opacity-50">·</span>
                        <span>{(song.noteCount ?? 0).toLocaleString()} 音符</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <IconButton
                        size="sm"
                        aria-label="游戏内导入码"
                        title="游戏内导入码"
                        onClick={() => openCodeForEntry(song)}
                    >
                        {"</>"}
                    </IconButton>
                    <IconButton
                        size="sm"
                        aria-label="从制作清单移除"
                        title="从制作清单移除"
                        onClick={() => removeSong(song.id)}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        disabled={playDisabled}
                        loading={rowState(song.id) === "pending"}
                        onClick={() => void togglePreview(song)}
                    >
                        {rowState(song.id) === "playing" ? "停止" : "试听"}
                    </Button>
                </div>
            </div>
        ),
        [activeId, openCodeForEntry, playDisabled, removeSong, rowState, togglePreview]
    );

    const timbreOptions = timbres.map((timbre) => ({ value: timbre.id, label: timbre.label }));
    const currentTimbre = timbres.find((timbre) => timbre.id === previewTimbreId);

    return (
        <div className="flex h-[calc(100dvh-112px)] min-h-[420px] flex-col">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ore-border bg-ore-raised">
                <header className="flex flex-none flex-wrap items-center gap-2.5 border-b border-ore-divider px-3 py-2">
                    <TabBar>
                        <TabButton type="button" selected={tab === "online"} onClick={() => setTab("online")}>
                            <LibraryBig size={14} /> 在线曲库
                            <Tag>{library?.length ?? "…"}</Tag>
                        </TabButton>
                        <TabButton type="button" selected={tab === "mine"} onClick={() => setTab("mine")}>
                            <Music2 size={14} /> 我的音乐
                            <Tag>{songs.length}</Tag>
                        </TabButton>
                    </TabBar>
                    <div className="flex-1" />
                    {tab === "online" && (
                        <span
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)]"
                            title="曲库内歌曲仅供学习交流使用，版权归原著作权人所有；如涉及侵权，请联系我们删除。"
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
                    <Button type="button" onClick={() => fileRef.current?.click()}>
                        <Upload size={14} /> 导入 MIDI
                    </Button>
                </header>

                <div className="flex flex-none flex-wrap items-center gap-2.5 px-3 py-2">
                    <Textfield
                        className="w-[240px] shrink-0"
                        placeholder={tab === "online" ? "搜索歌曲名称或 ID…" : "搜索我的曲目…"}
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
                    <Menu
                        trigger={
                            <MenuTrigger>
                                <Music2 size={14} className="text-ore-dim" /> {currentTimbre?.label ?? "音色"}
                            </MenuTrigger>
                        }
                        items={timbreOptions.map((option) => ({
                            key: option.value,
                            label: option.label,
                            selected: previewTimbreId === option.value,
                            onSelect: () => void setPreviewTimbre(option.value),
                        }))}
                    />
                    <div className="flex-1" />
                    {tab === "mine" && songs.length > 0 && (
                        <Button
                            type="button"
                            color="destructive"
                            size="sm"
                            onClick={() => {
                                if (window.confirm("确定清空当前曲目列表？")) clearSongs();
                            }}
                        >
                            <Trash2 size={14} /> 清空列表
                        </Button>
                    )}
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
                            <p className="px-4 py-10 text-center text-sm text-ore-dim">
                                {songs.length === 0 ? "制作清单还是空的" : "没有匹配的曲目"}
                            </p>
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
        </div>
    );
}
