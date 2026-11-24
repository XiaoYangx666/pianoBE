import { useEffect, useRef, useState } from "react";
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
    Package,
    Plus,
    RefreshCw,
    Server,
    Trash2,
    Upload,
} from "lucide-react";
import {
    Button,
    ConfirmDialog,
    EmptyState,
    PageHeader,
    Segmented,
    SongBadge,
    Textfield,
    Textarea,
    copyText,
    notify,
} from "@piano/ui";
import { importScoresFromArchiveFile } from "../adapters/localAdapter";
import { serverApi } from "../adapters/serverAdapter";
import type { StudioTokenInfo } from "../adapters/types";
import { ScorePreviewModal } from "../components/ScorePreviewModal";
import { importScorePages } from "../scores/importPages";
import type { ScoreEntry } from "../scores/scores";
import { useStudio } from "../store/studio";

function formatBytesMB(bytes: number): string {
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function AddonPage() {
    const mode = useStudio((s) => s.mode);
    const busy = useStudio((s) => s.busy);

    // Local assembly state
    const template = useStudio((s) => s.template);
    const templateVersion = useStudio((s) => s.templateVersion);
    const addonName = useStudio((s) => s.addonName);
    const addonDesc = useStudio((s) => s.addonDesc);
    const randomUuid = useStudio((s) => s.randomUuid);
    const selectedSongIds = useStudio((s) => s.selectedSongIds);
    const selectedPluginIds = useStudio((s) => s.selectedPluginIds);
    const plugins = useStudio((s) => s.plugins);
    const timbreIndex = useStudio((s) => s.timbreIndex);
    const selectedTimbreIds = useStudio((s) => s.selectedTimbreIds);
    const scores = useStudio((s) => s.scores);

    const setAddonName = useStudio((s) => s.setAddonName);
    const setAddonDesc = useStudio((s) => s.setAddonDesc);
    const setRandomUuid = useStudio((s) => s.setRandomUuid);
    const toggleTimbre = useStudio((s) => s.toggleTimbre);
    const addScores = useStudio((s) => s.addScores);
    const removeScore = useStudio((s) => s.removeScore);
    const applyTemplateFile = useStudio((s) => s.applyTemplateFile);
    const exportLocalMcaddon = useStudio((s) => s.exportLocalMcaddon);
    const loadTemplate = useStudio((s) => s.loadTemplate);

    // Server deployment state
    const deploymentStatus = useStudio((s) => s.deploymentStatus);
    const updateBdsConfig = useStudio((s) => s.updateBdsConfig);
    const deployServerToBds = useStudio((s) => s.deployServerToBds);
    const downloadServerAddon = useStudio((s) => s.downloadServerAddon);

    const [localTab, setLocalTab] = useState<"export" | "timbres" | "scores">("export");
    const [serverTab, setServerTab] = useState<"deploy" | "tokens">("deploy");

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

    useEffect(() => {
        if (!deploymentStatus) return;
        setBdsDir(deploymentStatus.bdsConfig.bdsDir);
        setBdsWorld(deploymentStatus.bdsConfig.bdsWorld);
        setBdsBpName(deploymentStatus.bdsConfig.bdsBpName);
        setBdsRpName(deploymentStatus.bdsConfig.bdsRpName);
    }, [deploymentStatus]);

    useEffect(() => {
        if (!template) void loadTemplate();
    }, [template, loadTemplate]);

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

    const handleImportScorePages = async (files: File[]) => {
        try {
            const res = await importScorePages(files, scores, {
                requestTitle: async (defaultTitle) => defaultTitle,
            });
            if (res.scores.length > 0) {
                addScores(res.scores);
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
            const imported = await importScoresFromArchiveFile(file, scores);
            if (imported.length > 0) {
                addScores(imported);
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

    const extraTimbreBytes = timbreIndex
        .filter((t) => !t.bundled && selectedTimbreIds.includes(t.id))
        .reduce((sum, t) => sum + t.size, 0);

    const selectedPluginBytes = plugins
        .filter((p) => selectedPluginIds.includes(p.id))
        .reduce((sum, p) => sum + p.sizeBytes, 0);

    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                eyebrow={mode === "server" ? "BDS Server Deployment" : "Local MCAddon Builder"}
                title="附加包"
                description={
                    mode === "server"
                        ? "装配并向 Bedrock Dedicated Server 一键部署行为包与资源包，或生成服务器配套 .mcaddon。"
                        : "将已选歌曲、扩展插件、音色采样与自定义曲谱装配为独立 .mcaddon 文件。"
                }
            />

            {mode === "local" ? (
                <>
                    <Segmented
                        value={localTab}
                        onChange={(v) => setLocalTab(v as typeof localTab)}
                        options={[
                            { value: "export", label: "导出设置" },
                            { value: "timbres", label: "音色选择", count: selectedTimbreIds.length },
                            { value: "scores", label: "曲谱管理", count: scores.length },
                        ]}
                    />

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
                                        <span>{selectedSongIds.length} 首</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">装配扩展</span>
                                        <span>
                                            {selectedPluginIds.length === 0
                                                ? "0 个（纯净模式）"
                                                : `${selectedPluginIds.length} 个 (${(selectedPluginBytes / 1024).toFixed(0)} KB)`}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">打包音色</span>
                                        <span>
                                            {selectedTimbreIds.length} 套
                                            {extraTimbreBytes > 0 ? ` (+${formatBytesMB(extraTimbreBytes)})` : ""}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-ore-dim">随包曲谱</span>
                                        <span>{scores.length} 张</span>
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

                    {localTab === "timbres" && (
                        <div className="grid gap-3 md:grid-cols-2">
                            {timbreIndex.map((t) => {
                                const checked = selectedTimbreIds.includes(t.id);
                                return (
                                    <label
                                        key={t.id}
                                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-ore-border bg-ore-raised p-3.5"
                                    >
                                        <input
                                            type="checkbox"
                                            disabled={t.required}
                                            checked={checked}
                                            onChange={() => toggleTimbre(t.id)}
                                            className="mt-1 h-4 w-4 accent-[var(--pb-primary)]"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 text-[13.5px] font-medium">
                                                <span>{t.label}</span>
                                                <SongBadge>
                                                    {t.bundled ? "内置必选" : formatBytesMB(t.size)}
                                                </SongBadge>
                                            </div>
                                            <p className="mt-1 text-[12px] text-ore-dim">{t.description}</p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    )}

                    {localTab === "scores" && (
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

                            {scores.length === 0 ? (
                                <EmptyState
                                    icon={<Package size={24} />}
                                    title="暂无曲谱"
                                    description="可将 PDF 或曲谱图片批量导入随附加包一并打包进游戏谱架。"
                                />
                            ) : (
                                <div className="grid gap-2.5 sm:grid-cols-2">
                                    {scores.map((score) => (
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
                                                        onClick={() => removeScore(score.id)}
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
                    )}
                </>
            ) : (
                <>
                    <Segmented
                        value={serverTab}
                        onChange={(v) => setServerTab(v as typeof serverTab)}
                        options={[
                            { value: "deploy", label: "BDS 部署与校验" },
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
                                                {deploymentStatus.status === "active" && "BDS 资源已同步并生效"}
                                                {deploymentStatus.status === "pending_deploy" &&
                                                    "配置或插件已变更，待重新部署到 BDS"}
                                                {deploymentStatus.status === "pending_restart" &&
                                                    "已写入 BDS 磁盘，等待重启 BDS 服务器加载"}
                                                {deploymentStatus.status === "unavailable" &&
                                                    "尚未完成首次部署或未检测到有效模板"}
                                            </div>
                                            <div className="mt-1 text-[11.5px] text-ore-dim">
                                                目标哈希：<code>{deploymentStatus.configHash}</code> · 已部署：
                                                <code>{deploymentStatus.deployedHash ?? "-"}</code> · 运行中上报：
                                                <code>{deploymentStatus.loadedHash ?? "-"}</code>
                                            </div>
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
                                                        message: err instanceof Error ? err.message : String(err),
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
                                                        message: err instanceof Error ? err.message : String(err),
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
                                    placeholder="pianobe_bp"
                                    value={bdsBpName}
                                    onInput={(e) => {
                                        const t = e.target as unknown as { value?: unknown };
                                        if (typeof t?.value === "string") setBdsBpName(t.value);
                                    }}
                                />
                                <Textfield
                                    label="资源包目录名"
                                    placeholder="pianobe_rp"
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
                                                                err instanceof Error ? err.message : String(err),
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
                                                        setCreatedToken({ label: res.label, token: res.token });
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
                                                <code className="mt-1 block break-all">{createdToken.token}</code>
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
