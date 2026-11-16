import { useState } from "react";
import { Button, PianoMark, Textfield, ThemeToggle } from "@piano/ui";
import { LogIn } from "lucide-react";
import { api, setToken } from "./api";

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
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
            await api.listSongs();
            onLogin(token);
        } catch (e) {
            setToken(null);
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="relative grid min-h-dvh place-items-center bg-ore-sunken p-5">
            <div className="absolute right-4 top-4">
                <ThemeToggle />
            </div>
            <div className="w-full max-w-[360px]">
                <div className="mb-8">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--pb-primary-light)]">
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--pb-brand-soft)]">
                            <PianoMark size={14} />
                        </span>
                        PianoBE
                    </div>
                    <h1 className="mt-2 text-[21px] font-semibold tracking-[-0.02em]">服务端管理</h1>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ore-dim">
                        使用 API 令牌登录。管理员可在服务端环境变量 BOOTSTRAP_TOKEN 或令牌管理中获取。
                    </p>
                </div>
                <div className="flex flex-col gap-3">
                    <Textfield
                        type="password"
                        label="API Token"
                        placeholder="粘贴访问令牌"
                        value={value}
                        error={error || ""}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setValue(target.value);
                        }}
                        onKeyDown={(event: React.KeyboardEvent) => {
                            if (event.key === "Enter") void submit();
                        }}
                    />
                    <Button type="button" loading={busy} disabled={!value.trim()} onClick={() => void submit()}>
                        <LogIn size={15} /> 登录
                    </Button>
                </div>
            </div>
        </div>
    );
}
