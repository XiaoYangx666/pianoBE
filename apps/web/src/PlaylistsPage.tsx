import { useEffect, useState } from "react";
import { api, type MidiSongMeta, type PlaylistMeta } from "./api";

export function PlaylistsPage() {
    const [mine, setMine] = useState<PlaylistMeta[]>([]);
    const [pub, setPub] = useState<PlaylistMeta[]>([]);
    const [error, setError] = useState("");
    const [detail, setDetail] = useState<
        (PlaylistMeta & { items: string[] }) | null
    >(null);
    const [songNames, setSongNames] = useState<Record<string, string>>({});

    const load = async () => {
        setError("");
        try {
            const [m, p, songs] = await Promise.all([
                api.listPlaylists(),
                api.listPlaylists("?public=1"),
                api.listSongs("", 1),
            ]);
            setMine(m.items);
            setPub(p.items.filter((x) => !m.items.some((y) => y.id === x.id)));
            setSongNames(
                Object.fromEntries(songs.items.map((s) => [s.id, s.name]))
            );
            if (detail) {
                const d = await api.getPlaylist(detail.id);
                setDetail({ ...d });
            }
        } catch (e) {
            setError((e as Error).message);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const create = async (name: string) => {
        if (name.trim().length < 2) return;
        await api.createPlaylist(name.trim());
        await load();
    };

    const patch = async (id: number, patch: { name?: string; public?: boolean }) => {
        await api.updatePlaylist(id, patch);
        await load();
    };

    const remove = async (id: number) => {
        if (!confirm("确认删除该播放列表？")) return;
        await api.deletePlaylist(id);
        setDetail(null);
        await load();
    };

    const addItems = async (ids: string[]) => {
        if (!detail) return;
        await api.setPlaylistItems(detail.id, [...detail.items, ...ids]);
        await load();
    };

    const removeItem = async (id: string) => {
        if (!detail) return;
        await api.setPlaylistItems(
            detail.id,
            detail.items.filter((x) => x !== id)
        );
        await load();
    };

    return (
        <section className="page">
            {error && <p className="error">{error}</p>}

            {detail ? (
                <div className="card">
                    <div className="toolbar">
                        <button onClick={() => setDetail(null)}>← 返回</button>
                        <input
                            defaultValue={detail.name}
                            onBlur={(e) =>
                                e.target.value !== detail.name &&
                                patch(detail.id, { name: e.target.value })
                            }
                        />
                        <button
                            className={detail.public ? "" : "primary"}
                            onClick={() => patch(detail.id, { public: !detail.public })}
                        >
                            {detail.public ? "公开中（点击设为私有）" : "设为公开"}
                        </button>
                        <button className="danger" onClick={() => remove(detail.id)}>
                            删除列表
                        </button>
                    </div>
                    <p className="hint">
                        {detail.items.length} 首 · 播放 {detail.playCount} 次
                    </p>
                    <h3>歌曲（{detail.items.length}）</h3>
                    <ul className="items">
                        {detail.items.map((id) => (
                            <li key={id}>
                                <span>{songNames[id] ?? id}</span>
                                <span className="mono">{id}</span>
                                <button className="danger" onClick={() => removeItem(id)}>
                                    移除
                                </button>
                            </li>
                        ))}
                        {detail.items.length === 0 && (
                            <li className="empty">列表为空</li>
                        )}
                    </ul>
                    <AddSongPicker
                        exclude={detail.items}
                        songNames={songNames}
                        onAdd={addItems}
                    />
                </div>
            ) : (
                <>
                    <CreateList onCreated={create} />
                    <h3>我的播放列表</h3>
                    <PlaylistTable
                        lists={mine}
                        onOpen={async (id) =>
                            setDetail(await api.getPlaylist(id))
                        }
                    />
                    <h3>公开广场</h3>
                    <PlaylistTable
                        lists={pub}
                        onOpen={async (id) =>
                            setDetail(await api.getPlaylist(id))
                        }
                    />
                </>
            )}
        </section>
    );
}

function CreateList({ onCreated }: { onCreated: (name: string) => Promise<void> }) {
    const [name, setName] = useState("");
    return (
        <div className="toolbar">
            <input
                placeholder="新列表名称（2~24 字）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        onCreated(name);
                        setName("");
                    }
                }}
            />
            <button
                className="primary"
                disabled={name.trim().length < 2}
                onClick={() => {
                    onCreated(name);
                    setName("");
                }}
            >
                创建列表
            </button>
        </div>
    );
}

function PlaylistTable({
    lists,
    onOpen,
}: {
    lists: PlaylistMeta[];
    onOpen: (id: number) => Promise<void>;
}) {
    return (
        <table>
            <thead>
                <tr>
                    <th>名称</th>
                    <th>作者</th>
                    <th>播放</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {lists.map((m) => (
                    <tr key={m.id}>
                        <td>{m.public ? "🌐 " : ""}{m.name}</td>
                        <td className="mono">{m.owner}</td>
                        <td>{m.playCount}</td>
                        <td>
                            <button onClick={() => onOpen(m.id)}>管理</button>
                        </td>
                    </tr>
                ))}
                {lists.length === 0 && (
                    <tr>
                        <td colSpan={4} className="empty">
                            暂无列表
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}

function AddSongPicker({
    exclude,
    songNames,
    onAdd,
}: {
    exclude: string[];
    songNames: Record<string, string>;
    onAdd: (ids: string[]) => Promise<void>;
}) {
    const [q, setQ] = useState("");
    const [result, setResult] = useState<MidiSongMeta[]>([]);

    const search = async () => {
        const res = await api.listSongs(q);
        setResult(res.items.filter((s) => !exclude.includes(s.id)));
    };

    return (
        <div className="card add-picker">
            <div className="toolbar">
                <input
                    placeholder="搜索曲库添加歌曲"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && search()}
                />
                <button onClick={search}>搜索</button>
            </div>
            <ul className="items">
                {result.map((s) => (
                    <li key={s.id}>
                        <span>{s.name}</span>
                        <span className="mono">{s.id}</span>
                        <button
                            onClick={() => {
                                onAdd([s.id]);
                                setResult(result.filter((x) => x.id !== s.id));
                            }}
                        >
                            添加
                        </button>
                    </li>
                ))}
                {result.length === 0 && <li className="empty">搜索后选择歌曲</li>}
            </ul>
            {Object.keys(songNames).length > 0 && null}
        </div>
    );
}