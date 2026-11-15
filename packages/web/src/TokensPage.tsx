import { useEffect, useState } from "react";
import { Button, Menu, MenuTrigger, Textfield } from "@piano/ui";
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { ConfirmDialog, Dialog, EmptyState, PageHeader, SongBadge, copyText, notify } from "@piano/ui";
import { api, type TokenInfo } from "./api";

const ROLES = [
    { value: "read", label: "read · 只读" },
    { value: "write", label: "write · 可写" },
    { value: "admin", label: "admin · 管理员" },
];

export function TokensPage() {
    const [list, setList] = useState<TokenInfo[]>([]);
    const [label, setLabel] = useState("");
    const [role, setRole] = useState("read");
    const [created, setCreated] = useState<{ label: string; role: string; token: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState("");
    const [forbidden, setForbidden] = useState(false);
    const [busy, setBusy] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<TokenInfo | null>(null);

    const load = async () => {
        setError("");
        try {
            const res = await api.listTokens();
            setList(res.items);
            setForbidden(false);
        } catch {
            setForbidden(true);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const create = async () => {
        if (!label.trim()) return;
        setBusy(true);
        setError("");
        try {
            const res = await api.createToken(label.trim(), role);
            setCreated(res);
            setLabel("");
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const confirmRevoke = async () => {
        if (!revokeTarget) return;
        const token = revokeTarget;
        setRevokeTarget(null);
        try {
            await api.revokeToken(token.id);
            notify({ title: "令牌已吊销", message: token.label, color: "teal" });
            await load();
        } catch (e) {
            notify({ title: "吊销失败", message: (e as Error).message, color: "red" });
        }
    };

    const copyToken = async () => {
        if (!created) return;
        await copyText(created.token);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };

    if (forbidden) {
        return (
            <div className="flex flex-col gap-4">
                <PageHeader eyebrow="Access Tokens" title="令牌管理" />
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
                    <ShieldAlert size={17} className="mt-0.5 shrink-0" />
                    <div>
                        <div className="mb-0.5 text-[13px] font-semibold">没有管理员权限</div>
                        当前令牌无法管理访问令牌。请使用服务端管理员令牌登录。
                    </div>
                </div>
            </div>
        );
    }

    const roleLabel = ROLES.find((item) => item.value === role)?.label ?? role;

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Access Tokens"
                title="令牌管理"
                description="为外部工具或前端分配 API 令牌。令牌只在创建时显示一次，请立即保存。"
            />

            {error && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div>
            )}

            <section className="rounded-xl border border-ore-border bg-ore-raised p-4">
                <div className="flex flex-wrap items-end gap-2.5">
                    <Textfield
                        className="w-[280px]"
                        label="令牌标签"
                        placeholder="例如 my-uploader"
                        value={label}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setLabel(target.value);
                        }}
                        onKeyDown={(event: React.KeyboardEvent) => {
                            if (event.key === "Enter") void create();
                        }}
                    />
                    <Menu
                        trigger={<MenuTrigger>{roleLabel}</MenuTrigger>}
                        items={ROLES.map((item) => ({
                            key: item.value,
                            label: item.label,
                            selected: role === item.value,
                            onSelect: () => setRole(item.value),
                        }))}
                    />
                    <Button
                        type="button"
                        size="sm"
                        loading={busy}
                        disabled={!label.trim()}
                        onClick={() => void create()}
                    >
                        <Plus size={14} /> 创建令牌
                    </Button>
                </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-ore-border bg-ore-raised">
                <div className="flex items-center gap-2 border-b border-ore-divider px-4 py-3">
                    <KeyRound size={16} />
                    <span className="text-sm font-semibold">令牌列表</span>
                    <SongBadge>{list.length}</SongBadge>
                </div>
                {list.length === 0 ? (
                    <EmptyState compact title="还没有令牌" description="创建后可用于外部上传或前端访问" />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                            <thead>
                                <tr className="text-[11px] uppercase tracking-wider text-ore-dimmer">
                                    <th className="px-4 py-2 font-medium">ID</th>
                                    <th className="px-4 py-2 font-medium">标签</th>
                                    <th className="px-4 py-2 font-medium">角色</th>
                                    <th className="px-4 py-2 font-medium">创建时间</th>
                                    <th className="px-4 py-2 font-medium">状态</th>
                                    <th className="px-4 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((token) => (
                                    <tr key={token.id} className="border-t border-ore-divider/70 hover:bg-[var(--pb-hover)]">
                                        <td className="px-4 py-2.5 font-mono text-[11px] text-ore-dim">{token.id}</td>
                                        <td className="px-4 py-2.5 text-[13px] font-medium">{token.label}</td>
                                        <td className="px-4 py-2.5">
                                            <SongBadge tone="brand">{token.role}</SongBadge>
                                        </td>
                                        <td className="px-4 py-2.5 text-ore-dim">
                                            {new Date(token.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {token.revoked ? <SongBadge>已吊销</SongBadge> : <SongBadge tone="success">有效</SongBadge>}
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            {!token.revoked && (
                                                <button
                                                    type="button"
                                                    aria-label="吊销令牌"
                                                    title="吊销令牌"
                                                    className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
                                                    onClick={() => setRevokeTarget(token)}
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <Dialog
                opened={Boolean(created)}
                onClose={() => setCreated(null)}
                title="令牌已创建"
                size="md"
                footer={
                    <>
                        <Button type="button" color="secondary" size="sm" onClick={() => void copyToken()}>
                            {copied ? <Check size={13} /> : <Copy size={13} />}
                            {copied ? "已复制" : "复制令牌"}
                        </Button>
                        <Button type="button" size="sm" onClick={() => setCreated(null)}>
                            关闭
                        </Button>
                    </>
                }
            >
                {created && (
                    <div className="flex flex-col gap-3">
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                            令牌「{created.label}」创建成功。它只会显示这一次，请立即复制保存。
                        </div>
                        <code className="block break-all rounded-md border border-ore-border bg-[var(--pb-code)] p-3 font-mono text-xs">
                            {created.token}
                        </code>
                    </div>
                )}
            </Dialog>

            <ConfirmDialog
                opened={Boolean(revokeTarget)}
                title="吊销令牌"
                danger
                confirmLabel="吊销"
                description={`确定吊销「${revokeTarget?.label ?? ""}」？使用该令牌的客户端会立即失效。`}
                onConfirm={() => void confirmRevoke()}
                onCancel={() => setRevokeTarget(null)}
            />
        </div>
    );
}
