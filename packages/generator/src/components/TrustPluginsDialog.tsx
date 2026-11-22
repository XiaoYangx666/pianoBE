import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, Sparkles } from "lucide-react";
import { Button, Dialog, SongBadge } from "@piano/ui";
import { summarizePluginProvides, type GeneratorPluginEntry } from "../addon/plugins";

export interface TrustPluginsDialogProps {
    plugins: readonly GeneratorPluginEntry[];
    onConfirm: (approvedIds: string[]) => void;
    onCancel: () => void;
}

export function TrustPluginsDialog({ plugins, onConfirm, onCancel }: TrustPluginsDialogProps) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const next: Record<string, boolean> = {};
        for (const plugin of plugins) {
            next[plugin.id] = plugin.compatible;
        }
        setChecked(next);
    }, [plugins]);

    const approvedIds = plugins
        .filter((plugin) => plugin.compatible && checked[plugin.id])
        .map((plugin) => plugin.id);

    return (
        <Dialog
            opened={plugins.length > 0}
            onClose={onCancel}
            title={
                <span className="inline-flex items-center gap-2">
                    <ShieldCheck size={17} className="text-brand" />
                    确认信任并安装插件
                </span>
            }
            size="md"
            closeOnClickOutside={false}
            footer={
                <>
                    <Button type="button" color="secondary" size="sm" onClick={onCancel}>
                        暂不安装
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={approvedIds.length === 0}
                        onClick={() => onConfirm(approvedIds)}
                    >
                        信任并安装 ({approvedIds.length})
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-[12px] leading-relaxed text-ore-dim">
                    外部或歌曲附带的 <code className="text-[11px]">.pbeplugin</code> 插件会在导出的附加包中运行脚本并打包粒子/纹理资源。请确认来源可信后再允许装配。
                </p>

                <div className="flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-0.5">
                    {plugins.map((plugin) => {
                        const isChecked = Boolean(plugin.compatible && checked[plugin.id]);
                        return (
                            <label
                                key={plugin.id}
                                className="flex items-start gap-3 rounded-lg border border-ore-border bg-ore-raised p-3"
                            >
                                <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--pb-primary)]"
                                    checked={isChecked}
                                    disabled={!plugin.compatible}
                                    onChange={(event) => {
                                        const value = event.currentTarget.checked;
                                        setChecked((prev) => ({ ...prev, [plugin.id]: value }));
                                    }}
                                />
                                {plugin.previewDataUrl ? (
                                    <img
                                        src={plugin.previewDataUrl}
                                        alt={plugin.manifest.name}
                                        className="h-12 w-12 shrink-0 rounded-md border border-ore-divider object-cover"
                                    />
                                ) : (
                                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-ore-divider bg-ore-sunken text-ore-dim">
                                        <Sparkles size={18} />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                                        <span>{plugin.manifest.name}</span>
                                        <SongBadge>v{plugin.manifest.version}</SongBadge>
                                        {plugin.songSourceName && (
                                            <SongBadge tone="brand">随曲附带 · {plugin.songSourceName}</SongBadge>
                                        )}
                                    </div>
                                    <div className="mt-1 text-[11px] text-ore-dim">
                                        ID: <code>{plugin.id}</code> · 作者: {plugin.manifest.author} · 许可: {plugin.manifest.license}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-ore-dim">
                                        能力: {plugin.manifest.capabilities.join(", ")} · 内容: {summarizePluginProvides(plugin, "无声明条目")} ·{" "}
                                        {(plugin.size / 1024).toFixed(1)} KB
                                    </div>
                                    {!plugin.compatible && (
                                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[color:var(--pb-warning)]">
                                            <AlertTriangle size={12} />
                                            <span>{plugin.compatibilityReason ?? "与当前宿主 API 版本不兼容，无法装配"}</span>
                                        </div>
                                    )}
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>
        </Dialog>
    );
}
