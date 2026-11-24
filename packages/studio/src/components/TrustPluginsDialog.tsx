import { useEffect, useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Button, Dialog, SongBadge } from "@piano/ui";
import type { StudioPlugin } from "../adapters/types";
import { summarizePluginCapabilities } from "../store/studio";

export interface TrustPluginsDialogProps {
    plugins: readonly StudioPlugin[];
    onConfirm: (approvedIds: string[]) => void;
    onCancel: () => void;
}

export function TrustPluginsDialog({ plugins, onConfirm, onCancel }: TrustPluginsDialogProps) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const next: Record<string, boolean> = {};
        for (const p of plugins) next[p.id] = p.compatible;
        setChecked(next);
    }, [plugins]);

    const approvedIds = plugins
        .filter((p) => p.compatible && checked[p.id])
        .map((p) => p.id);

    return (
        <Dialog
            opened={plugins.length > 0}
            onClose={onCancel}
            size="md"
            closeOnClickOutside={false}
            title={
                <span className="inline-flex items-center gap-2">
                    <ShieldCheck size={17} className="text-brand" />
                    确认信任可执行扩展
                </span>
            }
            footer={
                <>
                    <Button type="button" color="secondary" size="sm" onClick={onCancel}>
                        暂不启用
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={approvedIds.length === 0}
                        onClick={() => onConfirm(approvedIds)}
                    >
                        信任并启用 ({approvedIds.length})
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-[12px] leading-relaxed text-ore-dim">
                    以下 <code className="text-[11px]">.pbeplugin</code> 扩展包包含可执行脚本（VFX/演出逻辑）。仅应在信任作者来源的情况下启用并参与附加包构建。
                </p>
                <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-0.5">
                    {plugins.map((plugin) => (
                        <label
                            key={plugin.id}
                            className="flex items-start gap-3 rounded-lg border border-ore-border bg-ore-raised p-3"
                        >
                            <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 shrink-0 accent-[var(--pb-primary)]"
                                checked={Boolean(checked[plugin.id])}
                                onChange={(e) =>
                                    setChecked((prev) => ({
                                        ...prev,
                                        [plugin.id]: e.currentTarget.checked,
                                    }))
                                }
                            />
                            {plugin.previewDataUrl ? (
                                <img
                                    src={plugin.previewDataUrl}
                                    alt={plugin.name}
                                    className="h-11 w-11 shrink-0 rounded-md border border-ore-divider object-cover"
                                />
                            ) : (
                                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-ore-divider bg-ore-sunken text-ore-dim">
                                    <Sparkles size={16} />
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                                    <span>{plugin.name}</span>
                                    <SongBadge>v{plugin.version}</SongBadge>
                                    <SongBadge tone="brand">
                                        {plugin.visibility === "internal" ? "内部" : "公开"}
                                    </SongBadge>
                                </div>
                                <div className="mt-0.5 text-[11px] text-ore-dim">
                                    ID: <code>{plugin.id}</code> · 作者: {plugin.author}
                                </div>
                                <div className="mt-0.5 text-[11px] text-ore-dim">
                                    能力: {summarizePluginCapabilities(plugin)}
                                </div>
                            </div>
                        </label>
                    ))}
                </div>
            </div>
        </Dialog>
    );
}
