import { useEffect, useState } from "react";
import { Button, IconButton, Textfield } from "@piano/ui";
import { ArrowLeft, Globe2, ListMusic, Plus, Search, Trash2, UserRound } from "lucide-react";
import {
    ConfirmDialog,
    EmptyState,
    PageHeader,
    SongBadge,
    SongRow,
    notify,
} from "@piano/ui";
import { api, type MidiSongMeta, type PlaylistMeta } from "./api";

export function PlaylistsPage() {
    const [mine, setMine] = useState<PlaylistMeta[]>([]);
    const [publicLists, setPublicLists] = useState<PlaylistMeta[]>([]);
    const [error, setError] = useState("");
    const [detail, setDetail] = useState<(PlaylistMeta & { items: string[] }) | null>(null);
    const [songNames, setSongNames] = useState<Record<string, string>>({});
    const [newName, setNewName] = useState("");
    const [busy, setBusy] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<PlaylistMeta | null>(null);

    const load = async (keepDetail = true) => {
        setError("");
        try {
            const [mineRes, publicRes, songs] = await Promise.all([
                api.listPlaylists(),
                api.listPlaylists("?public=1"),
                api.listSongs("", 1),
            ]);
            setMine(mineRes.items);
            setPublicLists(publicRes.items.filter((item) => !mineRes.items.some((own) => own.id === item.id)));
            setSongNames(Object.fromEntries(songs.items.map((song) => [song.id, song.name])));
            if (keepDetail && detail) {
                setDetail(await api.getPlaylist(detail.id));
            }
        } catch (e) {
            setError((e as Error).message);
        }
    };

    useEffect(() => {
        void load(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const create = async () => {
        const name = newName.trim();
        if (name.length < 2) return;
        setBusy(true);
        try {
            await api.createPlaylist(name);
            setNewName("");
            notify({ title: "播放列表已创建", message: name, color: "teal" });
            await load(false);
        } catch (e) {
            notify({ title: "创建失败", message: (e as Error).message, color: "red" });
        } finally {
            setBusy(false);
        }
    };

    const open = async (id: number) => {
        setBusy(true);
        try {
            setDetail(await api.getPlaylist(id));
        } catch (e) {
            notify({ title: "加载失败", message: (e as Error).message, color: "red" });
        } finally {
            setBusy(false);
        }
    };

    const patch = async (id: number, patchValue: { name?: string; public?: boolean }) => {
        await api.updatePlaylist(id, patchValue);
        await load();
    };

    const confirmRemove = async () => {
        if (!deleteTarget) return;
        const playlist = deleteTarget;
        setDeleteTarget(null);
        try {
            await api.deletePlaylist(playlist.id);
            setDetail(null);
            notify({ title: "播放列表已删除", message: playlist.name, color: "teal" });
            await load(false);
        } catch (e) {
            notify({ title: "删除失败", message: (e as Error).message, color: "red" });
        }
    };

    const setItems = async (items: string[]) => {
        if (!detail) return;
        try {
            await api.setPlaylistItems(detail.id, items);
            await load();
        } catch (e) {
            notify({ title: "更新失败", message: (e as Error).message, color: "red" });
        }
    };

    const errorBanner = error && (
        <div className="rounded-md border px-3 py-2 text-xs pb-edge-danger pb-tint-danger">{error}</div>
    );

    if (detail) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader
                    eyebrow="Playlist"
                    title={detail.name}
                    description={`${detail.items.length} 首曲目 · 播放 ${detail.playCount} 次 · 所有者 ${detail.owner}`}
                    actions={
                        <>
                            <Button type="button" color="secondary" size="sm" onClick={() => setDetail(null)}>
                                <ArrowLeft size={14} /> 返回列表
                            </Button>
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => void patch(detail.id, { public: !detail.public })}
                            >
                                <Globe2 size={14} /> {detail.public ? "公开中" : "设为公开"}
                            </Button>
                            <Button type="button" color="destructive" size="sm" onClick={() => setDeleteTarget(detail)}>
                                <Trash2 size={14} /> 删除
                            </Button>
                        </>
                    }
                />

                {errorBanner}

                <section className="flex flex-col gap-4 border-b border-ore-divider pb-5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <Textfield
                            className="w-[280px]"
                            label="播放列表名称"
                            value={detail.name}
                            onBlur={(event: React.FocusEvent<HTMLElement>) => {
                                const value = (event.target as unknown as { value?: string }).value?.trim();
                                if (value && value !== detail.name) void patch(detail.id, { name: value });
                            }}
                        />
                        <label className="flex items-center gap-2 text-xs text-ore-dim">
                            <input
                                type="checkbox"
                                className="h-4 w-4 accent-[var(--pb-primary)]"
                                checked={detail.public}
                                onChange={(event) => void patch(detail.id, { public: event.currentTarget.checked })}
                            />
                            {detail.public ? "所有人可见" : "仅自己可见"}
                        </label>
                    </div>

                    <div>
                        <div className="mb-1 text-[13px] font-semibold">曲目（{detail.items.length}）</div>
                        {detail.items.length === 0 ? (
                            <EmptyState compact title="列表为空" description="从下方搜索并添加曲目" />
                        ) : (
                            <div className="flex flex-col border-t border-ore-divider">
                                {detail.items.map((id, index) => (
                                    <SongRow
                                        key={`${id}-${index}`}
                                        index={index + 1}
                                        title={songNames[id] ?? id}
                                        id={id}
                                        onRemove={() => void setItems(detail.items.filter((item) => item !== id))}
                                        removeLabel="从列表移除"
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                <AddSongPicker exclude={detail.items} onAdd={(ids) => void setItems([...detail.items, ...ids])} />

                <ConfirmDialog
                    opened={Boolean(deleteTarget)}
                    title="删除播放列表"
                    danger
                    confirmLabel="删除"
                    description={`确定删除「${deleteTarget?.name ?? ""}」？该操作不可恢复。`}
                    onConfirm={() => void confirmRemove()}
                    onCancel={() => setDeleteTarget(null)}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Playlists"
                title="播放列表"
                description="管理服务端播放列表、公开状态与曲目顺序。公开列表会出现在「公开广场」。"
            />

            {errorBanner}

            <section className="flex flex-wrap items-end gap-2.5 border-b border-ore-divider pb-5">
                <Textfield
                    className="w-[280px]"
                    label="新建播放列表"
                    placeholder="列表名称（2~24 字）"
                    value={newName}
                    onInput={(event) => {
                        const target = event.target as unknown as { value?: unknown };
                        if (typeof target?.value === "string") setNewName(target.value);
                    }}
                    onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter") void create();
                    }}
                />
                <Button
                    type="button"
                    size="sm"
                    loading={busy}
                    disabled={newName.trim().length < 2}
                    onClick={() => void create()}
                >
                    <Plus size={14} /> 创建
                </Button>
            </section>

            <PlaylistSection
                title="我的播放列表"
                description="由当前令牌拥有的列表"
                lists={mine}
                onOpen={open}
                onRemove={(playlist) => setDeleteTarget(playlist)}
                empty="还没有创建播放列表"
            />
            <PlaylistSection
                title="公开广场"
                description="其他用户公开的播放列表"
                lists={publicLists}
                onOpen={open}
                empty="暂无公开播放列表"
            />

            <ConfirmDialog
                opened={Boolean(deleteTarget)}
                title="删除播放列表"
                danger
                confirmLabel="删除"
                description={`确定删除「${deleteTarget?.name ?? ""}」？该操作不可恢复。`}
                onConfirm={() => void confirmRemove()}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    );
}

function PlaylistSection({
    title,
    description,
    lists,
    onOpen,
    onRemove,
    empty,
}: {
    title: string;
    description: string;
    lists: PlaylistMeta[];
    onOpen: (id: number) => Promise<void>;
    onRemove?: (playlist: PlaylistMeta) => void;
    empty: string;
}) {
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-[13px] font-semibold">{title}</div>
                <div className="text-[11px] text-ore-dimmer">{description}</div>
            </div>
            <div className="border-t border-ore-divider">
                {lists.length === 0 ? (
                    <EmptyState compact icon={<ListMusic size={20} />} title={empty} />
                ) : (
                    <div className="flex flex-col">
                        {lists.map((playlist) => (
                            <SongRow
                                key={playlist.id}
                                leading={
                                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand/10 text-[color:var(--pb-primary-light)]">
                                        <ListMusic size={15} />
                                    </div>
                                }
                                title={playlist.name}
                                badges={
                                    playlist.public ? <SongBadge tone="success">公开</SongBadge> : <SongBadge>私有</SongBadge>
                                }
                                meta={[
                                    <span key="owner" className="inline-flex items-center gap-1">
                                        <UserRound size={11} />
                                        {playlist.owner}
                                    </span>,
                                    <span key="plays">{playlist.playCount} 次播放</span>,
                                    <span key="updated">{new Date(playlist.updatedAt * 1000).toLocaleDateString()}</span>,
                                ]}
                                actions={
                                    <div className="flex items-center gap-1">
                                        <Button type="button" color="ghost" size="sm" onClick={() => void onOpen(playlist.id)}>
                                            打开
                                        </Button>
                                        {onRemove && (
                                            <IconButton
                                                size="sm"
                                                aria-label="删除播放列表"
                                                title="删除播放列表"
                                                className="hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                                                onClick={() => onRemove(playlist)}
                                            >
                                                <Trash2 size={14} />
                                            </IconButton>
                                        )}
                                    </div>
                                }
                                menu={[
                                    {
                                        key: "open",
                                        label: "打开",
                                        icon: <ListMusic size={13} />,
                                        onSelect: () => void onOpen(playlist.id),
                                    },
                                    ...(onRemove
                                        ? [
                                              {
                                                  key: "remove",
                                                  label: "删除播放列表",
                                                  icon: <Trash2 size={13} />,
                                                  danger: true,
                                                  onSelect: () => onRemove(playlist),
                                              },
                                          ]
                                        : []),
                                ]}
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

function AddSongPicker({ exclude, onAdd }: { exclude: string[]; onAdd: (ids: string[]) => void }) {
    const [q, setQ] = useState("");
    const [result, setResult] = useState<MidiSongMeta[]>([]);
    const [searching, setSearching] = useState(false);

    const search = async () => {
        setSearching(true);
        try {
            const res = await api.listSongs(q);
            setResult(res.items.filter((song) => !exclude.includes(song.id)));
        } finally {
            setSearching(false);
        }
    };

    return (
        <section className="flex flex-col gap-3 border-t border-ore-divider pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="text-[13px] font-semibold">添加曲目</div>
                    <div className="mt-0.5 text-[11.5px] text-ore-dim">搜索服务端曲目并加入当前播放列表</div>
                </div>
                <div className="flex items-center gap-2">
                    <Textfield
                        className="w-[220px]"
                        leading={<Search size={14} />}
                        placeholder="搜索曲名"
                        value={q}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setQ(target.value);
                        }}
                        onKeyDown={(event: React.KeyboardEvent) => {
                            if (event.key === "Enter") void search();
                        }}
                    />
                    <Button type="button" color="secondary" size="sm" loading={searching} onClick={() => void search()}>
                        <Search size={13} /> 搜索
                    </Button>
                </div>
            </div>
            <div className="flex flex-col border-t border-ore-divider">
                {result.map((song) => (
                    <SongRow
                        key={song.id}
                        title={song.name}
                        id={song.id}
                        meta={[`${(song.noteCount ?? 0).toLocaleString()} 音符`]}
                        actions={
                            <Button
                                type="button"
                                color="ghost"
                                size="sm"
                                onClick={() => {
                                    onAdd([song.id]);
                                    setResult((current) => current.filter((item) => item.id !== song.id));
                                }}
                            >
                                <Plus size={13} /> 添加
                            </Button>
                        }
                        menu={[
                            {
                                key: "add",
                                label: "加入播放列表",
                                icon: <Plus size={13} />,
                                onSelect: () => {
                                    onAdd([song.id]);
                                    setResult((current) => current.filter((item) => item.id !== song.id));
                                },
                            },
                        ]}
                    />
                ))}
                {result.length === 0 && (
                    <div className="py-6 text-center text-[11.5px] text-ore-dim">
                        {searching ? "搜索中…" : "输入关键词后搜索"}
                    </div>
                )}
            </div>
        </section>
    );
}
