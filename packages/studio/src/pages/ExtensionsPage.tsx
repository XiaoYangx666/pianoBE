import { useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    Boxes,
    Code2,
    Eye,
    EyeOff,
    Plus,
    ShieldCheck,
    Sparkles,
    Trash2,
    Upload,
    Wand2,
} from "lucide-react";
import {
    Button,
    ConfirmDialog,
    EmptyState,
    FileDropzone,
    PageHeader,
    Segmented,
    SongBadge,
    notify,
} from "@piano/ui";
import type { ResourceDeployStatus } from "@piano/core";
import { computeLocalSongPluginMatch } from "../adapters/localAdapter";
import type { StudioPlugin } from "../adapters/types";
import { TrustPluginsDialog } from "../components/TrustPluginsDialog";
import { summarizePluginCapabilities, useStudio } from "../store/studio";

const SOURCE_LABELS: Record<StudioPlugin["source"], string> = {
    builtin: "内置",
    local: "本地导入",
    upload: "已上传",
    song: "随曲附带",
};

const DEPLOY_STATUS_LABELS: Record<ResourceDeployStatus, { label: string; tone?: "brand" | "default" }> = {
    active: { label: "已生效", tone: "brand" },
    pending_deploy: { label: "待部署" },
    pending_restart: { label: "待重启" },
    unavailable: { label: "未启用" },
};

