import { useEffect, useState } from "react";
import { api, type TokenInfo } from "./api";

export function TokensPage() {
    const [list, setList] = useState<TokenInfo[]>([]);
    const [label, setLabel] = useState("");
    const [role, setRole] = useState("read");
    const [created, setCreated] = useState<{ label: string; role: string; token: string } | null>(null);
    const [error, setError] = useState("");
    const [forbidden, setForbidden] = useState(false);

    const load = async () => {
        setError("");
        try {
            const res = await api.listTokens();
            setList(res.items);
            setForbidden(false);
        } catch (e) {
            setForbidden(true);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const create = async () => {
        setError("");
        try {
            const res = await api.createToken(label.trim(), role);
            setCreated(res);
            setLabel("");
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const revoke = async (id: number, labelName: string) => {
        if (!confirm(`确认吊销令牌「${labelName}」？`)) return;
        await api.revokeToken(id);
        await load();
    };

    if (forbidden) {
        return (
            <section className="page">
                <p className="error">当前令牌没有管理员权限，无法管理令牌。</p>
            </section>
        );
    }

    return (
        <section className="page">
            <h3>创建令牌（分发给外部服务/前端共用）</h3>
            <div className="toolbar">
                <input
                    placeholder="身份标签（如 my-uploader）"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                />
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="read">read（只读）</option>
                    <option value="write">write（读写）</option>
                    <option value="admin">admin（管理）</option>
                </select>
                <button className="primary" disabled={!label.trim()} onClick={create}>
                    创建
                </button>
            </div>
            {error && <p className="error">{error}</p>}
            {created && (
                <div className="card token-once">
                    <p>令牌「{created.label}」创建成功，明文仅显示一次，请立即保存：</p>
                    <textarea readOnly value={created.token} rows={2} />
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(created.token);
                        }}
                    >
                        复制
                    </button>
                    <button onClick={() => setCreated(null)}>关闭</button>
                </div>
            )}
            <h3>令牌列表</h3>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>标签</th>
                        <th>角色</th>
                        <th>创建时间</th>
                        <th>状态</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {list.map((t) => (
                        <tr key={t.id}>
                            <td>{t.id}</td>
                            <td>{t.label}</td>
                            <td>{t.role}</td>
                            <td>{new Date(t.created_at).toLocaleString()}</td>
                            <td>{t.revoked ? "已吊销" : "有效"}</td>
                            <td>
                                {!t.revoked && (
                                    <button
                                        className="danger"
                                        onClick={() => revoke(t.id, t.label)}
                                    >
                                        吊销
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}