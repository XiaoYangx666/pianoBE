import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, Music2, Package, Plus, Search, Sparkles } from "lucide-react";
import { TIME_SCALE, type LibraryRecord } from "@piano/core";
import type { PbePluginArchive, PluginSongEntry } from "@piano/vfx/package";
import {
    Button,
    Dialog,
    IconButton,
    SongBadge,
    SongRow,
    Spinner,
    Textfield,
    VirtualSongList,
    notify,
    songTableGrid,
    usePlayingSongId,
} from "@piano/ui";
import type { StudioPlugin } from "../adapters/types";
import { studioPlayer } from "../audio/player";
import { useStudio } from "../store/studio";

function formatDur(scaled: number): string {
    const sec = Math.max(0, Math.floor(scaled / TIME_SCALE));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export interface PluginContentDialogProps {
    plugin: StudioPlugin | null;
    plugins?: readonly StudioPlugin[];
    onSelectPlugin?: (plugin: StudioPlugin) => void;
    libraries: readonly LibraryRecord[];
    existingSongIds: ReadonlySet<string>;
    existingFingerprints: ReadonlySet<string>;
    onClose: () => void;
    onLoadArchive: (plugin: StudioPlugin) => Promise<PbePluginArchive>;
    onInstallPack: (pluginId: string) => Promise<void>;
    onImportSingle: (
        archive: PbePluginArchive,
        songId: string,
        opts: { includePerformances: boolean; targetLibraryId?: string },
    ) => Promise<void>;
}

export function PluginContentDialog({
    plugin,
    plugins,
    onSelectPlugin,
    libraries,
    existingSongIds,
    existingFingerprints,
    onClose,
    onLoadArchive,
    onInstallPack,
    onImportSingle,
}: PluginContentDialogProps) {
    const mode = useStudio((s) => s.mode);
    const activePlayId = usePlayingSongId(studioPlayer);

    const [archive, setArchive] = useState<PbePluginArchive | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [activeLibFilter, setActiveLibFilter] = useState<string>("all");
    const [includePerformances, setIncludePerformances] = useState(true);
    const [targetLibraryId, setTargetLibraryId] = useState<string>("");
    const [importingId, setImportingId] = useState<string | null>(null);
    const [installingPack, setInstallingPack] = useState(false);

    const writableLibraries = useMemo(
        () => libraries.filter((l) => !l.readonly),
        [libraries],
    );

    useEffect(() => {
        if (!targetLibraryId && writableLibraries.length > 0) {
            const def =
                writableLibraries.find((l) => l.id === "user-default" || l.id === "default") ??
                writableLibraries[0];
            setTargetLibraryId(def.id);
        }
    }, [targetLibraryId, writableLibraries]);

    useEffect(() => {
        if (!plugin) {
            setArchive(null);
            setError(null);
            setQuery("");
            setActiveLibFilter("all");
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setArchive(null);
        onLoadArchive(plugin)
            .then((loaded) => {
                if (!cancelled) setArchive(loaded);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [plugin, onLoadArchive]);

    const songsList = useMemo<PluginSongEntry[]>(() => {
        if (!archive) return [];
        const allowed =
            activeLibFilter === "all"
                ? null
                : new Set(archive.libraries.find((l) => l.id === activeLibFilter)?.songs ?? []);
        const q = query.trim().toLowerCase();
        return [...archive.songs.values()].filter((s) => {
            if (allowed && !allowed.has(s.id)) return false;
            if (!q) return true;
            return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
        });
    }, [archive, activeLibFilter, query]);

    const perfsBySong = useMemo(() => {
        const map = new Map<string, string[]>();
        if (!archive) return map;
        for (const perf of archive.performances) {
            const arr = map.get(perf.songId) ?? [];
            arr.push(perf.name);
            map.set(perf.songId, arr);
        }
        return map;
    }, [archive]);

    const handlePreview = useCallback(
        (song: PluginSongEntry) => {
            const playId = `pack:${plugin?.id ?? ""}:${song.id}`;
            void studioPlayer
                .toggleSong(playId, song.name, async () => song.bytes, "pbe3")
                .catch((err) =>
                    notify({
                        title: "试听失败",
                        message: err instanceof Error ? err.message : String(err),
                        color: "red",
                    }),
                );
        },
        [plugin?.id],
    );

    const handleAddSingle = useCallback(
        async (song: PluginSongEntry) => {
            if (!archive) return;
            setImportingId(song.id);
            try {
                await onImportSingle(archive, song.id, {
                    includePerformances,
                    targetLibraryId: targetLibraryId || undefined,
                });
            } catch (err) {
                notify({
                    title: "添加单曲失败",
                    message: err instanceof Error ? err.message : String(err),
                    color: "red",
                });
            } finally {
                setImportingId(null);
            }
        },
        [archive, includePerformances, onImportSingle, targetLibraryId],
    );

    const renderRow = useCallback(
        (song: PluginSongEntry, index: number) => {
            const playId = `pack:${plugin?.id ?? ""}:${song.id}`;
            const isPlaying = activePlayId === playId;
            const perfNames = perfsBySong.get(song.id) ?? [];
            const alreadyOwned =
                existingSongIds.has(song.id) || existingFingerprints.has(song.musicFingerprint);

            return (
                <SongRow
                    layout="table"
                    statsColumns={1}
                    index={index + 1}
                    title={song.name}
                    stats={[song.noteCount.toLocaleString()]}
                    meta={[`${song.noteCount} 音符`]}
                    duration={formatDur(song.duration)}
                    active={isPlaying}
                    playState={isPlaying ? "playing" : "idle"}
                    onPlay={() => handlePreview(song)}
                    badges={
                        perfNames.length > 0 ? (
                            <SongBadge tone="brand">
                                <Sparkles size={10} className="mr-1 inline" />
                                {perfNames[0]}
                            </SongBadge>
                        ) : undefined
                    }
                    trailing={
                        alreadyOwned ? (
                            <span
                                className="inline-flex h-8 items-center gap-1 px-2 text-[11.5px] text-brand"
                                title="已在当前曲库中"
                            >
                                <Check size={13} /> 已在库中
                            </span>
                        ) : (
                            <IconButton
                                size="sm"
                                color="ghost"
                                aria-label="添加单曲到我的曲库"
                                title="添加单曲到我的曲库"
                                loading={importingId === song.id}
                                onClick={() => void handleAddSingle(song)}
                                className="text-ore-dim hover:bg-brand/10 hover:text-brand"
                            >
                                <Plus size={15} />
                            </IconButton>
                        )
                    }
                />
            );
        },
        [
            activePlayId,
            existingFingerprints,
            existingSongIds,
            handleAddSingle,
            handlePreview,
            importingId,
            perfsBySong,
            plugin?.id,
        ],
    );

    if (!plugin) return null;

    return (
        <Dialog
            opened={Boolean(plugin)}
            onClose={onClose}
            size="lg"
            title={
                <span className="flex min-w-0 items-center gap-2">
                    <Package size={17} className="shrink-0 text-brand" />
                    <span className="truncate">{plugin.name}</span>
                    <SongBadge>v{plugin.version}</SongBadge>
                </span>
            }
            footer={
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <div className="text-[11.5px] text-ore-dim">
                        {archive
                            ? `包内共 ${archive.songs.size} 首曲目 · ${archive.performances.length} 套演出`
                            : "正在读取包内容…"}
                    </div>
                    <div className="flex items-center gap-2">
                        {!plugin.installed && (
                            <Button
                                type="button"
                                size="sm"
                                loading={installingPack}
                                onClick={() => {
                                    setInstallingPack(true);
                                    void onInstallPack(plugin.id)
                                        .then(() => onClose())
                                        .finally(() => setInstallingPack(false));
                                }}
                            >
                                <Download size={14} /> 整包安装到{mode === "server" ? "服务器" : "本地"}
                            </Button>
                        )}
                        <Button type="button" color="secondary" size="sm" onClick={onClose}>
                            关闭
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                {plugins && plugins.length > 1 && onSelectPlugin && (
                    <div className="flex flex-wrap gap-1.5">
                        {plugins.map((pack) => {
                            const selected = pack.id === plugin.id;
                            return (
                                <button
                                    key={pack.id}
                                    type="button"
                                    onClick={() => onSelectPlugin(pack)}
                                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                                        selected
                                            ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                            : "border-ore-border bg-ore-raised text-ore-dim hover:text-ore-text"
                                    }`}
                                >
                                    <span>{pack.name}</span>
                                    <span className="text-[11px] opacity-75">({pack.contents.songs})</span>
                                    {pack.installed && (
                                        <span className="text-[10px] text-brand">· 已装</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                {plugin.description && (
                    <p className="text-[12px] leading-relaxed text-ore-dim">{plugin.description}</p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ore-divider bg-ore-raised px-3 py-2 text-[12px]">
                    <div className="flex flex-wrap items-center gap-3">
                        {writableLibraries.length > 0 && (
                            <label className="flex items-center gap-1.5">
                                <span className="text-ore-dim">添加到曲库：</span>
                                <select
                                    value={targetLibraryId}
                                    onChange={(e) => setTargetLibraryId(e.target.value)}
                                    className="h-7 rounded border border-[var(--pb-control-border)] bg-ore-sunken px-2 text-[12px]"
                                >
                                    {writableLibraries.map((lib) => (
                                        <option key={lib.id} value={lib.id}>
                                            {lib.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {Boolean(archive?.performances.length) && (
                            <label className="flex cursor-pointer items-center gap-1.5">
                                <input
                                    type="checkbox"
                                    checked={includePerformances}
                                    onChange={(e) => setIncludePerformances(e.currentTarget.checked)}
                                    className="h-3.5 w-3.5 accent-[var(--pb-primary)]"
                                />
                                <span>同时导入附带演出</span>
                            </label>
                        )}
                    </div>
                    <div className="w-full sm:w-[220px]">
                        <Textfield
                            leading={<Search size={13} />}
                            placeholder="筛选包内曲目…"
                            value={query}
                            onInput={(e) => {
                                const t = e.target as unknown as { value?: unknown };
                                if (typeof t?.value === "string") setQuery(t.value);
                            }}
                        />
                    </div>
                </div>

                {archive && archive.libraries.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            onClick={() => setActiveLibFilter("all")}
                            className={`rounded-md border px-2 py-0.5 text-[11.5px] ${
                                activeLibFilter === "all"
                                    ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                    : "border-ore-border bg-ore-raised text-ore-dim"
                            }`}
                        >
                            全部 ({archive.songs.size})
                        </button>
                        {archive.libraries.map((lib) => (
                            <button
                                key={lib.id}
                                type="button"
                                onClick={() => setActiveLibFilter(lib.id)}
                                className={`rounded-md border px-2 py-0.5 text-[11.5px] ${
                                    activeLibFilter === lib.id
                                        ? "border-brand bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                        : "border-ore-border bg-ore-raised text-ore-dim"
                                }`}
                            >
                                {lib.name} ({lib.songs.length})
                            </button>
                        ))}
                    </div>
                )}

                {loading ? (
                    <div className="grid h-[260px] place-items-center text-ore-dim">
                        <div className="flex flex-col items-center gap-2 text-[12px]">
                            <Spinner size={20} />
                            <span>正在下载并解析扩展包内容…</span>
                        </div>
                    </div>
                ) : error ? (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-[12px] text-red-400">
                        {error}
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-ore-border bg-ore-sunken">
                        <div
                            className={`hidden items-center gap-3 border-b border-ore-border bg-[var(--pb-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dim md:grid ${songTableGrid(1)}`}
                        >
                            <span className="text-center">#</span>
                            <span>曲目</span>
                            <span className="text-right">音符</span>
                            <span className="text-right">时长</span>
                            <span />
                        </div>
                        <VirtualSongList
                            className="h-[min(380px,50vh)]"
                            items={songsList}
                            rowHeight={50}
                            gap={0}
                            getKey={(s) => s.id}
                            renderItem={renderRow}
                            empty={
                                <div className="grid h-[200px] place-items-center text-[12.5px] text-ore-dim">
                                    <div className="flex flex-col items-center gap-2">
                                        <Music2 size={20} />
                                        <span>没有匹配的曲目</span>
                                    </div>
                                </div>
                            }
                        />
                    </div>
                )}
            </div>
        </Dialog>
    );
}
