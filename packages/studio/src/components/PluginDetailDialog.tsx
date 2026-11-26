import {
    Code2,
    Download,
    Eye,
    EyeOff,
    ListMusic,
    ShieldCheck,
    Trash2,
} from "lucide-react";
import type { ResourceDeployStatus } from "@piano/core";
import { Button, Dialog, SongBadge } from "@piano/ui";
import type { StudioMode, StudioPlugin } from "../adapters/types";
import { PluginIcon } from "./PluginIcon";

const SOURCE_LABELS: Record<StudioPlugin["source"], string> = {
    builtin: "官方内置",
    local: "本地目录",
    upload: "已上传",
    remote: "官方源",
    song: "随曲附带",
};

const DEPLOY_STATUS_LABELS: Record<
    ResourceDeployStatus,
    { label: string; tone?: "brand" | "default" }
> = {
    active: { label: "已生效", tone: "brand" },
    pending_deploy: { label: "待部署" },
    pending_restart: { label: "待重启" },
    unavailable: { label: "未启用" },
};

function formatBytes(bytes: number): string {
    if (!bytes) return "-";
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

export interface PluginDetailDialogProps {
    plugin: StudioPlugin | null;
    mode: StudioMode;
    installing?: boolean;
    onClose: () => void;
    onInstall: (plugin: StudioPlugin) => void;
    onToggle: (plugin: StudioPlugin) => void;
    onTrust: (plugin: StudioPlugin) => void;
    onUninstall: (plugin: StudioPlugin) => void;
    onBrowseSongs?: (plugin: StudioPlugin) => void;
}

const PROVIDE_SECTIONS: Array<{
    key: string;
    label: string;
}> = [
    { key: "effects", label: "舞台特效" },
    { key: "themes", label: "舞台主题" },
    { key: "keyStyles", label: "琴键样式" },
    { key: "layouts", label: "灯光锚点布局" },
    { key: "particles", label: "自定义粒子" },
    { key: "timbres", label: "钢琴音色" },
    { key: "libraries", label: "曲库集合" },
    { key: "performances", label: "独立演出" },
    { key: "songs", label: "内置曲目" },
];

export function PluginDetailDialog({
    plugin,
    mode,
    installing = false,
    onClose,
    onInstall,
    onToggle,
    onTrust,
    onUninstall,
    onBrowseSongs,
}: PluginDetailDialogProps) {
    if (!plugin) return null;

    const statusMeta = DEPLOY_STATUS_LABELS[plugin.status];
    const hasSongs = plugin.contents.songs > 0;
    const provides = plugin.provides ?? {};
    const activeProvides = PROVIDE_SECTIONS.map((section) => ({
        ...section,
        items: provides[section.key] ?? [],
    })).filter((section) => section.items.length > 0);

    return (
        <Dialog opened={Boolean(plugin)} onClose={onClose} title="扩展详情" size="lg">
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3.5">
                    <PluginIcon plugin={plugin} size="lg" />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="text-[16px] font-semibold leading-snug text-ore-text">
                                {plugin.name}
                            </h3>
                            <SongBadge>v{plugin.version}</SongBadge>
                            <SongBadge>{SOURCE_LABELS[plugin.source]}</SongBadge>
                            {plugin.installed ? (
                                mode === "server" ? (
                                    <SongBadge tone={statusMeta.tone}>{statusMeta.label}</SongBadge>
                                ) : (
                                    <SongBadge tone={plugin.enabled ? "brand" : "default"}>
                                        {plugin.enabled ? "已安装" : "已停用"}
                                    </SongBadge>
                                )
                            ) : (
                                <SongBadge>未安装</SongBadge>
                            )}
                            {plugin.visibility === "internal" ? (
                                <SongBadge>
                                    <span className="inline-flex items-center gap-1">
                                        <EyeOff size={10} /> 内部依赖
                                    </span>
                                </SongBadge>
                            ) : !hasSongs && !plugin.contents.timbres ? (
                                <SongBadge>
                                    <span className="inline-flex items-center gap-1">
                                        <Eye size={10} /> 公开选择器可见
                                    </span>
                                </SongBadge>
                            ) : null}
                            {plugin.hasExecutableCode && (
                                <SongBadge>
                                    <span className="inline-flex items-center gap-1">
                                        <Code2 size={10} /> 含可执行脚本
                                    </span>
                                </SongBadge>
                            )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ore-dim">
                            <span>
                                ID：<code className="text-ore-text">{plugin.id}</code>
                            </span>
                            <span>作者：{plugin.author}</span>
                            {plugin.license && <span>协议：{plugin.license}</span>}
                            <span>体积：{formatBytes(plugin.sizeBytes)}</span>
                        </div>
                    </div>
                </div>

                {plugin.description && (
                    <p className="rounded-md border border-ore-divider bg-ore-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-ore-dim">
                        {plugin.description}
                    </p>
                )}

                {!plugin.compatible && plugin.compatibilityNote && (
                    <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
                        兼容性提示：{plugin.compatibilityNote}
                    </div>
                )}

                {plugin.missingDependencies.length > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                        缺少依赖扩展：{plugin.missingDependencies.join("、")}
                    </div>
                )}

                {plugin.dependencies.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <div className="text-[12px] font-medium text-ore-dim">前置依赖</div>
                        <div className="flex flex-wrap gap-1.5">
                            {plugin.dependencies.map((dep) => (
                                <SongBadge key={dep.id}>
                                    <code>{dep.id}</code>
                                </SongBadge>
                            ))}
                        </div>
                    </div>
                )}

                {plugin.timbreEntries && plugin.timbreEntries.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[12px] font-medium text-ore-dim">包含钢琴音色</div>
                        <div className="flex flex-col gap-1.5">
                            {plugin.timbreEntries.map((entry) => (
                                <div
                                    key={entry.id}
                                    className="rounded-md border border-ore-divider bg-ore-sunken px-3 py-2 text-[12px]"
                                >
                                    <div className="flex flex-wrap items-center gap-2 font-medium text-ore-text">
                                        <span>{entry.label}</span>
                                        <code className="text-[11px] text-ore-dim">{entry.id}</code>
                                        <span className="text-[11px] text-ore-dimmer">
                                            {entry.notes.length} 键 · {entry.layers.length} 层采样
                                        </span>
                                    </div>
                                    {entry.description && (
                                        <p className="mt-1 text-ore-dim">{entry.description}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeProvides.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                        <div className="text-[12px] font-medium text-ore-dim">提供资源清单</div>
                        <div className="flex flex-col gap-2 rounded-md border border-ore-divider bg-ore-sunken p-3">
                            {activeProvides.map((section) => (
                                <div key={section.key} className="flex flex-col gap-1">
                                    <span className="text-[11.5px] font-medium text-ore-dim">
                                        {section.label}（{section.items.length}）
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                        {section.items.slice(0, 24).map((item) => (
                                            <SongBadge key={item}>
                                                <code>{item}</code>
                                            </SongBadge>
                                        ))}
                                        {section.items.length > 24 && (
                                            <SongBadge>+{section.items.length - 24} 项</SongBadge>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ore-divider pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {!plugin.installed ? (
                            <Button
                                type="button"
                                size="sm"
                                loading={installing}
                                onClick={() => onInstall(plugin)}
                            >
                                <Download size={13} /> {hasSongs ? "整包安装" : "安装扩展"}
                            </Button>
                        ) : !plugin.trusted ? (
                            <Button type="button" size="sm" onClick={() => onTrust(plugin)}>
                                <ShieldCheck size={13} /> 信任并启用
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => onToggle(plugin)}
                            >
                                {plugin.enabled ? "停用附加包装配" : "启用附加包装配"}
                            </Button>
                        )}
                        {hasSongs && onBrowseSongs && (
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                onClick={() => {
                                    onClose();
                                    onBrowseSongs(plugin);
                                }}
                            >
                                <ListMusic size={13} /> 浏览 / 挑单曲
                            </Button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {plugin.installed && (
                            <Button
                                type="button"
                                color="ghost"
                                size="sm"
                                onClick={() => {
                                    onClose();
                                    onUninstall(plugin);
                                }}
                            >
                                <Trash2 size={13} /> 卸载
                            </Button>
                        )}
                        <Button type="button" color="ghost" size="sm" onClick={onClose}>
                            关闭
                        </Button>
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
