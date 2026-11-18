import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Menu, Textfield } from "@piano/ui";
import { MoreVertical, Pencil, QrCode, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import {
    ConfirmDialog,
    Dialog,
    EmptyState,
    FileDropzone,
    ImportCodeDialog,
    PageHeader,
    SongBadge,
    SongRow,
    notify,
    usePlayerState,
} from "@piano/ui";
import { api, formatDuration, type ImportCode, type MidiSongMeta } from "./api";
import { midiPlayer } from "./midiPlayer";

export function SongsPage() {
    const [q, setQ] = useState("");
    const [list, setList] = useState<MidiSongMeta[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [renameTarget, setRenameTarget] = useState<MidiSongMeta | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<MidiSongMeta | null>(null);
    const [code, setCode] = useState<ImportCode | null>(null);
    const [codeBusy, setCodeBusy] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const player = usePlayerState(midiPlayer);

    const load = async (kw = q, p = page) => {
        setBusy(true);
        setError("");
        try {
            const res = await api.listSongs(kw, p);
            setList(res.items);
            setTotal(res.total);
            setPage(p);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        void load("", 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const upload = async (files: File[]) => {
        if (files.length === 0) return;
        setBusy(true);
        setError("");
        let ok = 0;
        let fail = 0;
        for (const file of files) {
            try {
                await api.uploadSong(file);
                ok++;
            } catch (e) {
                fail++;
                notify({ title: `上传失败：${file.name}`, message: (e as Error).message, color: "red" });
            }
        }
        setBusy(false);
        await load();
        if (ok > 0) {
            notify({
                title: "上传完成",
                message: `成功 ${ok} 首${fail ? `，失败 ${fail} 首` : ""}`,
                color: fail ? "yellow" : "teal",
            });
        }
    };

    const confirmRemove = async () => {
        if (!deleteTarget) return;
        const song = deleteTarget;
        setDeleteTarget(null);
        try {
            await api.deleteSong(song.id);
            notify({ title: "曲目已删除", message: song.name, color: "teal" });
            await load();
        } catch (e) {
            notify({ title: "删除失败", message: (e as Error).message, color: "red" });
        }
    };

    const saveRename = async () => {
        if (!renameTarget) return;
        const clean = renameValue.trim();
        if (!clean || clean === renameTarget.name) {
            setRenameTarget(null);
            return;
        }
        try {
            await api.renameSong(renameTarget.id, clean);
            setRenameTarget(null);
            notify({ title: "已重命名", message: clean, color: "teal" });
            await load();
        } catch (e) {
            notify({ title: "重命名失败", message: (e as Error).message, color: "red" });
        }
    };

    const openCode = async (song: MidiSongMeta) => {
        setCodeBusy(song.id);
        try {
            const result = await api.getSongCode(song.id);
            setCode(result);
        } catch (e) {
            notify({ title: "生成导入码失败", message: (e as Error).message, color: "red" });
        } finally {
            setCodeBusy(null);
        }
    };

    const play = async (song: MidiSongMeta) => {
        const isCurrent = player.songId === song.id && player.status !== "idle";
        if (isCurrent && player.status === "playing") {
            midiPlayer.pause();
            return;
        }
        if (isCurrent && player.status === "paused") {
            midiPlayer.resume();
            return;
        }
        setPendingId(song.id);
        try {
            const buffer = await api.getSongRaw(song.id);
            await midiPlayer.play(song.id, buffer, song.name, song.duration / 40);
        } catch (e) {
            notify({ title: "播放失败", message: (e as Error).message, color: "red" });
        } finally {
            setPendingId(null);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Server Library"
                title="曲目库"
                description="管理服务端保存的 MIDI 曲目：上传、试听、重命名、生成游戏内导入码与删除。前端播放器使用 /piano 采样，跨页面保持播放状态。"
                actions={
                    <>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".mid,.midi"
                            multiple
                            hidden
                            onChange={(event) => {
                                const files = Array.from(event.target.files ?? []);
                                event.target.value = "";
                                if (files.length > 0) void upload(files);
                            }}
                        />
                        <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
                            <Upload size={14} /> 上传 MIDI
                        </Button>
                    </>
                }
            />

            <FileDropzone
                compact
                accept={[".mid", ".midi"]}
                title="拖入 MIDI 文件批量上传"
                description="上传后立即出现在服务端曲目库"
                icon={<Upload size={16} />}
                onDrop={(files) => void upload(files)}
            />

            <section className="flex flex-col">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-ore-divider pb-2.5">
                    <Textfield
                        className="w-[240px] shrink-0"
                        leading={<Search size={14} />}
                        placeholder="搜索曲名…"
                        value={q}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setQ(target.value);
                        }}
                        onKeyDown={(event: React.KeyboardEvent) => {
                            if (event.key === "Enter") void load(q, 1);
                        }}
                    />
                    <Button type="button" color="ghost" size="sm" loading={busy} onClick={() => void load(q, 1)}>
                        搜索
                    </Button>
                    <Button type="button" color="ghost" size="sm" loading={busy} onClick={() => void load("", 1)}>
                        <RefreshCw size={13} /> 刷新
                    </Button>
                    <div className="flex-1" />
                    <span className="text-[11px] tabular-nums text-ore-dim">
                        共 {total} 首 · 第 {page}/{totalPages} 页
                    </span>
                </div>

                {error && (
                    <div className="mt-3 rounded-md border px-3 py-2 text-xs pb-edge-danger pb-tint-danger">
                        请求失败：{error}
                    </div>
                )}

                <div>
                    {list.length === 0 && !busy ? (
                        <EmptyState
                            compact
                            title="还没有曲目"
                            description="上传 MIDI 后会显示在这里"
                            action={
                                <Button type="button" color="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                                    上传 MIDI
                                </Button>
                            }
                        />
                    ) : (
                        <div className="flex flex-col">
                            {list.map((song, index) => {
                                const isCurrent = player.songId === song.id && player.status !== "idle";
                                const rowMenu = [
                                    {
                                        key: "code",
                                        label: codeBusy === song.id ? "生成中…" : "生成导入码",
                                        icon: <QrCode size={13} />,
                                        onSelect: () => void openCode(song),
                                    },
                                    {
                                        key: "rename",
                                        label: "重命名",
                                        icon: <Pencil size={13} />,
                                        onSelect: () => {
                                            setRenameTarget(song);
                                            setRenameValue(song.name);
                                        },
                                    },
                                    {
                                        key: "delete",
                                        label: "删除",
                                        icon: <Trash2 size={13} />,
                                        danger: true,
                                        onSelect: () => setDeleteTarget(song),
                                    },
                                ];
                                return (
                                    <SongRow
                                        key={song.id}
                                        index={(page - 1) * pageSize + index + 1}
                                        title={song.name}
                                        id={song.id}
                                        duration={formatDuration(song.duration)}
                                        meta={[
                                            <span key="notes">
                                                {song.noteCount != null
                                                    ? `${song.noteCount.toLocaleString()} 音符`
                                                    : "音符数未知"}
                                            </span>,
                                            <span key="size">{song.dataSize != null ? formatBytes(song.dataSize) : "—"}</span>,
                                        ]}
                                        badges={isCurrent ? <SongBadge tone="success">播放中</SongBadge> : undefined}
                                        active={isCurrent}
                                        playState={
                                            pendingId === song.id
                                                ? "pending"
                                                : isCurrent && player.status === "playing"
                                                  ? "playing"
                                                  : "idle"
                                        }
                                        onPlay={() => void play(song)}
                                        menu={rowMenu}
                                        actions={
                                            <Menu
                                                align="end"
                                                minWidth={160}
                                                trigger={
                                                    <IconButton size="sm" aria-label="更多操作" title="更多操作">
                                                        <MoreVertical size={15} />
                                                    </IconButton>
                                                }
                                                items={rowMenu}
                                            />
                                        }
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-1.5 border-t border-ore-divider py-3">
                        <button
                            type="button"
                            className="rounded-md border border-ore-border px-2.5 py-1 text-xs text-ore-dim transition-colors hover:bg-[var(--pb-hover)] disabled:opacity-40"
                            disabled={busy || page <= 1}
                            onClick={() => void load(q, page - 1)}
                        >
                            上一页
                        </button>
                        <span className="px-2 text-xs tabular-nums text-ore-dim">
                            {page} / {totalPages}
                        </span>
                        <button
                            type="button"
                            className="rounded-md border border-ore-border px-2.5 py-1 text-xs text-ore-dim transition-colors hover:bg-[var(--pb-hover)] disabled:opacity-40"
                            disabled={busy || page >= totalPages}
                            onClick={() => void load(q, page + 1)}
                        >
                            下一页
                        </button>
                    </div>
                )}
            </section>

            <Dialog
                opened={Boolean(renameTarget)}
                onClose={() => setRenameTarget(null)}
                title="重命名曲目"
                size="sm"
                footer={
                    <>
                        <Button type="button" color="secondary" size="sm" onClick={() => setRenameTarget(null)}>
                            取消
                        </Button>
                        <Button type="button" size="sm" onClick={() => void saveRename()}>
                            保存
                        </Button>
                    </>
                }
            >
                <Textfield
                    autoFocus
                    label="曲目名称"
                    value={renameValue}
                    onInput={(event) => {
                        const target = event.target as unknown as { value?: unknown };
                        if (typeof target?.value === "string") setRenameValue(target.value);
                    }}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter") void saveRename();
                    }}
                />
            </Dialog>

            <ImportCodeDialog
                opened={Boolean(code)}
                onClose={() => setCode(null)}
                songName={code?.name ?? ""}
                chunks={code?.chunks ?? []}
                bytes={code?.bytes}
            />

            <ConfirmDialog
                opened={Boolean(deleteTarget)}
                title="删除曲目"
                danger
                confirmLabel="删除"
                description={`确定删除「${deleteTarget?.name ?? ""}」？该操作会同时移除服务端文件，且不可恢复。`}
                onConfirm={() => void confirmRemove()}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    );
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
