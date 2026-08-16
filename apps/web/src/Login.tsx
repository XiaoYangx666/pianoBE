import { useState } from "react";
import { api, setToken } from "./api";

export function Login({ onLogin }: { onLogin: (t: string) => void }) {
    const [value, setValue] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        const token = value.trim();
        if (!token) return;
        setBusy(true);
        setError("");
        try {
            setToken(token);
            await api.listSongs(); // 验证令牌有效性
            onLogin(token);
        } catch (e) {
            setToken(null);
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="login">
            <div className="card">
                <h1>PianoBE 曲库管理</h1>
                <p className="hint">
                    输入后端 API 令牌登录（由管理员在服务端环境变量 BOOTSTRAP_TOKEN
                    或令牌管理中获取）
                </p>
                <input
                    type="password"
                    placeholder="API Token"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                {error && <p className="error">{error}</p>}
                <button disabled={busy || !value.trim()} onClick={submit}>
                    {busy ? "验证中..." : "登录"}
                </button>
            </div>
        </div>
    );
}