function formatBytes(bytes: number): string {
    if (!bytes) return "";
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ExtensionsPage() {
    const mode = useStudio((s) => s.mode);
    const plugins = useStudio((s) => s.plugins);
    const songs = useStudio((s) => s.songs);
    const selectedSongIds = useStudio((s) => s.selectedSongIds);
    const selectedPluginIds = useStudio((s) => s.selectedPluginIds);
    const pendingTrustPlugins = useStudio((s) => s.pendingTrustPlugins);
    const busy = useStudio((s) => s.busy);

    const importFiles = useStudio((s) => s.importFiles);
    const trustPlugin = useStudio((s) => s.trustPlugin);
    const togglePlugin = useStudio((s) => s.togglePlugin);
    const uninstallPlugin = useStudio((s) => s.uninstallPlugin);
    const autoMatchLocalPlugins = useStudio((s) => s.autoMatchLocalPlugins);
    const zeroLocalPlugins = useStudio((s) => s.zeroLocalPlugins);
    const confirmPendingTrust = useStudio((s) => s.confirmPendingTrust);
    const cancelPendingTrust = useStudio((s) => s.cancelPendingTrust);

    const [filter, setFilter] = useState<"all" | "enabled" | "effects" | "content">("all");
    const [uninstallTarget, setUninstallTarget] = useState<StudioPlugin | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => {
        return plugins.filter((p) => {
            if (filter === "enabled") {
                return mode === "local" ? selectedPluginIds.includes(p.id) : p.enabled;
            }
            if (filter === "effects") {
                return Boolean(p.provides.effects?.length || p.provides.themes?.length || p.provides.stageProps?.length);
            }
            if (filter === "content") {
                return Boolean(p.provides.songs?.length || p.provides.performances?.length || p.provides.libraries?.length);
            }
            return true;
        });
    }, [plugins, filter, mode, selectedPluginIds]);

    const localMatch = useMemo(() => {
        if (mode !== "local") return null;
        const picked = songs.filter((s) => selectedSongIds.includes(s.id));
        return computeLocalSongPluginMatch(picked, plugins, selectedPluginIds);
    }, [mode, songs, selectedSongIds, plugins, selectedPluginIds]);

    const handleToggle = async (plugin: StudioPlugin) => {
        try {
            if (mode === "local") {
                const currentlySelected = selectedPluginIds.includes(plugin.id);
                await togglePlugin(plugin.id, !currentlySelected);
            } else {
                await togglePlugin(plugin.id, !plugin.enabled);
            }
        } catch (err) {
            notify({
                title: "操作失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const handleTrust = async (plugin: StudioPlugin) => {
        try {
            await trustPlugin(plugin.id);
        } catch (err) {
            notify({
                title: "信任失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const confirmUninstall = async () => {
        if (!uninstallTarget) return;
        const target = uninstallTarget;
        setUninstallTarget(null);
        try {
            await uninstallPlugin(target.id);
        } catch (err) {
            notify({
                title: "无法卸载扩展",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                eyebrow="Unified .pbeplugin Extensions"
                title="扩展中心"
                description="所有歌曲、曲库、演出编排、舞台特效与样式均通过统一的 .pbeplugin 格式安装和管理。"
                actions={
                    <div className="flex flex-wrap gap-2">
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".pbeplugin"
                            multiple
                            hidden
                            onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                e.target.value = "";
                                if (files.length > 0) void importFiles(files);
                            }}
                        />
                        {mode === "local" && (
                            <>
                                <Button type="button" color="ghost" size="sm" onClick={zeroLocalPlugins}>
                                    零插件模式
                                </Button>
                                <Button type="button" color="secondary" size="sm" onClick={autoMatchLocalPlugins}>
                                    <Wand2 size={14} /> 按曲目自动匹配
                                </Button>
                            </>
                        )}
                        <Button type="button" size="sm" loading={busy} onClick={() => fileRef.current?.click()}>
                            <Upload size={14} /> 安装 .pbeplugin
                        </Button>
                    </div>
                }
            />

            {localMatch && (localMatch.missingEffects.length > 0 || localMatch.disabledRequiredEffects.length > 0) && (
                <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--pb-warning)]/40 bg-[color:var(--pb-warning)]/10 p-3 text-[12px]">
                    {localMatch.missingEffects.length > 0 && (
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[color:var(--pb-warning)]" />
                            <div>
                                <div className="font-semibold text-ore-text">部分已选曲目的演出缺少特效插件</div>
                                <div className="mt-0.5 text-[11.5px] text-ore-dim">
                                    缺少插件不影响音乐本体正常播放；缺失部分将在游戏内提示不可用：
                                    {localMatch.missingEffects
                                        .map((item) => ` ${item.effect}（${item.songs.join("、")}）`)
                                        .join("；")}
                                </div>
                            </div>
                        </div>
                    )}
                    {localMatch.disabledRequiredEffects.length > 0 && (
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[color:var(--pb-warning)]" />
                            <div>
                                <div className="font-semibold text-ore-text">以下所需扩展当前未勾选</div>
                                <div className="mt-0.5 text-[11.5px] text-ore-dim">
                                    可点击上方「按曲目自动匹配」一键启用：
                                    {localMatch.disabledRequiredEffects
                                        .map((item) => ` ${item.pluginName}（${item.effect}）`)
                                        .join("、")}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                    value={filter}
                    onChange={(v) => setFilter(v as typeof filter)}
                    options={[
                        { value: "all", label: "全部扩展", count: plugins.length },
                        {
                            value: "enabled",
                            label: mode === "local" ? "已装配" : "已启用",
                            count: plugins.filter((p) =>
                                mode === "local" ? selectedPluginIds.includes(p.id) : p.enabled,
                            ).length,
                        },
                        { value: "effects", label: "特效与样式" },
                        { value: "content", label: "曲库与演出" },
                    ]}
                />
            </div>

            <FileDropzone
                accept={[".pbeplugin"]}
                multiple
                title="安装 .pbeplugin 扩展"
                description="拖拽 .pbeplugin 文件到此处安装，支持曲库包、VFX 插件与专属演出合集"
                onDrop={(files) => void importFiles(files)}
            />

            {filtered.length === 0 ? (
                <EmptyState
                    icon={<Boxes size={24} />}
                    title="暂无匹配的扩展"
                    description="请尝试切换筛选条件，或上传 .pbeplugin 扩展包。"
                />
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {filtered.map((plugin) => {
                        const checked =
                            mode === "local"
                                ? selectedPluginIds.includes(plugin.id)
                                : plugin.enabled;
                        const statusMeta = DEPLOY_STATUS_LABELS[plugin.status];
                        return (
                            <div
                                key={plugin.id}
                                className="flex flex-col justify-between gap-3 rounded-lg border border-ore-border bg-ore-raised p-4"
                            >
                                <div className="flex items-start gap-3">
                                    {plugin.previewDataUrl ? (
                                        <img
                                            src={plugin.previewDataUrl}
                                            alt={plugin.name}
                                            className="h-12 w-12 shrink-0 rounded-md border border-ore-divider object-cover"
                                        />
                                    ) : (
                                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-ore-divider bg-ore-sunken text-ore-dim">
                                            <Sparkles size={18} />
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-[14px] font-semibold">{plugin.name}</span>
                                            <SongBadge>v{plugin.version}</SongBadge>
                                            <SongBadge>{SOURCE_LABELS[plugin.source]}</SongBadge>
                                            {mode === "server" && (
                                                <SongBadge tone={statusMeta.tone}>{statusMeta.label}</SongBadge>
                                            )}
                                            <SongBadge>
                                                {plugin.visibility === "internal" ? (
                                                    <span className="inline-flex items-center gap-1">
                                                        <EyeOff size={10} /> 内部
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Eye size={10} /> 公开
                                                    </span>
                                                )}
                                            </SongBadge>
                                            {plugin.hasExecutableCode && (
                                                <SongBadge>
                                                    <span className="inline-flex items-center gap-1">
                                                        <Code2 size={10} /> 含脚本
                                                    </span>
                                                </SongBadge>
                                            )}
                                        </div>
                                        <div className="mt-1 text-[11.5px] text-ore-dim">
                                            <code>{plugin.id}</code> · {plugin.author}
                                            {plugin.sizeBytes > 0 && ` · ${formatBytes(plugin.sizeBytes)}`}
                                        </div>
                                        {plugin.description && (
                                            <p className="mt-1.5 line-clamp-2 text-[12px] text-ore-dim">
                                                {plugin.description}
                                            </p>
                                        )}
                                        <div className="mt-2 text-[11px] text-ore-dimmer">
                                            提供：{summarizePluginCapabilities(plugin)}
                                            {plugin.dependencies.length > 0 &&
                                                ` · 依赖：${plugin.dependencies.map((d) => d.id).join("、")}`}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ore-divider pt-2.5">
                                    <div className="flex items-center gap-2">
                                        {!plugin.trusted ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => void handleTrust(plugin)}
                                            >
                                                <ShieldCheck size={13} /> 信任并启用
                                            </Button>
                                        ) : (
                                            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px]">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => void handleToggle(plugin)}
                                                    className="h-4 w-4 accent-[var(--pb-primary)]"
                                                />
                                                <span>
                                                    {checked
                                                        ? mode === "local"
                                                            ? "参与附加包构建"
                                                            : "已启用"
                                                        : mode === "local"
                                                          ? "暂不打包"
                                                          : "已停用"}
                                                </span>
                                            </label>
                                        )}
                                    </div>
                                    {plugin.source !== "builtin" ? (
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={() => setUninstallTarget(plugin)}
                                        >
                                            <Trash2 size={13} /> 卸载
                                        </Button>
                                    ) : (
                                        mode === "server" && !plugin.trusted && (
                                            <Button
                                                type="button"
                                                color="secondary"
                                                size="sm"
                                                onClick={() => void handleTrust(plugin)}
                                            >
                                                <Plus size={13} /> 启用
                                            </Button>
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <TrustPluginsDialog
                plugins={pendingTrustPlugins.map((item) => item.plugin)}
                onConfirm={(ids) => void confirmPendingTrust(ids)}
                onCancel={cancelPendingTrust}
            />

            <ConfirmDialog
                opened={Boolean(uninstallTarget)}
                title="卸载扩展"
                danger
                description={
                    uninstallTarget
                        ? `确定要卸载「${uninstallTarget.name}」吗？属于此扩展独占的歌曲、演出与资源将被移除（玩家个人存储卡里的歌曲数据副本不受影响）。`
                        : ""
                }
                confirmLabel="确认卸载"
                onConfirm={() => void confirmUninstall()}
                onCancel={() => setUninstallTarget(null)}
            />
        </div>
    );
}
