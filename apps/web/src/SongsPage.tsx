import { useEffect, useRef, useState } from "react";
import { api, formatDuration, type MidiSongMeta } from "./api";

export function SongsPage() {
    const [q, setQ] = useState("");
    const [list, setList] = useState<MidiSongMeta[]>([]);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = async (kw = q) => {
        setBusy(true);
        setError("");
        try {
            const res = await api.listSongs(kw);
            setList(res.items);
            setTotal(res.total);
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

    return (
        <section className="page">
            <div className="toolbar">
                <input
                    placeholder="搜索曲名..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && load()}
                />
                <button onClick={() => load()}>搜索</button>
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
            <p className="hint">共 {total} 首{busy ? "（加载中...）" : ""}</p>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>曲名</th>
                        <th>时长</th>
                        <th>ID</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {list.map((m, i) => (
                        <tr key={m.id}>
                            <td>{i + 1}</td>
                            <td>{m.name}</td>
                            <td>{formatDuration(m.duration)}</td>
                            <td className="mono">{m.id}</td>
                            <td>
                                <button className="danger" onClick={() => remove(m.id)}>
                                    删除
                                </button>
                            </td>
                        </tr>
                    ))}
                    {list.length === 0 && !busy && (
                        <tr>
                            <td colSpan={5} className="empty">
                                暂无曲目，点击"上传 MIDI"导入
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </section>
    );
}