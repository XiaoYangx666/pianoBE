import { useRef } from "react";
import { AlertTriangle, Boxes, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { Button, EmptyState, FileDropzone, SongBadge } from "@piano/ui";
import { summarizePluginProvides, type GeneratorPluginEntry, type SongPluginMatchResult } from "../addon/plugins";

export interface PluginsPanelProps {
    plugins: readonly GeneratorPluginEntry[];
    selectedPlugins: readonly string[];
    match: SongPluginMatchResult;
    ready: boolean;
    onTogglePlugin: (id: string, checked: boolean) => void;
    onAutoMatch: () => void;
    onZeroPlugins: () => void;
    onImportPluginFiles: (files: File[]) => void;
    onImportSongBundles: (files: File[]) => void;
    onUninstallPlugin: (id: string) => void;
}

const SOURCE_LABELS: Record<GeneratorPluginEntry["source"], string> = {
    builtin: "内置",
    local: "本地导入",
    song: "随曲附带",
};

function formatPluginSize(bytes: number): string {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

export function PluginsPanel({
    plugins,
    selectedPlugins,
    match,
    ready,
    onTogglePlugin,
    onAutoMatch,
    onZeroPlugins,
    onImportPluginFiles,
    onImportSongBundles,
    onUninstallPlugin,
}: PluginsPanelProps) {
    const pluginInputRef = useRef<HTMLInputElement>(null);

    const handleDrop = (files: File[]) => {
        const pluginFiles = files.filter((file) => file.name.toLowerCase().endsWith(".pbeplugin"));
        const bundleFiles = files.filter((file) => !file.name.toLowerCase().endsWith(".pbeplugin"));
        if (pluginFiles.length > 0) onImportPluginFiles(pluginFiles);
        if (bundleFiles.length > 0) onImportSongBundles(bundleFiles);
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-[13px] font-semibold">VFX 插件装配</div>
                    <p className="mt-0.5 max-w-[660px] text-[11.5px] leading-relaxed text-ore-dim">
                        根据曲目演出引用的特效 ID 自动推荐插件；缺失或取消勾选不影响曲目播放，也可切为零插件基线。
                    </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <input
                        ref={pluginInputRef}
                        type="file"
                        accept=".pbeplugin"
                        multiple
                        hidden
                        onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            if (files.length > 0) onImportPluginFiles(files);
                        }}
                    />
                    <Button type="button" color="ghost" size="sm" onClick={onZeroPlugins}>
                        零插件模式
                    </Button>
                    <Button type="button" color="secondary" size="sm" onClick={onAutoMatch}>
                        <Wand2 size={13} /> 按曲目自动匹配
                    </Button>
                    <Button type="button" size="sm" onClick={() => pluginInputRef.current?.click()}>
                        <Upload size={13} /> 导入 .pbeplugin
                    </Button>
                </div>
            </div>

            {(match.missingEffects.length > 0 || match.disabledRequiredEffects.length > 0) && (
                <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--pb-warning)]/40 bg-[color:var(--pb-warning)]/10 p-3 text-[12px]">
                    {match.missingEffects.length > 0 && (
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[color:var(--pb-warning)]" />
                            <div>
                                <div className="font-semibold text-ore-text">缺少曲目所需的特效插件</div>
                                <div className="mt-0.5 text-[11.5px] text-ore-dim">
                                    仍可导出并播放音乐。游戏会保留可用的演出提示。
                                    {match.missingEffects
                                        .map((item) => ` ${item.effect}（${item.songs.join("、")}）`)
                                        .join("；")}
                                </div>
                            </div>
                        </div>
                    )}
                    {match.disabledRequiredEffects.length > 0 && (
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[color:var(--pb-warning)]" />
                            <div>
                                <div className="font-semibold text-ore-text">以下曲目所需插件未启用或尚未信任</div>
                                <div className="mt-0.5 text-[11.5px] text-ore-dim">
                                    游戏会跳过引用这些插件的提示。
                                    {match.disabledRequiredEffects
                                        .map((item) => ` ${item.effect} → ${item.pluginName}（${item.songs.join("、")}）`)
                                        .join("；")}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <FileDropzone
                compact
                className="max-w-[540px]"
                accept={[".pbeplugin", ".pbesong", ".zip"]}
                title="拖入 .pbeplugin 插件包或含插件的特效歌曲包 (.pbesong / .zip)"
                description="第三方与随曲附带的插件将在确认信任后安装"
                icon={<Boxes size={16} />}
                onDrop={handleDrop}
            />

            {!ready ? (
                <EmptyState compact title="插件清单加载中…" />
            ) : plugins.length === 0 ? (
                <EmptyState
                    compact
                    title="未发现已安装插件"
                    description="请执行 npm run pack:plugins 或导入本地 .pbeplugin"
                />
            ) : (
                <div className="flex flex-col border-t border-ore-divider">
                    {plugins.map((plugin) => {
                        const selected = selectedPlugins.includes(plugin.id);
                        const reason = match.reasons.get(plugin.id);
                        const canToggle = plugin.compatible && plugin.trusted;
                        return (
                            <div
                                key={plugin.id}
                                className={[
                                    "group relative flex items-start gap-3 border-b border-ore-divider/80 px-1 py-3 transition-colors",
                                    selected
                                        ? "bg-[var(--pb-active)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-brand before:content-['']"
                                        : "hover:bg-[var(--pb-hover)]",
                                ].join(" ")}
                            >
                                <input
                                    type="checkbox"
                                    className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--pb-primary)]"
                                    checked={selected}
                                    disabled={!canToggle}
                                    onChange={(event) => onTogglePlugin(plugin.id, event.currentTarget.checked)}
                                    aria-label={`选择插件 ${plugin.manifest.name}`}
                                />
                                {plugin.previewDataUrl ? (
                                    <img
                                        src={plugin.previewDataUrl}
                                        alt={plugin.manifest.name}
                                        className="mt-0.5 h-10 w-10 shrink-0 rounded-md border border-ore-divider object-cover"
                                    />
                                ) : (
                                    <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md border border-ore-divider bg-ore-raised text-ore-dim">
                                        <Sparkles size={15} />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                                        <span>{plugin.manifest.name}</span>
                                        <SongBadge>v{plugin.manifest.version}</SongBadge>
                                        <SongBadge>{SOURCE_LABELS[plugin.source]}</SongBadge>
                                        {plugin.manifest.capabilities.map((cap) => (
                                            <SongBadge key={cap}>{cap}</SongBadge>
                                        ))}
                                        {plugin.compatible ? (
                                            <SongBadge tone="success">API {plugin.manifest.apiVersion}</SongBadge>
                                        ) : (
                                            <SongBadge tone="brand">API 不兼容</SongBadge>
                                        )}
                                        {reason && (
                                            <SongBadge tone="brand">
                                                推荐：{reason.effects.slice(0, 3).join("、")}
                                                {reason.effects.length > 3 ? ` 等 ${reason.effects.length} 项` : ""}
                                            </SongBadge>
                                        )}
                                    </div>
                                    <div className="mt-1 text-[11.5px] text-ore-dim">
                                        {plugin.manifest.preview?.description ?? summarizePluginProvides(plugin)}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ore-dimmer">
                                        <span>作者：{plugin.manifest.author}</span>
                                        <span>内容：{summarizePluginProvides(plugin)}</span>
                                        {reason && (
                                            <span>
                                                匹配曲目：{reason.songs.slice(0, 2).join("、")}
                                                {reason.songs.length > 2 ? ` 等 ${reason.songs.length} 首` : ""}
                                            </span>
                                        )}
                                        {!plugin.compatible && plugin.compatibilityReason && (
                                            <span className="text-[color:var(--pb-warning)]">{plugin.compatibilityReason}</span>
                                        )}
                                    </div>
                                </div>
                                <span className="mt-1 shrink-0 text-[11px] tabular-nums text-ore-dim">
                                    {formatPluginSize(plugin.size)}
                                </span>
                                {plugin.source !== "builtin" && (
                                    <button
                                        type="button"
                                        aria-label={`卸载插件 ${plugin.manifest.name}`}
                                        title="卸载本地插件"
                                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                                        onClick={() => onUninstallPlugin(plugin.id)}
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
