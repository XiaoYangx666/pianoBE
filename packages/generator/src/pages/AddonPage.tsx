import { useCallback, useMemo, useRef, useState } from "react";
import { Button, TabBar, TabButton, Textarea, Textfield } from "@piano/ui";
import {
    CheckCircle2,
    Eye,
    FileArchive,
    FileImage,
    Info,
    Music2,
    Play,
    RefreshCw,
    Trash2,
    Upload,
} from "lucide-react";
import {
    Dialog,
    EmptyState,
    FileDropzone,
    ImportCodeDialog,
    PageHeader,
    SongBadge,
    SongRow,
    VirtualSongList,
    type RowPlayState,
    usePlayingSongId,
} from "@piano/ui";
import { MAX_TITLE_CHARS } from "../scores";
import type { ScoreEntry } from "../scores";
import type { SongEntry } from "../types";
import { previewPlayer } from "../player";
import { bytesToMB, useGenerator } from "../store/generator";
import { ScoreThumb } from "../components/ScoreThumb";
import { ScorePreviewModal } from "../components/ScorePreviewModal";
import { useMediaQuery } from "../hooks/useMediaQuery";

const ROW_HEIGHT = 60;
const SCORE_ROW_HEIGHT = 92;

function formatDuration(scaled: number): string {
    const seconds = Math.max(0, Math.floor(scaled / 40));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface TitleRequest {
    defaultTitle: string;
    hint: string;
    resolve: (value: string | null) => void;
}

export function AddonPage() {
    const isMobile = useMediaQuery("(max-width: 47.99em)");
    const template = useGenerator((state) => state.template);
    const templateVersion = useGenerator((state) => state.templateVersion);
    const songs = useGenerator((state) => state.songs);
    const scores = useGenerator((state) => state.scores);
    const timbres = useGenerator((state) => state.timbres);
    const selectedTimbres = useGenerator((state) => state.selectedTimbres);
    const previewTimbreId = useGenerator((state) => state.previewTimbreId);
    const pendingPreviewId = useGenerator((state) => state.pendingPreviewId);
    const addonName = useGenerator((state) => state.addonName);
    const addonDesc = useGenerator((state) => state.addonDesc);
    const randomUuid = useGenerator((state) => state.randomUuid);
    const exporting = useGenerator((state) => state.exporting);
    const addMidiFiles = useGenerator((state) => state.addMidiFiles);
    const togglePreview = useGenerator((state) => state.togglePreview);
    const removeSong = useGenerator((state) => state.removeSong);
    const clearSongs = useGenerator((state) => state.clearSongs);
    const toggleTimbre = useGenerator((state) => state.toggleTimbre);
    const setPreviewTimbre = useGenerator((state) => state.setPreviewTimbre);
    const selectedTimbreSize = useGenerator((state) => state.selectedTimbreSize);
    const setAddonName = useGenerator((state) => state.setAddonName);
    const setAddonDesc = useGenerator((state) => state.setAddonDesc);
    const setRandomUuid = useGenerator((state) => state.setRandomUuid);
    const applyTemplate = useGenerator((state) => state.applyTemplate);
    const importScorePackFiles = useGenerator((state) => state.importScorePackFiles);
    const importScorePageFiles = useGenerator((state) => state.importScorePageFiles);
    const removeScore = useGenerator((state) => state.removeScore);
    const exportAddon = useGenerator((state) => state.exportAddon);
    const scoreChunks = useGenerator((state) => state.scoreChunks);

    const [tab, setTab] = useState<"tracks" | "timbres" | "scores" | "settings">("tracks");
    const [code, setCode] = useState<{ name: string; chunks: string[] } | null>(null);
    const [previewScore, setPreviewScore] = useState<ScoreEntry | null>(null);
    const [titleRequest, setTitleRequest] = useState<TitleRequest | null>(null);
    const [titleValue, setTitleValue] = useState("");
    const [titleError, setTitleError] = useState("");

    const midiRef = useRef<HTMLInputElement>(null);
    const templateRef = useRef<HTMLInputElement>(null);
    const scorePackRef = useRef<HTMLInputElement>(null);
    const scorePagesRef = useRef<HTMLInputElement>(null);

    const activeId = usePlayingSongId(previewPlayer);
    const extraTimbreBytes = selectedTimbreSize();

    const requestTitle = (defaultTitle: string, hint: string) =>
        new Promise<string | null>((resolve) => {
            setTitleValue(defaultTitle);
            setTitleError("");
            setTitleRequest({ defaultTitle, hint, resolve });
        });

    const closeTitlePrompt = (value: string | null) => {
        titleRequest?.resolve(value);
        setTitleRequest(null);
    };

    const confirmTitle = () => {
        const value = titleValue.trim();
        if (!value) {
            setTitleError("曲谱标题不能为空");
            return;
        }
        if (Array.from(value).length > MAX_TITLE_CHARS) {
            setTitleError(`曲谱标题最多 ${MAX_TITLE_CHARS} 个字符`);
            return;
        }
        closeTitlePrompt(value);
    };

    const rowState = useCallback(
        (id: string): RowPlayState =>
            pendingPreviewId === id ? "pending" : activeId === id ? "playing" : "idle",
        [activeId, pendingPreviewId]
    );

    const openCode = useCallback(
        (entry: SongEntry) => {
            const chunks = scoreChunks(entry);
            if (chunks.length === 0) return;
            setCode({ name: entry.name, chunks });
        },
        [scoreChunks]
    );

    const playDisabled = !template;
    const rowHeight = isMobile ? 56 : ROW_HEIGHT;

    const renderTrackRow = useCallback(
        (song: SongEntry, index: number) => (
            <SongRow
                index={index + 1}
                title={song.name}
                id={song.id}
                meta={[
                    <span key="dur">{formatDuration(song.duration)}</span>,
                    <span key="notes">{(song.noteCount ?? 0).toLocaleString()} 音符</span>,
                ]}
                badges={
                    song.isOriginal ? (
                        <SongBadge>模板</SongBadge>
                    ) : song.fromLibrary ? (
                        <SongBadge tone="brand">曲库</SongBadge>
                    ) : (
                        <SongBadge tone="success">新导入</SongBadge>
                    )
                }
                active={activeId === song.id}
                playState={rowState(song.id)}
                onPlay={() => void togglePreview(song)}
                playDisabled={playDisabled}
                onOpenCode={() => openCode(song)}
                onRemove={() => removeSong(song.id)}
                removeLabel="从制作清单移除"
            />
        ),
        [activeId, openCode, playDisabled, removeSong, rowState, togglePreview]
    );

    const renderScoreRow = useCallback(
        (score: ScoreEntry, index: number) => {
            const pageCount = score.pageCount ?? score.pages.length;
            return (
                <div className="flex h-full items-center gap-3 rounded-lg border border-ore-border bg-[var(--pb-soft)] px-3">
                    <ScoreThumb score={score} template={template} />
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-semibold">{score.title}</span>
                            <SongBadge>{pageCount} 页</SongBadge>
                            <SongBadge tone={score.source === "template" ? "warning" : "brand"}>
                                {score.source === "template" ? "模板" : "自定义"}
                            </SongBadge>
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-ore-dim">{score.id}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            aria-label="预览曲谱"
                            title="预览曲谱"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={() => setPreviewScore(score)}
                        >
                            <Eye size={16} />
                        </button>
                        <button
                            type="button"
                            aria-label="移除曲谱"
                            title="移除曲谱"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
                            onClick={() => removeScore(index)}
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            );
        },
        [removeScore, template]
    );

    const summary = useMemo(
        () => [
            { label: "曲目", value: `${songs.length} 首` },
            { label: "音色", value: `${selectedTimbres.length} 套` },
            { label: "曲谱", value: `${scores.length} 张` },
            { label: "模板版本", value: templateVersion },
            {
                label: "附加音色",
                value: extraTimbreBytes > 0 ? `约 ${bytesToMB(extraTimbreBytes)}` : "仅内置",
            },
        ],
        [songs.length, selectedTimbres.length, scores.length, templateVersion, extraTimbreBytes]
    );

    const panel = "rounded-xl border border-ore-border bg-ore-raised";

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                eyebrow="Addon Studio"
                title="附加包制作"
                description="整理曲目、选择钢琴音色、管理游戏内曲谱，并导出可直接安装的 .mcaddon。所有操作都基于当前底包模板。"
                actions={
                    <Button type="button" loading={exporting} disabled={!template || exporting} onClick={() => void exportAddon()}>
                        <CheckCircle2 size={15} /> 导出附加包
                    </Button>
                }
            />

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_276px]">
                <div className={`${panel} overflow-hidden`}>
                    <div className="border-b border-ore-divider px-3 py-2">
                        <TabBar>
                            <TabButton type="button" selected={tab === "tracks"} onClick={() => setTab("tracks")}>
                                曲目 <span className="text-[11px] text-ore-dim">({songs.length})</span>
                            </TabButton>
                            <TabButton type="button" selected={tab === "timbres"} onClick={() => setTab("timbres")}>
                                音色 <span className="text-[11px] text-ore-dim">({selectedTimbres.length})</span>
                            </TabButton>
                            <TabButton type="button" selected={tab === "scores"} onClick={() => setTab("scores")}>
                                曲谱 <span className="text-[11px] text-ore-dim">({scores.length})</span>
                            </TabButton>
                            <TabButton type="button" selected={tab === "settings"} onClick={() => setTab("settings")}>
                                设置
                            </TabButton>
                        </TabBar>
                    </div>

                    <div className="p-3 sm:p-4">
                        {tab === "tracks" && (
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold">制作清单</div>
                                        <p className="mt-0.5 text-xs text-ore-dim">
                                            模板自带的曲目会自动出现；删除后可在设置中重新加载模板恢复。
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5">
                                        <input
                                            ref={midiRef}
                                            type="file"
                                            accept=".mid,.midi"
                                            multiple
                                            hidden
                                            onChange={(event) => {
                                                const files = Array.from(event.target.files ?? []);
                                                event.target.value = "";
                                                if (files.length > 0) void addMidiFiles(files);
                                            }}
                                        />
                                        <Button type="button" color="secondary" size="sm" onClick={() => midiRef.current?.click()}>
                                            <Upload size={13} /> 导入 MIDI
                                        </Button>
                                        {songs.length > 0 && (
                                            <Button
                                                type="button"
                                                color="destructive"
                                                size="sm"
                                                onClick={() => {
                                                    if (window.confirm("确定清空当前曲目列表？")) clearSongs();
                                                }}
                                            >
                                                清空
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <FileDropzone
                                    compact
                                    accept={[".mid", ".midi"]}
                                    title="拖入 MIDI 文件"
                                    description="批量导入后会自动去重，并转换为游戏内 PBE2 数据"
                                    icon={<Music2 size={16} />}
                                    onDrop={(files) => void addMidiFiles(files)}
                                />

                                {songs.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={<Music2 size={20} />}
                                        title="还没有曲目"
                                        description="导入 MIDI，或到音乐库从在线曲库添加"
                                    />
                                ) : (
                                    <VirtualSongList
                                        className="h-[clamp(300px,calc(100dvh-500px),720px)] rounded-lg border border-ore-divider p-1"
                                        items={songs}
                                        rowHeight={rowHeight}
                                        getKey={(song) => song.id}
                                        renderItem={renderTrackRow}
                                    />
                                )}
                            </div>
                        )}

                        {tab === "timbres" && (
                            <div className="flex flex-col gap-3">
                                <div className="flex items-start gap-2 rounded-lg border border-ore-border bg-[var(--pb-soft)] px-3 py-2.5">
                                    <Info size={16} className="mt-0.5 shrink-0 text-ore-dim" />
                                    <div className="text-xs leading-relaxed text-ore-dim">
                                        <div className="mb-0.5 text-[13px] font-semibold text-ore-text">试听与打包相互独立</div>
                                        试听任意音色不会改变勾选状态。只有勾选的音色才会写入导出包；经典 P-88 始终内置。
                                    </div>
                                </div>

                                {timbres.length === 0 ? (
                                    <EmptyState compact title="音色清单加载中…" />
                                ) : (
                                    <div className="flex flex-col gap-1">
                                        {timbres.map((timbre) => {
                                            const selected = selectedTimbres.includes(timbre.id);
                                            const canPreview = timbre.bundled || Boolean(timbre.file);
                                            return (
                                                <div
                                                    key={timbre.id}
                                                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                                                        selected
                                                            ? "border-brand/45 bg-brand/10"
                                                            : "border-transparent hover:bg-[var(--pb-hover)]"
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 accent-[var(--pb-primary)]"
                                                        checked={selected}
                                                        disabled={timbre.required || !canPreview}
                                                        onChange={(event) => toggleTimbre(timbre.id, event.currentTarget.checked)}
                                                        aria-label={`选择音色 ${timbre.label}`}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2 text-sm font-medium">
                                                            {timbre.label}
                                                            {timbre.bundled && <SongBadge>内置</SongBadge>}
                                                            {timbre.required && <SongBadge tone="brand">必选</SongBadge>}
                                                            {previewTimbreId === timbre.id && <SongBadge tone="success">试听中</SongBadge>}
                                                        </div>
                                                        <div className="mt-0.5 text-xs text-ore-dim">{timbre.description}</div>
                                                    </div>
                                                    <span className="shrink-0 text-[11px] tabular-nums text-ore-dim">
                                                        {timbre.bundled ? "内置" : timbre.file ? bytesToMB(timbre.size) : "缺失"}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        aria-label="试听音色"
                                                        title={canPreview ? "试听此音色" : "音色包缺失"}
                                                        disabled={!canPreview || !template}
                                                        onClick={() => void setPreviewTimbre(timbre.id)}
                                                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-40 ${
                                                            previewTimbreId === timbre.id
                                                                ? "bg-brand/20 text-[color:var(--pb-primary-light)]"
                                                                : "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                                        }`}
                                                    >
                                                        <Play size={15} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === "scores" && (
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold">游戏内曲谱</div>
                                        <p className="mt-0.5 text-xs text-ore-dim">
                                            图片按选择顺序合并为一张曲谱，每个 PDF 各自一张；面板保留全部页面，谱架只展示前 4 页。
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5">
                                        <input
                                            ref={scorePagesRef}
                                            type="file"
                                            accept=".png,.jpg,.jpeg,.webp,.pdf"
                                            multiple
                                            hidden
                                            onChange={(event) => {
                                                const files = Array.from(event.target.files ?? []);
                                                event.target.value = "";
                                                if (files.length > 0) void importScorePageFiles(files, requestTitle);
                                            }}
                                        />
                                        <input
                                            ref={scorePackRef}
                                            type="file"
                                            accept=".zip"
                                            multiple
                                            hidden
                                            onChange={(event) => {
                                                const files = Array.from(event.target.files ?? []);
                                                event.target.value = "";
                                                if (files.length > 0) void importScorePackFiles(files);
                                            }}
                                        />
                                        <Button type="button" color="secondary" size="sm" onClick={() => scorePagesRef.current?.click()}>
                                            <FileImage size={13} /> 图片 / PDF
                                        </Button>
                                        <Button type="button" color="secondary" size="sm" onClick={() => scorePackRef.current?.click()}>
                                            <FileArchive size={13} /> 曲谱包
                                        </Button>
                                    </div>
                                </div>

                                {scores.length === 0 ? (
                                    <EmptyState
                                        compact
                                        icon={<FileImage size={20} />}
                                        title="当前没有曲谱"
                                        description="模板未包含曲谱，可导入图片、PDF 或曲谱包"
                                    />
                                ) : (
                                    <VirtualSongList
                                        className="h-[clamp(300px,calc(100dvh-500px),720px)] rounded-lg border border-ore-divider p-1"
                                        items={scores}
                                        rowHeight={SCORE_ROW_HEIGHT}
                                        gap={6}
                                        getKey={(score, index) => `${score.id}-${index}`}
                                        renderItem={renderScoreRow}
                                    />
                                )}
                            </div>
                        )}

                        {tab === "settings" && (
                            <div className="flex max-w-[620px] flex-col gap-5">
                                <div className="flex flex-col gap-2.5">
                                    <div className="text-sm font-semibold">附加包信息</div>
                                    <Textfield
                                        label="Pack Name"
                                        placeholder="钢琴附加包"
                                        value={addonName}
                                        onInput={(event) => {
                                            const target = event.target as unknown as { value?: unknown };
                                            if (typeof target?.value === "string") setAddonName(target.value);
                                        }}
                                    />
                                    <Textarea
                                        label="Description"
                                        placeholder="Powered by PianoBE"
                                        value={addonDesc}
                                        onInput={(event) => {
                                            const target = event.target as unknown as { value?: unknown };
                                            if (typeof target?.value === "string") setAddonDesc(target.value);
                                        }}
                                    />
                                    <label className="flex items-start gap-2.5 rounded-lg border border-ore-border bg-[var(--pb-soft)] px-3 py-2.5">
                                        <input
                                            type="checkbox"
                                            className="mt-0.5 h-4 w-4 accent-[var(--pb-primary)]"
                                            checked={randomUuid}
                                            onChange={(event) => setRandomUuid(event.currentTarget.checked)}
                                        />
                                        <span>
                                            <span className="block text-[13px] font-medium">随机化 UUID</span>
                                            <span className="mt-0.5 block text-xs text-ore-dim">
                                                每次导出使用新的包 UUID，避免覆盖已安装的旧版本
                                            </span>
                                        </span>
                                    </label>
                                </div>

                                <div className="h-px bg-ore-divider" />

                                <div className="flex flex-col gap-2.5">
                                    <div className="text-sm font-semibold">模板底包</div>
                                    <div className="rounded-lg border border-ore-border p-3">
                                        {[
                                            ["底包版本", templateVersion],
                                            ["模板曲目", `${template?.songs.length ?? 0} 首`],
                                            ["模板曲谱", `${template?.scores.length ?? 0} 张`],
                                        ].map(([label, value]) => (
                                            <div key={label} className="flex items-center justify-between py-0.5 text-xs">
                                                <span className="text-ore-dim">{label}</span>
                                                <b>{value}</b>
                                            </div>
                                        ))}
                                        <div className="mt-2 text-xs text-ore-dim">
                                            {template?.bpManifest.header?.description ?? "尚未加载模板"}
                                        </div>
                                    </div>
                                    <input
                                        ref={templateRef}
                                        type="file"
                                        accept=".mcaddon,.zip"
                                        hidden
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = "";
                                            if (file) void applyTemplate(file);
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm" className="w-fit"
                                        onClick={() => templateRef.current?.click()}
                                    >
                                        <RefreshCw size={13} /> 更换底包模板
                                    </Button>
                                </div>

                                <div className="h-px bg-ore-divider" />

                                <Button type="button" className="w-fit" loading={exporting} disabled={!template || exporting} onClick={() => void exportAddon()}>
                                    <CheckCircle2 size={15} /> 导出 .mcaddon
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                <aside className="flex flex-col gap-4 xl:sticky xl:top-[72px]">
                    <div className={`${panel} p-4`}>
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold">制作摘要</span>
                            <SongBadge tone="brand">PianoBE</SongBadge>
                        </div>
                        {summary.map((row) => (
                            <div key={row.label} className="flex items-center justify-between py-0.5 text-xs">
                                <span className="text-ore-dim">{row.label}</span>
                                <b>{row.value}</b>
                            </div>
                        ))}
                        <Button
                            type="button"
                            className="mt-3 w-full"
                            loading={exporting}
                            disabled={!template || exporting}
                            onClick={() => void exportAddon()}
                        >
                            导出附加包
                        </Button>
                        <p className="mt-2 text-center text-[11px] text-ore-dim">导出为 .mcaddon，可直接导入 Minecraft</p>
                    </div>

                    <div className={`${panel} p-4`}>
                        <div className="mb-2 text-sm font-semibold">导出前检查</div>
                        <div className="flex flex-col gap-1.5">
                            <CheckItem ok={Boolean(template)} label="底包模板已加载" />
                            <CheckItem ok={songs.length > 0} label="至少包含一首曲目" />
                            <CheckItem ok={selectedTimbres.length > 0} label="至少选择一套音色" />
                            <CheckItem ok={scores.length > 0} label="曲谱（可选）" optional />
                        </div>
                    </div>
                </aside>
            </div>

            <ScorePreviewModal
                score={previewScore}
                template={template}
                opened={Boolean(previewScore)}
                onClose={() => setPreviewScore(null)}
            />

            <ImportCodeDialog
                opened={Boolean(code)}
                onClose={() => setCode(null)}
                songName={code?.name ?? ""}
                chunks={code?.chunks ?? []}
            />

            <Dialog
                opened={Boolean(titleRequest)}
                onClose={() => closeTitlePrompt(null)}
                title="确认曲谱标题"
                size="sm"
                closeOnClickOutside={false}
                footer={
                    <>
                        <Button type="button" color="secondary" size="sm" onClick={() => closeTitlePrompt(null)}>
                            跳过
                        </Button>
                        <Button type="button" size="sm" onClick={confirmTitle}>
                            确定
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-2">
                    <Textfield
                        label={`标题（最多 ${MAX_TITLE_CHARS} 个字符）`}
                        value={titleValue}
                        error={titleError || ""}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") {
                                setTitleValue(target.value);
                                setTitleError("");
                            }
                        }}
                        onKeyDown={(event: React.KeyboardEvent) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                confirmTitle();
                            }
                        }}
                    />
                    <p className="text-xs text-ore-dim">{titleRequest?.hint}</p>
                </div>
            </Dialog>
        </div>
    );
}

function CheckItem({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
    return (
        <div className="flex items-center gap-2 text-xs">
            <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
                    ok ? "bg-emerald-500" : optional ? "bg-[var(--pb-track)]" : "bg-amber-500"
                }`}
            >
                {ok ? "✓" : optional ? "–" : "!"}
            </span>
            <span className={ok || optional ? "text-ore-dim" : "text-amber-700 dark:text-amber-300"}>{label}</span>
        </div>
    );
}
