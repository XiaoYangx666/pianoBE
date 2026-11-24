import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    Copy,
    Download,
    Eye,
    FileUp,
    ImagePlus,
    KeyRound,
    Music2,
    Package,
    Plus,
    RefreshCw,
    Server,
    Trash2,
    Upload,
    Wand2,
} from "lucide-react";
import { TIME_SCALE } from "@piano/core";
import {
    Button,
    ConfirmDialog,
    EmptyState,
    PageHeader,
    RowPlayButton,
    Segmented,
    SongBadge,
    SongRow,
    Textfield,
    Textarea,
    VirtualSongList,
    copyText,
    notify,
    songTableGrid,
    usePlayerState,
} from "@piano/ui";
import {
    computeLocalSongPluginMatch,
    importScoresFromArchiveFile,
} from "../adapters/localAdapter";
import { getServerToken, serverApi } from "../adapters/serverAdapter";
import type { StudioTokenInfo } from "../adapters/types";
import { studioPlayer } from "../audio/player";
import { ScorePreviewModal } from "../components/ScorePreviewModal";
import { importScorePages } from "../scores/importPages";
import type { ScoreEntry } from "../scores/scores";
import { useStudio } from "../store/studio";

function formatBytesMB(bytes: number): string {
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDuration(scaled: number): string {
    const sec = Math.max(0, Math.floor(scaled / TIME_SCALE));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function AddonPage() {
    const navigate = useNavigate();
    const mode = useStudio((s) => s.mode);
    const busy = useStudio((s) => s.busy);

    const template = useStudio((s) => s.template);
    const templateVersion = useStudio((s) => s.templateVersion);
    const addonName = useStudio((s) => s.addonName);
    const addonDesc = useStudio((s) => s.addonDesc);
    const randomUuid = useStudio((s) => s.randomUuid);

    const songs = useStudio((s) => s.songs);
    const libraries = useStudio((s) => s.libraries);
    const plugins = useStudio((s) => s.plugins);
    const addonSelectedLibraryIds = useStudio((s) => s.addonSelectedLibraryIds);
    const selectedSongIds = useStudio((s) => s.selectedSongIds);
    const selectedPluginIds = useStudio((s) => s.selectedPluginIds);
    const timbreIndex = useStudio((s) => s.timbreIndex);
    const selectedTimbreIds = useStudio((s) => s.selectedTimbreIds);
    const previewTimbreId = useStudio((s) => s.previewTimbreId);
    const scores = useStudio((s) => s.scores);

    const setAddonName = useStudio((s) => s.setAddonName);
    const setAddonDesc = useStudio((s) => s.setAddonDesc);
    const setRandomUuid = useStudio((s) => s.setRandomUuid);
    const toggleLibraryInAddon = useStudio((s) => s.toggleLibraryInAddon);
    const toggleSongInAddon = useStudio((s) => s.toggleSongInAddon);
    const includeAllSongsInAddon = useStudio((s) => s.includeAllSongsInAddon);
    const clearAddonSongs = useStudio((s) => s.clearAddonSongs);
    const autoMatchLocalPlugins = useStudio((s) => s.autoMatchLocalPlugins);
    const zeroLocalPlugins = useStudio((s) => s.zeroLocalPlugins);
    const toggleTimbre = useStudio((s) => s.toggleTimbre);
    const previewTimbreDemo = useStudio((s) => s.previewTimbreDemo);
    const addScores = useStudio((s) => s.addScores);
    const removeScore = useStudio((s) => s.removeScore);
    const applyTemplateFile = useStudio((s) => s.applyTemplateFile);
    const exportLocalMcaddon = useStudio((s) => s.exportLocalMcaddon);
    const loadTemplate = useStudio((s) => s.loadTemplate);
    const getSongBytes = useStudio((s) => s.getSongBytes);

    const deploymentStatus = useStudio((s) => s.deploymentStatus);
    const updateBdsConfig = useStudio((s) => s.updateBdsConfig);
    const deployServerToBds = useStudio((s) => s.deployServerToBds);
    const downloadServerAddon = useStudio((s) => s.downloadServerAddon);

    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get("tab");
    const [localTab, setLocalTabState] = useState<"pack" | "timbres" | "scores" | "export">(() =>
        tabParam === "timbres" || tabParam === "scores" || tabParam === "export" || tabParam === "pack"
            ? tabParam
            : "pack",
    );
    const [serverTab, setServerTabState] = useState<"deploy" | "timbres" | "scores" | "tokens">(() =>
        tabParam === "timbres" || tabParam === "scores" || tabParam === "tokens" || tabParam === "deploy"
            ? tabParam
            : "deploy",
    );

    useEffect(() => {
        if (tabParam === "timbres" || tabParam === "scores" || tabParam === "export" || tabParam === "pack") {
            setLocalTabState(tabParam);
        }
        if (tabParam === "timbres" || tabParam === "scores" || tabParam === "tokens" || tabParam === "deploy") {
            setServerTabState(tabParam);
        }
    }, [tabParam]);

    const setLocalTab = (next: "pack" | "timbres" | "scores" | "export") => {
        setLocalTabState(next);
        setSearchParams({ tab: next }, { replace: true });
    };
    const setServerTab = (next: "deploy" | "timbres" | "scores" | "tokens") => {
        setServerTabState(next);
        setSearchParams({ tab: next }, { replace: true });
    };
    const [songFilter, setSongFilter] = useState("");

    const [previewScore, setPreviewScore] = useState<ScoreEntry | null>(null);
    const templateInputRef = useRef<HTMLInputElement>(null);
    const scorePageInputRef = useRef<HTMLInputElement>(null);
    const scorePackInputRef = useRef<HTMLInputElement>(null);
    const serverTplInputRef = useRef<HTMLInputElement>(null);

    const [bdsDir, setBdsDir] = useState("");
    const [bdsWorld, setBdsWorld] = useState("");
    const [bdsBpName, setBdsBpName] = useState("");
    const [bdsRpName, setBdsRpName] = useState("");

    const [tokens, setTokens] = useState<StudioTokenInfo[]>([]);
    const [tokenForbidden, setTokenForbidden] = useState(false);
    const [tokenLabel, setTokenLabel] = useState("");
    const [tokenRole, setTokenRole] = useState<"read" | "write" | "admin">("read");
    const [createdToken, setCreatedToken] = useState<{ label: string; token: string } | null>(null);
    const [revokeTarget, setRevokeTarget] = useState<StudioTokenInfo | null>(null);
    const [copied, setCopied] = useState(false);

    const playerState = usePlayerState(studioPlayer);

    useEffect(() => {
        if (!deploymentStatus) return;
        setBdsDir(deploymentStatus.bdsConfig.bdsDir);
        setBdsWorld(deploymentStatus.bdsConfig.bdsWorld);
        setBdsBpName(deploymentStatus.bdsConfig.bdsBpName);
        setBdsRpName(deploymentStatus.bdsConfig.bdsRpName);
    }, [deploymentStatus]);

    useEffect(() => {
        if (mode === "local" && !template) void loadTemplate();
    }, [mode, template, loadTemplate]);

    const loadTokens = async () => {
        try {
            const res = await serverApi.listTokens();
            setTokens(res.items);
            setTokenForbidden(false);
        } catch {
            setTokenForbidden(true);
        }
    };

    useEffect(() => {
        if (mode === "server" && serverTab === "tokens") {
            void loadTokens();
        }
    }, [mode, serverTab]);

    const activeScores = useMemo<ScoreEntry[]>(() => {
        if (mode === "server") {
            return (deploymentStatus?.scores ?? []).map((s) => ({
                id: s.id,
                title: s.title,
                pages: s.pages,
                pageCount: s.pageCount,
                source: "custom" as const,
            }));
        }
        return scores;
    }, [mode, deploymentStatus?.scores, scores]);

    const activeTimbreIds =
        mode === "server"
            ? (deploymentStatus?.enabledTimbres ?? ["piano"])
            : selectedTimbreIds;

    const handleImportScorePages = async (files: File[]) => {
        try {
            const res = await importScorePages(files, activeScores, {
                requestTitle: async (defaultTitle) => defaultTitle,
            });
            if (res.scores.length > 0) {
                await addScores(res.scores);
                notify({ title: `已添加 ${res.scores.length} 张自定义曲谱`, color: "teal" });
            }
            if (res.errors.length > 0) {
                notify({ title: "部分文件未能导入", message: res.errors.join("；"), color: "yellow" });
            }
        } catch (err) {
            notify({
                title: "曲谱导入失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const handleImportScorePack = async (file: File) => {
        try {
            const imported = await importScoresFromArchiveFile(file, activeScores);
            if (imported.length > 0) {
                await addScores(imported);
                notify({ title: `从包内导入 ${imported.length} 张曲谱`, color: "teal" });
            }
        } catch (err) {
            notify({
                title: "导入曲谱包失败",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
            });
        }
    };

    const selectedSet = useMemo(() => new Set(selectedSongIds), [selectedSongIds]);
    const packedSongs = useMemo(
        () => songs.filter((s) => selectedSet.has(s.id)),
        [songs, selectedSet],
    );

    const localMatch = useMemo(() => {
        if (mode !== "local") return null;
        return computeLocalSongPluginMatch(packedSongs, plugins, selectedPluginIds);
    }, [mode, packedSongs, plugins, selectedPluginIds]);

    const filteredAllSongs = useMemo(() => {
        const q = songFilter.trim().toLowerCase();
        const list = q
            ? songs.filter(
                  (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
              )
            : songs;
        // 已入选的排在前面
        return [...list].sort((a, b) => {
            const aIn = selectedSet.has(a.id) ? 0 : 1;
            const bIn = selectedSet.has(b.id) ? 0 : 1;
            return aIn - bIn;
        });
    }, [songs, songFilter, selectedSet]);

    const extraTimbreBytes = timbreIndex
        .filter((t) => !t.bundled && activeTimbreIds.includes(t.id))
        .reduce((sum, t) => sum + t.size, 0);

    const enabledVfxPlugins = plugins.filter(
        (p) =>
            p.installed &&
            selectedPluginIds.includes(p.id) &&
            Boolean(
                p.hasExecutableCode ||
                    p.contents.effects ||
                    p.contents.themes ||
                    p.contents.keyStyles ||
                    p.contents.particles ||
                    p.contents.stageProps,
            ),
    );
    const selectedPluginBytes = enabledVfxPlugins.reduce((sum, p) => sum + p.sizeBytes, 0);

    const renderPackSongRow = useCallback(
        (song: (typeof songs)[number], index: number) => {
            const checked = selectedSet.has(song.id);
            const isPlaying = playerState.songId === song.id && playerState.status === "playing";
            return (
                <SongRow
                    layout="table"
                    statsColumns={1}
                    index={index + 1}
                    title={song.name}
                    stats={[song.noteCount.toLocaleString()]}
                    meta={[`${song.noteCount} 音符`]}
                    duration={formatDuration(song.duration)}
                    active={isPlaying}
                    playState={isPlaying ? "playing" : "idle"}
                    onPlay={() =>
                        void studioPlayer.toggleSong(
                            song.id,
                            song.name,
                            () => getSongBytes(song.id),
                            "pbe3",
                        )
                    }
                    trailing={
                        <button
                            type="button"
                            onClick={() => toggleSongInAddon(song.id)}
                            className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11.5px] transition-colors ${
                                checked
                                    ? "border-brand/50 bg-[var(--pb-brand-soft)] text-[color:var(--pb-primary-light)]"
                                    : "border-ore-border text-ore-dim hover:text-ore-text"
                            }`}
                        >
                            {checked ? <Check size={12} /> : <Plus size={12} />}
                            {checked ? "已包含" : "加入"}
                        </button>
                    }
                />
            );
        },
        [getSongBytes, playerState.songId, playerState.status, selectedSet, toggleSongInAddon],
    );

    const installedTimbreIdSet = useMemo(() => {
        const set = new Set<string>(["piano"]);
        for (const p of plugins) {
            if (!p.installed) continue;
            for (const id of p.provides.timbres ?? []) set.add(id);
            for (const entry of p.timbreEntries ?? []) set.add(entry.id);
        }
        if (mode === "server") {
            for (const id of activeTimbreIds) set.add(id);
        }
        return set;
    }, [plugins, mode, activeTimbreIds]);

    const installedTimbres = useMemo(
        () => timbreIndex.filter((t) => t.bundled || installedTimbreIdSet.has(t.id)),
        [timbreIndex, installedTimbreIdSet],
    );

    const uninstalledTimbreCount = useMemo(
        () =>
            plugins.filter(
                (p) =>
                    !p.installed &&
                    Boolean(p.contents.timbres || p.timbreEntries?.length || p.provides.timbres?.length),
            ).length,
        [plugins],
    );

    const timbresSection = (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ore-dim">
                <span>
                    仅显示已安装到工作区的音色插件；勾选后随附加包一并装配进游戏资源，点击右侧即可试听。
                </span>
                <div className="flex items-center gap-2">
                    <span className="tabular-nums text-ore-dimmer">
                        已启用 {activeTimbreIds.length} 套
                    </span>
                    <Button
                        type="button"
                        color="ghost"
                        size="sm"
                        onClick={() => navigate("/extensions?tab=timbres")}
                    >
                        去扩展中心安装音色
                    </Button>
                </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                {installedTimbres.map((t) => {
                    const checked = activeTimbreIds.includes(t.id);
                    const isPreviewing = previewTimbreId === t.id;
                    const isPlayingDemo =
                        playerState.songId === `timbre-demo:${t.id}` &&
                        playerState.status === "playing";
                    return (
                        <div
                            key={t.id}
                            className={`flex items-center gap-3 rounded-lg border p-3.5 transition-colors ${
                                checked
                                    ? "border-brand/40 bg-[var(--pb-active)]"
                                    : "border-ore-border bg-ore-raised"
                            }`}
                        >
                            <input
                                type="checkbox"
                                disabled={t.required || t.id === "piano"}
                                checked={checked}
                                onChange={() => void toggleTimbre(t.id)}
                                aria-label={`选择音色 ${t.label}`}
                                className="h-4 w-4 shrink-0 accent-[var(--pb-primary)]"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                                    <span>{t.label}</span>
                                    <SongBadge>
                                        {t.bundled ? "内置必选" : formatBytesMB(t.size)}
                                    </SongBadge>
                                    {isPreviewing && <SongBadge tone="brand">当前音色</SongBadge>}
                                </div>
                                <p className="mt-1 text-[12px] text-ore-dim">{t.description}</p>
                            </div>
                            <RowPlayButton
                                playState={isPlayingDemo ? "playing" : "idle"}
                                label={`试听 ${t.label}`}
                                onPlay={() => {
                                    if (isPlayingDemo) {
                                        studioPlayer.pause();
                                    } else {
                                        void previewTimbreDemo(t.id);
                                    }
                                }}
                            />
                        </div>
                    );
                })}
            </div>
            {uninstalledTimbreCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ore-divider bg-ore-sunken px-3.5 py-2.5 text-[12px] text-ore-dim">
                    <span>还有 {uninstalledTimbreCount} 套官方钢琴音色未安装，可在扩展中心先试听样音再安装。</span>
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        onClick={() => navigate("/extensions?tab=timbres")}
                    >
                        去扩展中心选音色
                    </Button>
                </div>
            )}
        </div>
    );

    const scoresSection = (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
                <input
                    ref={scorePageInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.pdf"
                    multiple
                    hidden
                    onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (files.length > 0) void handleImportScorePages(files);
                    }}
                />
                <input
                    ref={scorePackInputRef}
                    type="file"
                    accept=".mcaddon,.mcpack"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleImportScorePack(file);
                    }}
                />
                <Button
                    type="button"
                    size="sm"
                    onClick={() => scorePageInputRef.current?.click()}
                >
                    <ImagePlus size={14} /> 导入图片 / PDF 曲谱
                </Button>
                <Button
                    type="button"
                    color="secondary"
                    size="sm"
                    onClick={() => scorePackInputRef.current?.click()}
                >
                    <FileUp size={14} /> 从既有 .mcaddon 导入曲谱
                </Button>
            </div>

            {activeScores.length === 0 ? (
                <EmptyState
                    icon={<Package size={24} />}
                    title={mode === "server" ? "暂无自定义服务器曲谱" : "暂无曲谱"}
                    description="可将 PDF 或曲谱图片批量导入，随附加包一并装配进游戏谱架。"
                />
            ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                    {activeScores.map((score) => (
                        <div
                            key={score.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-ore-border bg-ore-raised px-3.5 py-2.5"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                                    <span className="truncate">{score.title}</span>
                                    <SongBadge>
                                        {score.source === "template" ? "模板" : "自定义"}
                                    </SongBadge>
                                </div>
                                <div className="text-[11px] text-ore-dim">
                                    {score.pageCount ?? score.pages.length} 页 ·{" "}
                                    <code>{score.id}</code>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <Button
                                    type="button"
                                    color="ghost"
                                    size="sm"
                                    onClick={() => setPreviewScore(score)}
                                >
                                    <Eye size={13} /> 预览
                                </Button>
                                {score.source === "custom" && (
                                    <Button
                                        type="button"
                                        color="ghost"
                                        size="sm"
                                        onClick={() => void removeScore(score.id)}
                                    >
                                        <Trash2 size={13} />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const loadServerScoreBlob = useCallback(async (pagePath: string) => {
        const token = getServerToken();
        const res = await fetch(`/api/addon/scores/asset/${encodeURIComponent(pagePath)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return null;
        return res.blob();
    }, []);

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                eyebrow={mode === "server" ? "BDS Server Runtime" : "Local MCAddon Builder"}
                title="附加包"
                description={
                    mode === "server"
                        ? "装配游戏运行环境（插件、钢琴音色、曲谱）并一键部署到 Bedrock Dedicated Server。"
                        : "按曲库或单曲装配本次要打包的内容，选择钢琴音色与曲谱，导出可安装的 .mcaddon。"
                }
            />

            {mode === "local" ? (
                <>
                    <Segmented
                        value={localTab}
                        onChange={(v) => setLocalTab(v as typeof localTab)}
                        options={[
                            { value: "pack", label: "打包内容", count: packedSongs.length },
                            { value: "timbres", label: "钢琴音色", count: activeTimbreIds.length },
                            { value: "scores", label: "曲谱管理", count: activeScores.length },
                            { value: "export", label: "导出设置" },
                        ]}
                    />

                    {localTab === "pack" && (
                        <div className="flex flex-col gap-4">
                            {/* 按曲库整组勾选 */}
                            <div className="rounded-xl border border-ore-border bg-ore-raised p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <div className="text-[13px] font-semibold">
                                            按曲库装配（勾选后会同步把曲库结构带入游戏内）
                                        </div>
                                        <p className="mt-0.5 text-[11.5px] text-ore-dim">
                                            可在下方微调单曲；勾选状态会自动持久化。
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            color="secondary"
                                            size="sm"
                                            onClick={includeAllSongsInAddon}
                                        >
                                            全部纳入
                                        </Button>
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={clearAddonSongs}
                                        >
                                            清空清单
                                        </Button>
                                    </div>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {libraries.map((lib) => {
                                        const checked = addonSelectedLibraryIds.includes(lib.id);
                                        const count = songs.filter(
                                            (s) =>
                                                s.libraries?.includes(lib.id) ||
                                                lib.songIds.includes(s.id),
                                        ).length;
                                        return (
                                            <label
                                                key={lib.id}
                                                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12.5px] transition-colors ${
                                                    checked
                                                        ? "border-brand/50 bg-[var(--pb-active)]"
                                                        : "border-ore-border bg-ore-sunken"
                                                }`}
                                            >
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleLibraryInAddon(lib.id)}
                                                        className="h-4 w-4 shrink-0 accent-[var(--pb-primary)]"
                                                    />
                                                    <span className="truncate font-medium">
                                                        {lib.name}
                                                    </span>
                                                    {lib.kind === "plugin" && (
                                                        <SongBadge>插件</SongBadge>
                                                    )}
                                                </span>
                                                <span className="shrink-0 text-[11px] tabular-nums text-ore-dim">
                                                    {count} 首
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* VFX 特效依赖自检 */}
                            {localMatch &&
                                (localMatch.missingEffects.length > 0 ||
                                    localMatch.disabledRequiredEffects.length > 0) && (
                                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--pb-warning)]/40 bg-[color:var(--pb-warning)]/10 p-3 text-[12px]">
                                        <div className="flex items-start gap-2">
                                            <AlertTriangle
                                                size={16}
                                                className="mt-0.5 shrink-0 text-[color:var(--pb-warning)]"
                                            />
                                            <div>
                                                <div className="font-semibold text-ore-text">
                                                    已选曲目的演出缺少或未启用特效插件
                                                </div>
                                                <div className="mt-0.5 text-[11.5px] text-ore-dim">
                                                    {localMatch.disabledRequiredEffects.length > 0 &&
                                                        `未启用：${localMatch.disabledRequiredEffects.map((d) => d.pluginName).join("、")}；`}
                                                    {localMatch.missingEffects.length > 0 &&
                                                        `缺失特效：${localMatch.missingEffects.map((m) => m.effect).join("、")}`}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => void autoMatchLocalPlugins()}
                                            >
                                                <Wand2 size={13} /> 自动匹配并启用所需插件
                                            </Button>
                                            <Button
                                                type="button"
                                                color="ghost"
                                                size="sm"
                                                onClick={() => navigate("/extensions?tab=effects")}
                                            >
                                                扩展中心
                                            </Button>
                                        </div>
                                    </div>
                                )}

                            {/* 已选插件状态摘要 */}
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ore-border bg-ore-raised px-3.5 py-2.5 text-[12px]">
                                <div>
                                    <span className="font-semibold">
                                        已装配 VFX 特效扩展 ({enabledVfxPlugins.length})
                                    </span>
                                    <span className="ml-2 text-ore-dim">
                                        {enabledVfxPlugins.length === 0
                                            ? "纯净模式（仅音乐与基础钢琴）"
                                            : `${(selectedPluginBytes / 1024).toFixed(0)} KB`}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm"
                                        onClick={() => void autoMatchLocalPlugins()}
                                    >
                                        <Wand2 size={13} /> 按打包曲目自动匹配
                                    </Button>
                                    <Button
                                        type="button"
                                        color="ghost"
                                        size="sm"
                                        onClick={() => void zeroLocalPlugins()}
                                    >
                                        零插件纯净模式
                                    </Button>
                                </div>
                            </div>

                            {/* 单曲微调列表 */}
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[12.5px] font-semibold">
                                        最终打包曲目清单 ({packedSongs.length} / {songs.length})
                                    </span>
                                    <div className="w-full sm:w-[240px]">
                                        <Textfield
                                            placeholder="过滤曲目…"
                                            value={songFilter}
                                            onInput={(e) => {
                                                const t = e.target as unknown as { value?: unknown };
                                                if (typeof t?.value === "string") setSongFilter(t.value);
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="overflow-hidden rounded-lg border border-ore-border bg-ore-raised">
                                    <div
                                        className={`hidden items-center gap-3 border-b border-ore-border bg-[var(--pb-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dim md:grid ${songTableGrid(1)}`}
                                    >
                                        <span className="text-center">#</span>
                                        <span>曲目</span>
                                        <span className="text-right">音符</span>
                                        <span className="text-right">时长</span>
                                        <span />
                                    </div>
                                    <VirtualSongList
                                        className="h-[340px]"
                                        items={filteredAllSongs}
                                        rowHeight={50}
                                        gap={0}
                                        getKey={(s) => s.id}
                                        renderItem={renderPackSongRow}
                                        empty={
                                            <div className="grid h-[200px] place-items-center text-[12.5px] text-ore-dim">
                                                <div className="flex flex-col items-center gap-2">
                                                    <Music2 size={20} />
                                                    <span>曲库为空，请先去音乐库导入或扩展中心安装曲库包</span>
                                                </div>
                                            </div>
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {localTab === "timbres" && timbresSection}
                    {localTab === "scores" && scoresSection}

                    {localTab === "export" && (
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                            <div className="flex flex-col gap-4 rounded-xl border border-ore-border bg-ore-raised p-4">
                                <Textfield
                                    label="Pack Name"
                                    value={addonName}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setAddonName(t.value);
                                    }}
                                />
                                <Textarea
                                    label="Description"
                                    rows={3}
                                    value={addonDesc}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setAddonDesc(t.value);
                                    }}
                                />
                                <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                                    <input
                                        type="checkbox"
                                        checked={randomUuid}
                                        onChange={(e) => setRandomUuid(e.currentTarget.checked)}
                                        className="h-4 w-4 accent-[var(--pb-primary)]"
                                    />
                                    <span>每次导出随机生成新的 BP / RP UUID</span>
                                </label>
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ore-divider pt-3 text-[12px]">
                                    <span className="text-ore-dim">底层模板版本：{templateVersion}</span>
                                    <input
                                        ref={templateInputRef}
                                        type="file"
                                        accept=".mcaddon"
                                        hidden
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            e.target.value = "";
                                            if (f) void applyTemplateFile(f);
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm"
                                        onClick={() => templateInputRef.current?.click()}
                                    >
                                        <RefreshCw size={13} /> 替换本地模板
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-col justify-between gap-4 rounded-xl border border-ore-border bg-ore-raised p-4">
                                <div className="flex flex-col gap-2.5 text-[12.5px]">
                                    <div className="text-[13px] font-semibold">装配清单摘要</div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">包含曲目</span>
                                        <span>{packedSongs.length} 首</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">装配 VFX 扩展</span>
                                        <span>
                                            {enabledVfxPlugins.length === 0
                                                ? "0 个（纯净模式）"
                                                : `${enabledVfxPlugins.length} 个 (${(selectedPluginBytes / 1024).toFixed(0)} KB)`}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">打包音色</span>
                                        <span>
                                            {activeTimbreIds.length} 套
                                            {extraTimbreBytes > 0
                                                ? ` (+${formatBytesMB(extraTimbreBytes)})`
                                                : ""}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">随包曲谱</span>
                                        <span>{activeScores.length} 张</span>
                                    </div>
                                </div>

                                <Button
                                    type="button"
                                    disabled={!template}
                                    loading={busy}
                                    onClick={() =>
                                        void exportLocalMcaddon().catch((err) =>
                                            notify({
                                                title: "导出失败",
                                                message: err instanceof Error ? err.message : String(err),
                                                color: "red",
                                            }),
                                        )
                                    }
                                >
                                    <Download size={15} /> 导出 .mcaddon
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <Segmented
                        value={serverTab}
                        onChange={(v) => setServerTab(v as typeof serverTab)}
                        options={[
                            { value: "deploy", label: "BDS 部署与校验" },
                            { value: "timbres", label: "钢琴音色", count: activeTimbreIds.length },
                            { value: "scores", label: "曲谱管理", count: activeScores.length },
                            { value: "tokens", label: "访问令牌管理" },
                        ]}
                    />

                    {serverTab === "deploy" && (
                        <div className="flex flex-col gap-4">
                            {deploymentStatus && (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ore-border bg-ore-raised p-4">
                                    <div className="flex items-start gap-3">
                                        {deploymentStatus.status === "active" ? (
                                            <CheckCircle2 size={20} className="mt-0.5 text-brand" />
                                        ) : (
                                            <AlertTriangle
                                                size={20}
                                                className="mt-0.5 text-[color:var(--pb-warning)]"
                                            />
                                        )}
                                        <div>
                                            <div className="text-[14px] font-semibold">
                                                {deploymentStatus.status === "active" &&
                                                    "BDS 资源已同步并生效"}
                                                {deploymentStatus.status === "pending_deploy" &&
                                                    "配置、音色、曲谱或插件已变更，待重新部署到 BDS"}
                                                {deploymentStatus.status === "pending_restart" &&
                                                    "已写入 BDS 磁盘，等待重启 BDS 服务器加载"}
                                                {deploymentStatus.status === "unavailable" &&
                                                    "尚未完成首次部署或存在依赖/模板问题"}
                                            </div>
                                            <div className="mt-1 text-[11.5px] text-ore-dim">
                                                目标哈希：<code>{deploymentStatus.targetConfigHash}</code> ·
                                                已部署：<code>{deploymentStatus.deployedConfigHash ?? "-"}</code> ·
                                                运行中上报：<code>{deploymentStatus.loadedConfigHash ?? "-"}</code>
                                            </div>
                                            {deploymentStatus.issues.length > 0 && (
                                                <div className="mt-1 text-[11.5px] text-red-400">
                                                    {deploymentStatus.issues.join("；")}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            color="secondary"
                                            loading={busy}
                                            onClick={() =>
                                                void downloadServerAddon().catch((err) =>
                                                    notify({
                                                        title: "生成失败",
                                                        message:
                                                            err instanceof Error ? err.message : String(err),
                                                        color: "red",
                                                    }),
                                                )
                                            }
                                        >
                                            <Download size={14} /> 下载配套 .mcaddon
                                        </Button>
                                        <Button
                                            type="button"
                                            loading={busy}
                                            onClick={() =>
                                                void deployServerToBds().catch((err) =>
                                                    notify({
                                                        title: "部署失败",
                                                        message:
                                                            err instanceof Error ? err.message : String(err),
                                                        color: "red",
                                                    }),
                                                )
                                            }
                                        >
                                            <Server size={14} /> 部署到 BDS
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <div className="grid gap-4 rounded-xl border border-ore-border bg-ore-raised p-4 sm:grid-cols-2">
                                <Textfield
                                    label="BDS 根目录 (BDS_DIR)"
                                    placeholder="/bds 或 E:\BDS"
                                    value={bdsDir}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setBdsDir(t.value);
                                    }}
                                />
                                <Textfield
                                    label="世界目录名 (BDS_WORLD)"
                                    placeholder="Bedrock level"
                                    value={bdsWorld}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setBdsWorld(t.value);
                                    }}
                                />
                                <Textfield
                                    label="行为包目录名"
                                    placeholder="pianoServerBP"
                                    value={bdsBpName}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setBdsBpName(t.value);
                                    }}
                                />
                                <Textfield
                                    label="资源包目录名"
                                    placeholder="pianoServerRP"
                                    value={bdsRpName}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setBdsRpName(t.value);
                                    }}
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                                    <div className="flex items-center gap-2 text-[12px] text-ore-dim">
                                        <span>
                                            服务端模板状态：
                                            {deploymentStatus?.templateReady ? "就绪" : "缺失，请上传"}
                                        </span>
                                        <input
                                            ref={serverTplInputRef}
                                            type="file"
                                            accept=".mcaddon"
                                            hidden
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                e.target.value = "";
                                                if (f) {
                                                    void applyTemplateFile(f).catch((err) =>
                                                        notify({
                                                            title: "上传模板失败",
                                                            message:
                                                                err instanceof Error
                                                                    ? err.message
                                                                    : String(err),
                                                            color: "red",
                                                        }),
                                                    );
                                                }
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            onClick={() => serverTplInputRef.current?.click()}
                                        >
                                            <Upload size={13} /> 上传服务端 .mcaddon 模板
                                        </Button>
                                    </div>
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm"
                                        onClick={() =>
                                            void updateBdsConfig({
                                                bdsDir,
                                                bdsWorld,
                                                bdsBpName,
                                                bdsRpName,
                                            })
                                        }
                                    >
                                        保存 BDS 配置
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {serverTab === "timbres" && timbresSection}
                    {serverTab === "scores" && scoresSection}

                    {serverTab === "tokens" && (
                        <div className="flex flex-col gap-4">
                            {tokenForbidden ? (
                                <div className="rounded-lg border border-ore-border bg-ore-raised p-4 text-[12.5px] text-ore-dim">
                                    当前登录令牌无管理员权限，无法管理 API 令牌。
                                </div>
                            ) : (
                                <>
                                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ore-border bg-ore-raised p-4">
                                        <div className="min-w-[200px] flex-1">
                                            <Textfield
                                                label="新令牌备注名"
                                                placeholder="例如：BDS 运维令牌"
                                                value={tokenLabel}
                                                onInput={(e) => {
                                                    const t = e.target as unknown as { value?: unknown };
                                                    if (typeof t?.value === "string") setTokenLabel(t.value);
                                                }}
                                            />
                                        </div>
                                        <select
                                            value={tokenRole}
                                            onChange={(e) =>
                                                setTokenRole(e.target.value as "read" | "write" | "admin")
                                            }
                                            className="h-9 rounded-md border border-[var(--pb-control-border)] bg-ore-sunken px-2.5 text-[12.5px]"
                                        >
                                            <option value="read">read · 只读</option>
                                            <option value="write">write · 可写</option>
                                            <option value="admin">admin · 管理员</option>
                                        </select>
                                        <Button
                                            type="button"
                                            disabled={!tokenLabel.trim()}
                                            onClick={() =>
                                                void serverApi
                                                    .createToken(tokenLabel.trim(), tokenRole)
                                                    .then((res) => {
                                                        setCreatedToken({
                                                            label: res.label,
                                                            token: res.token,
                                                        });
                                                        setTokenLabel("");
                                                        return loadTokens();
                                                    })
                                            }
                                        >
                                            <Plus size={14} /> 创建令牌
                                        </Button>
                                    </div>

                                    {createdToken && (
                                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand bg-[var(--pb-brand-soft)] p-3 text-[12px]">
                                            <div className="min-w-0 flex-1">
                                                <div className="font-semibold">
                                                    已生成「{createdToken.label}」（仅显示一次，请妥善保存）
                                                </div>
                                                <code className="mt-1 block break-all">
                                                    {createdToken.token}
                                                </code>
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => {
                                                    void copyText(createdToken.token);
                                                    setCopied(true);
                                                    window.setTimeout(() => setCopied(false), 1500);
                                                }}
                                            >
                                                {copied ? <Check size={13} /> : <Copy size={13} />} 复制
                                            </Button>
                                        </div>
                                    )}

                                    <div className="flex flex-col divide-y divide-ore-divider rounded-xl border border-ore-border bg-ore-raised">
                                        {tokens.map((tok) => (
                                            <div
                                                key={tok.id}
                                                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]"
                                            >
                                                <div>
                                                    <div className="flex items-center gap-2 font-medium">
                                                        <KeyRound size={13} className="text-ore-dim" />
                                                        <span>{tok.label}</span>
                                                        <SongBadge>{tok.role}</SongBadge>
                                                    </div>
                                                    <div className="text-[11px] text-ore-dimmer">
                                                        创建于 {new Date(tok.createdAt).toLocaleString()}
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    color="ghost"
                                                    size="sm"
                                                    onClick={() => setRevokeTarget(tok)}
                                                >
                                                    <Trash2 size={13} /> 吊销
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}

            <ScorePreviewModal
                score={previewScore}
                template={template}
                opened={Boolean(previewScore)}
                onLoadPage={mode === "server" ? loadServerScoreBlob : undefined}
                onClose={() => setPreviewScore(null)}
            />

            <ConfirmDialog
                opened={Boolean(revokeTarget)}
                title="吊销访问令牌"
                danger
                description={revokeTarget ? `确定吊销「${revokeTarget.label}」吗？` : ""}
                confirmLabel="吊销"
                onConfirm={() => {
                    if (revokeTarget) {
                        void serverApi.revokeToken(revokeTarget.id).then(() => loadTokens());
                    }
                    setRevokeTarget(null);
                }}
                onCancel={() => setRevokeTarget(null)}
            />
        </div>
    );
}
