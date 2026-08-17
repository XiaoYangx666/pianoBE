import { useEffect, useRef, useState } from "react";
import { api, formatDuration, type MidiSongMeta } from "./api";
import { midiPlayer, type PlayerState } from "./midiPlayer";
export function SongsPage() {
    const [q, setQ] = useState("");
    const [list, setList] = useState<MidiSongMeta[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

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
        load("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const upload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setBusy(true);
        setError("");
        let ok = 0;
        let fail = 0;
        for (const f of Array.from(files)) {
            try {
                await api.uploadSong(f);
                ok++;
            } catch (e) {
                fail++;
                setError(`「${f.name}」上传失败: ${(e as Error).message}`);
            }
        }
        if (fileRef.current) fileRef.current.value = "";
        setBusy(false);
        await load();
        if (fail === 0 && ok > 0) setError(`成功上传 ${ok} 首`);
    };

    const remove = async (id: string) => {
        if (!confirm("确认删除该曲目？")) return;
        try {
            await api.deleteSong(id);
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <section className="page">
            <div className="toolbar">
                <input
                    placeholder="搜索曲名..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && load(q, 1)}
                />
                <button onClick={() => load(q, 1)}>搜索</button>
                <label className="btn primary">
                    上传 MIDI
                    <input
                        ref={fileRef}
                        type="file"
                        multiple
                        accept=".mid,.midi"
                        style={{ display: "none" }}
                        onChange={(e) => upload(e.target.files)}
                    />
                </label>
            </div>
            {error && <p className="error">{error}</p>}
            <p className="hint">共 {total} 首 · 第 {page}/{totalPages} 页{busy ? "（加载中...）" : ""}</p>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>曲名</th>
                            <th>时长</th>
                            <th>音符数</th>
                            <th>大小</th>
                            <th className="hide-mobile">ID</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map((m, i) => (
                            <tr key={m.id}>
                                <td>{(page - 1) * pageSize + i + 1}</td>
                                <td>
                                    <EditableName
                                        id={m.id}
                                        name={m.name}
                                        onError={(e) => setError(e)}
                                    />
                                </td>
                                <td>{formatDuration(m.duration)}</td>
                                <td>{m.noteCount?.toLocaleString() ?? "-"}</td>
                                <td>{m.dataSize != null ? formatBytes(m.dataSize) : "-"}</td>
                                <td className="mono hide-mobile">{m.id}</td>
                                <td>
                                    <PlayButton
                                        song={m}
                                        onError={(e) => setError(e)}
                                    />
                                    <button className="danger" onClick={() => remove(m.id)}>
                                        删除
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {list.length === 0 && !busy && (
                            <tr>
                                <td colSpan={7} className="empty">
                                    暂无曲目，点击"上传 MIDI"导入
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <Pagination
                page={page}
                totalPages={totalPages}
                busy={busy}
                onChange={(p) => load("", p)}
            />
        </section>
    );
}

function Pagination({
    page,
    totalPages,
    busy,
    onChange,
}: {
    page: number;
    totalPages: number;
    busy: boolean;
    onChange: (p: number) => void;
}) {
    if (totalPages <= 1) return null;
    return (
        <div className="pagination">
            <button disabled={page <= 1 || busy} onClick={() => onChange(page - 1)}>
                上一页
            </button>
            <span className="hint">
                第 {page} / {totalPages} 页
            </span>
            <button disabled={page >= totalPages || busy} onClick={() => onChange(page + 1)}>
                下一页
            </button>
        </div>
    );
}

function EditableName({
    id,
    name,
    onError,
}: {
    id: string;
    name: string;
    onError: (msg: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(name);

    const save = async () => {
        const clean = value.trim();
        setEditing(false);
        if (!clean || clean === name) return;
        try {
            await api.renameSong(id, clean);
        } catch (e) {
            onError((e as Error).message);
            setValue(name);
        }
    };

    if (editing) {
        return (
            <input
                autoFocus
                className="rename-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") {
                        setValue(name);
                        setEditing(false);
                    }
                }}
            />
        );
    }
    return (
        <span className="song-name" title="点击改名" onClick={() => setEditing(true)}>
            {name}
        </span>
    );
}

function PlayButton({
    song,
    onError,
}: {
    song: MidiSongMeta;
    onError: (msg: string) => void;
}) {
    const [state, setState] = useState<PlayerState>(midiPlayer.getState());

    useEffect(() => midiPlayer.subscribe(setState), []);

    const isCurrent = state.songId === song.id && state.status !== "idle";

    const click = async () => {
        if (isCurrent && state.status === "playing") {
            midiPlayer.pause();
            return;
        }
        if (isCurrent && state.status === "paused") {
            midiPlayer.resume();
            return;
        }
        try {
            const buffer = await api.getSongRaw(song.id);
            // duration 已按 TIME_SCALE=40 缩放，换算秒
            await midiPlayer.play(song.id, buffer, song.name, song.duration / 40);
        } catch (e) {
            onError((e as Error).message);
        }
    };

    const isPlaying = isCurrent && state.status === "playing";
    const isPaused = isCurrent && state.status === "paused";

    return (
        <button
            className={isCurrent ? "active" : ""}
            onClick={click}
            title={isPlaying ? "暂停" : "试听"}
        >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
    );
}

function PlayIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}