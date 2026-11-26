import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
    AudioWaveform,
    Boxes,
    Code2,
    Download,
    EyeOff,
    Info,
    ListMusic,
    RefreshCw,
    Search,
    ShieldCheck,
    Trash2,
    Upload,
} from "lucide-react";
import {
    Button,
    ConfirmDialog,
    EmptyState,
    PageHeader,
    RowPlayButton,
    Segmented,
    SongBadge,
    Textfield,
    notify,
    usePlayerState,
} from "@piano/ui";
import type { ResourceDeployStatus } from "@piano/core";
import { bundledPianoEntry } from "../adapters/timbres";
import type { StudioPlugin } from "../adapters/types";
import { studioPlayer } from "../audio/player";
import { PluginContentDialog } from "../components/PluginContentDialog";
import { PluginDetailDialog } from "../components/PluginDetailDialog";
import { PluginIcon } from "../components/PluginIcon";
import { TrustPluginsDialog } from "../components/TrustPluginsDialog";
import { summarizePluginCapabilities, useStudio } from "../store/studio";

const SOURCE_LABELS: Record<StudioPlugin["source"], string> = {
    builtin: "官方",
    local: "本地",
    upload: "已上传",
    remote: "官方源",
    song: "随曲",
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
    if (!bytes) return "";
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function isContentPack(p: StudioPlugin): boolean {
    return Boolean(p.contents.songs || p.contents.libraries || p.contents.performances);
}

function isVfxPack(p: StudioPlugin): boolean {
    return Boolean(
        p.contents.effects || p.contents.themes || p.contents.keyStyles || p.contents.stageProps,
    );
}

function isTimbrePack(p: StudioPlugin): boolean {
    return Boolean(p.contents.timbres || p.timbreEntries?.length || p.provides.timbres?.length);
}

export function ExtensionsPage() {
    const mode = useStudio((s) => s.mode);
    const plugins = useStudio((s) => s.plugins);
    const songs = useStudio((s) => s.songs);
    const libraries = useStudio((s) => s.libraries);
    const installedTimbreIds = useStudio((s) => s.installedTimbreIds);
    const previewTimbreId = useStudio((s) => s.previewTimbreId);
    const pendingTrustPlugins = useStudio((s) => s.pendingTrustPlugins);
    const busy = useStudio((s) => s.busy);

    const importFiles = useStudio((s) => s.importFiles);
    const installBuiltinPlugin = useStudio((s) => s.installBuiltinPlugin);
    const scanServerPlugins = useStudio((s) => s.scanServerPlugins);
    const trustPlugin = useStudio((s) => s.trustPlugin);
    const togglePlugin = useStudio((s) => s.togglePlugin);
    const uninstallPlugin = useStudio((s) => s.uninstallPlugin);
    const confirmPendingTrust = useStudio((s) => s.confirmPendingTrust);
    const cancelPendingTrust = useStudio((s) => s.cancelPendingTrust);
    const loadPluginArchive = useStudio((s) => s.loadPluginArchive);
    const importSingleSongFromPlugin = useStudio((s) => s.importSingleSongFromPlugin);
    const previewTimbreDemo = useStudio((s) => s.previewTimbreDemo);
    const auditionTimbreSample = useStudio((s) => s.auditionTimbreSample);

    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const [category, setCategory] = useState<"libraries" | "effects" | "timbres">(() =>
        tabParam === "effects" || tabParam === "timbres" || tabParam === "libraries"
            ? tabParam
            : "libraries",
    );

    useEffect(() => {
        if (tabParam === "effects" || tabParam === "timbres" || tabParam === "libraries") {
            setCategory(tabParam);
        }
    }, [tabParam]);
    const [installedOnly, setInstalledOnly] = useState(false);
    const [query, setQuery] = useState("");
    const [uninstallTarget, setUninstallTarget] = useState<StudioPlugin | null>(null);
    const [browsePlugin, setBrowsePlugin] = useState<StudioPlugin | null>(null);
    const [detailPluginId, setDetailPluginId] = useState<string | null>(null);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const playerState = usePlayerState(studioPlayer);

    const detailPlugin = useMemo(
        () => (detailPluginId ? plugins.find((p) => p.id === detailPluginId) ?? null : null),
        [detailPluginId, plugins],
    );
    const installedTimbreSet = useMemo(() => new Set(installedTimbreIds ?? []), [installedTimbreIds]);

    const existingSongIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);
    const existingFingerprints = useMemo(
        () => new Set(songs.map((s) => s.musicFingerprint).filter((x): x is string => Boolean(x))),
        [songs],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return plugins
            .filter((p) => {
                if (category === "libraries" && !isContentPack(p)) return false;
                if (category === "effects" && !isVfxPack(p)) return false;
                if (category === "timbres" && !isTimbrePack(p)) return false;
                if (installedOnly && !p.installed) return false;
                if (!q) return true;
                return (
                    p.name.toLowerCase().includes(q) ||
                    p.id.toLowerCase().includes(q) ||
                    p.description.toLowerCase().includes(q)
                );
            })
            .sort((a, b) => {
                if (a.installed !== b.installed) return a.installed ? -1 : 1;
                return a.name.localeCompare(b.name, "zh-CN");
            });
    }, [plugins, category, installedOnly, query]);

    const bundledPiano = useMemo(() => bundledPianoEntry(), []);

    const handleInstall = async (plugin: StudioPlugin) => {
        setInstallingId(plugin.id);
        try {
            await installBuiltinPlugin(plugin.id);
        } catch (err) {
            notify({
                title: "安装失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        } finally {
            setInstallingId(null);
        }
    };

    const handleToggle = async (plugin: StudioPlugin) => {
        try {
            await togglePlugin(plugin.id, !plugin.enabled);
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
        <div
            className="relative flex flex-col gap-5"
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                    e.preventDefault();
                    setDragOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragOver(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length > 0) void importFiles(files);
            }}
        >
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

            {dragOver && (
                <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-[1px]">
                    <div className="rounded-xl border-2 border-dashed border-brand bg-ore-raised px-8 py-6 text-center shadow-xl">
                        <Upload size={26} className="mx-auto text-brand" />
                        <div className="mt-2 text-[14px] font-semibold">松开以安装 .pbeplugin 扩展包</div>
                    </div>
                </div>
            )}

            <PageHeader
                eyebrow="Unified .pbeplugin Distribution"
                title="扩展中心"
                description="按曲库、特效与钢琴音色分类分发 .pbeplugin 扩展包；支持按需整包安装、浏览曲包挑单曲与在线试听音色。"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        {mode === "server" && (
                            <Button
                                type="button"
                                color="secondary"
                                size="sm"
                                loading={busy}
                                onClick={() => void scanServerPlugins()}
                            >
                                <RefreshCw size={14} /> 刷新目录
                            </Button>
                        )}
                        <Button
                            type="button"
                            size="sm"
                            loading={busy}
                            onClick={() => fileRef.current?.click()}
                        >
                            <Upload size={14} /> 导入 .pbeplugin
                        </Button>
                    </div>
                }
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                    value={category}
                    onChange={(v) => {
                        const next = v as typeof category;
                        setCategory(next);
                        setSearchParams({ tab: next }, { replace: true });
                    }}
                    options={[
                        {
                            value: "libraries",
                            label: "曲库",
                            count: plugins.filter(isContentPack).length,
                        },
                        {
                            value: "effects",
                            label: "特效",
                            count: plugins.filter(isVfxPack).length,
                        },
                        {
                            value: "timbres",
                            label: "钢琴音色",
                            count: plugins.filter(isTimbrePack).length,
                        },
                    ]}
                />
                <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-ore-dim">
                        <input
                            type="checkbox"
                            checked={installedOnly}
                            onChange={(e) => setInstalledOnly(e.currentTarget.checked)}
                            className="h-3.5 w-3.5 accent-[var(--pb-primary)]"
                        />
                        <span>仅看已安装</span>
                    </label>
                    <div className="min-w-[200px] flex-1 sm:w-[240px]">
                        <Textfield
                            leading={<Search size={14} />}
                            placeholder="搜索扩展名 / ID…"
                            value={query}
                            onInput={(e) => {
                                const t = e.target as unknown as { value?: unknown };
                                if (typeof t?.value === "string") setQuery(t.value);
                            }}
                        />
                    </div>
                </div>
            </div>

            {category === "timbres" && !query.trim() && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-ore-border bg-ore-raised px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-ore-divider bg-ore-sunken text-brand">
                            <AudioWaveform size={17} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold">
                                <span>{bundledPiano.label}</span>
                                <SongBadge tone="brand">内置必选</SongBadge>
                                {previewTimbreId === bundledPiano.id && (
                                    <SongBadge tone="brand">当前试听</SongBadge>
                                )}
                            </div>
                            <p className="mt-0.5 text-[12px] text-ore-dim">
                                {bundledPiano.description}（默认随附加包底包内置，无需额外安装）
                            </p>
                        </div>
                    </div>
                    <RowPlayButton
                        playState={
                            playerState.songId === `timbre-demo:${bundledPiano.id}` &&
                            playerState.status === "playing"
                                ? "playing"
                                : "idle"
                        }
                        label={`试听 ${bundledPiano.label}`}
                        onPlay={() => {
                            if (
                                playerState.songId === `timbre-demo:${bundledPiano.id}` &&
                                playerState.status === "playing"
                            ) {
                                studioPlayer.pause();
                            } else {
                                void previewTimbreDemo(bundledPiano.id);
                            }
                        }}
                    />
                </div>
            )}

            {filtered.length === 0 ? (
                <EmptyState
                    icon={<Boxes size={24} />}
                    title="暂无匹配的扩展"
                    description="请切换分类、取消勾选「仅看已安装」，或拖入 / 上传 .pbeplugin 扩展包。"
                />
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {filtered.map((plugin) => {
                        const statusMeta = DEPLOY_STATUS_LABELS[plugin.status];
                        const hasSongs = plugin.contents.songs > 0;
                        const timbreId =
                            plugin.timbreEntries?.[0]?.id ?? plugin.provides.timbres?.[0];
                        const isTimbre = Boolean(timbreId);
                        const isPlayingDemo =
                            Boolean(timbreId) &&
                            playerState.songId === `timbre-demo:${timbreId}` &&
                            playerState.status === "playing";
                        const canUseTimbre = Boolean(timbreId) && installedTimbreSet.has(timbreId!);
                        return (
                            <div
                                key={plugin.id}
                                className="flex flex-col justify-between gap-3 rounded-lg border border-ore-border bg-ore-raised p-4 transition-colors hover:border-ore-border-strong"
                            >
                                <div className="flex items-start gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setDetailPluginId(plugin.id)}
                                        className="shrink-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/70 rounded-lg"
                                        title={`查看 ${plugin.name} 详情`}
                                    >
                                        <PluginIcon plugin={plugin} />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setDetailPluginId(plugin.id)}
                                                className="text-left text-[14px] font-semibold hover:text-brand transition-colors"
                                            >
                                                {plugin.name}
                                            </button>
                                            <span className="text-[11px] tabular-nums text-ore-dimmer">
                                                v{plugin.version}
                                            </span>
                                            {plugin.installed ? (
                                                mode === "server" ? (
                                                    <SongBadge tone={statusMeta.tone}>
                                                        {statusMeta.label}
                                                    </SongBadge>
                                                ) : (
                                                    <SongBadge
                                                        tone={
                                                            isTimbre || plugin.enabled
                                                                ? "brand"
                                                                : "default"
                                                        }
                                                    >
                                                        {isTimbre
                                                            ? "已安装"
                                                            : plugin.enabled
                                                              ? "已启用"
                                                              : "已停用"}
                                                    </SongBadge>
                                                )
                                            ) : (
                                                <SongBadge>未安装</SongBadge>
                                            )}
                                            {timbreId && canUseTimbre && previewTimbreId === timbreId && (
                                                <SongBadge tone="brand">当前试听</SongBadge>
                                            )}
                                            {plugin.visibility === "internal" && (
                                                <SongBadge>
                                                    <span className="inline-flex items-center gap-1">
                                                        <EyeOff size={10} /> 内部
                                                    </span>
                                                </SongBadge>
                                            )}
                                            {plugin.hasExecutableCode && (
                                                <SongBadge>
                                                    <span className="inline-flex items-center gap-1">
                                                        <Code2 size={10} /> 含脚本
                                                    </span>
                                                </SongBadge>
                                            )}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ore-dim">
                                            <span>{SOURCE_LABELS[plugin.source]}</span>
                                            <span>· {plugin.author}</span>
                                            {plugin.sizeBytes > 0 && (
                                                <span className="tabular-nums">· {formatBytes(plugin.sizeBytes)}</span>
                                            )}
                                        </div>
                                        {plugin.description && (
                                            <p className="mt-1.5 line-clamp-2 text-[12px] text-ore-dim">
                                                {plugin.description}
                                            </p>
                                        )}
                                        <div className="mt-2 text-[11px] text-ore-dimmer">
                                            {summarizePluginCapabilities(plugin)}
                                        </div>
                                    </div>
                                    {timbreId && plugin.installed && (
                                        <RowPlayButton
                                            playState={isPlayingDemo ? "playing" : "idle"}
                                            label={
                                                canUseTimbre
                                                    ? `试听 ${plugin.name}`
                                                    : `试听样音 ${plugin.name}（已安装待启用）`
                                            }
                                            onPlay={() => {
                                                if (isPlayingDemo) {
                                                    studioPlayer.pause();
                                                } else if (canUseTimbre) {
                                                    void previewTimbreDemo(timbreId);
                                                } else {
                                                    void auditionTimbreSample(timbreId);
                                                }
                                            }}
                                        />
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ore-divider pt-2.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {!plugin.installed ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                loading={installingId === plugin.id}
                                                onClick={() => void handleInstall(plugin)}
                                            >
                                                <Download size={13} /> {hasSongs ? "整包安装" : "安装"}
                                            </Button>
                                        ) : !plugin.trusted ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => void handleTrust(plugin)}
                                            >
                                                <ShieldCheck size={13} /> 信任并启用
                                            </Button>
                                        ) : isTimbre && mode === "local" ? (
                                            <span className="text-[11.5px] text-ore-dim">
                                                网页端已就绪 · 可在附加包选择打包
                                            </span>
                                        ) : (
                                            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px]">
                                                <input
                                                    type="checkbox"
                                                    checked={plugin.enabled}
                                                    onChange={() => void handleToggle(plugin)}
                                                    className="h-4 w-4 accent-[var(--pb-primary)]"
                                                />
                                                <span>{plugin.enabled ? "已启用" : "已停用"}</span>
                                            </label>
                                        )}

                                        {hasSongs && (mode === "local" || plugin.installed) && (
                                            <Button
                                                type="button"
                                                color="secondary"
                                                size="sm"
                                                onClick={() => setBrowsePlugin(plugin)}
                                            >
                                                <ListMusic size={13} /> 浏览 / 挑单曲
                                            </Button>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={() => setDetailPluginId(plugin.id)}
                                        >
                                            <Info size={13} /> 详情
                                        </Button>
                                        {plugin.installed && (
                                            <Button
                                                type="button"
                                                color="ghost"
                                                size="sm"
                                                onClick={() => setUninstallTarget(plugin)}
                                            >
                                                <Trash2 size={13} /> 卸载
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <PluginDetailDialog
                plugin={detailPlugin}
                mode={mode}
                installing={Boolean(detailPlugin && installingId === detailPlugin.id)}
                onClose={() => setDetailPluginId(null)}
                onInstall={(plugin) => void handleInstall(plugin)}
                onToggle={(plugin) => void handleToggle(plugin)}
                onTrust={(plugin) => void handleTrust(plugin)}
                onUninstall={(plugin) => setUninstallTarget(plugin)}
                onBrowseSongs={(plugin) => setBrowsePlugin(plugin)}
            />

            <PluginContentDialog
                plugin={browsePlugin}
                libraries={libraries}
                existingSongIds={existingSongIds}
                existingFingerprints={existingFingerprints}
                onClose={() => setBrowsePlugin(null)}
                onLoadArchive={loadPluginArchive}
                onInstallPack={installBuiltinPlugin}
                onImportSingle={importSingleSongFromPlugin}
            />

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
                        ? `确定要卸载「${uninstallTarget.name}」吗？属于此扩展独占的歌曲、演出与资源将被移除（已添加到自己曲库的数据保留）。`
                        : ""
                }
                confirmLabel="确认卸载"
                onConfirm={() => void confirmUninstall()}
                onCancel={() => setUninstallTarget(null)}
            />
        </div>
    );
}
