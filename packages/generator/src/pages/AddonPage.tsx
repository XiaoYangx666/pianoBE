import { useCallback, useMemo, useRef, useState } from "react";
import { Button, TabBar, TabButton, Textarea, Textfield } from "@piano/ui";
import {
    Check,
    Download,
    Eye,
    FileArchive,
    FileImage,
    Info,
    ListPlus,
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
    PianoKeys,
    SongBadge,
    SongRow,
    VirtualSongList,
    notifications,
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

const ROW_HEIGHT = 50;
const SCORE_ROW_HEIGHT = 84;

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
    const myMusic = useGenerator((state) => state.myMusic);
    const scores = useGenerator((state) => state.scores);
    const timbres = useGenerator((state) => state.timbres);
    const selectedTimbres = useGenerator((state) => state.selectedTimbres);
    const previewTimbreId = useGenerator((state) => state.previewTimbreId);
    const pendingPreviewId = useGenerator((state) => state.pendingPreviewId);
    const addonName = useGenerator((state) => state.addonName);
    const addonDesc = useGenerator((state) => state.addonDesc);
    const randomUuid = useGenerator((state) => state.randomUuid);
    const addMidiFiles = useGenerator((state) => state.addMidiFiles);
    const addToAddon = useGenerator((state) => state.addToAddon);
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
    const exporting = useGenerator((state) => state.exporting);
    const exportAddon = useGenerator((state) => state.exportAddon);
    const importScorePackFiles = useGenerator((state) => state.importScorePackFiles);
    const importScorePageFiles = useGenerator((state) => state.importScorePageFiles);
    const removeScore = useGenerator((state) => state.removeScore);
    const scoreChunks = useGenerator((state) => state.scoreChunks);

    const [tab, setTab] = useState<"tracks" | "timbres" | "scores" | "export">("tracks");
    const [code, setCode] = useState<{ name: string; chunks: string[] } | null>(null);
    const [previewScore, setPreviewScore] = useState<ScoreEntry | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [dragActive, setDragActive] = useState(false);
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
    const rowHeight = isMobile ? 54 : ROW_HEIGHT;

    const renderTrackRow = useCallback(
        (song: SongEntry, index: number) => (
            <SongRow
                index={index + 1}
                title={song.name}
                duration={formatDuration(song.duration)}
                meta={[<span key="notes">{(song.noteCount ?? 0).toLocaleString()} 音符</span>]}
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
                <div className="group flex h-full items-center gap-3 border-b border-ore-divider/70 px-3 transition-colors hover:bg-[var(--pb-hover)]">
                    <ScoreThumb score={score} template={template} />
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[13px] font-medium">{score.title}</span>
                            <SongBadge>{pageCount} 页</SongBadge>
                            <SongBadge tone={score.source === "template" ? "warning" : "brand"}>
                                {score.source === "template" ? "模板" : "自定义"}
                            </SongBadge>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-ore-dimmer">{score.id}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <button
                            type="button"
                            aria-label="预览曲谱"
                            title="预览曲谱"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                            onClick={() => setPreviewScore(score)}
                        >
                            <Eye size={15} />
                        </button>
                        <button
                            type="button"
                            aria-label="移除曲谱"
                            title="移除曲谱"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                            onClick={() => removeScore(index)}
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                </div>
            );
        },
        [removeScore, template]
    );

    const addonIds = useMemo(() => new Set(songs.map((song) => song.id)), [songs]);
    const pickerItems = useMemo(() => {
        const keyword = pickerQuery.trim().toLowerCase();
        return myMusic.filter(
            (song) =>
                !addonIds.has(song.id) &&
                (!keyword || song.name.toLowerCase().includes(keyword) || song.id === keyword)
        );
    }, [addonIds, myMusic, pickerQuery]);

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

    const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dimmer";

    return (
        <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 pt-4 md:px-0 md:pt-0">
            <div className="hidden md:block">
                <PageHeader
                    title="附加包制作"
                    description="整理曲目、音色与曲谱，导出可直接安装的 .mcaddon。"
                />
            </div>

            <div className="border-b border-ore-divider md:mt-5">
                <TabBar className="gap-5 md:gap-6">
                    <TabButton type="button" selected={tab === "tracks"} onClick={() => setTab("tracks")}>
                        曲目 <span className="text-[10.5px] tabular-nums text-ore-dimmer">{songs.length}</span>
                    </TabButton>
                    <TabButton type="button" selected={tab === "timbres"} onClick={() => setTab("timbres")}>
                        音色 <span className="text-[10.5px] tabular-nums text-ore-dimmer">{selectedTimbres.length}</span>
                    </TabButton>
                    <TabButton type="button" selected={tab === "scores"} onClick={() => setTab("scores")}>
                        曲谱 <span className="text-[10.5px] tabular-nums text-ore-dimmer">{scores.length}</span>
                    </TabButton>
                    <TabButton type="button" selected={tab === "export"} onClick={() => setTab("export")}>
                        导出
                    </TabButton>
                </TabBar>
            </div>

            <div className="mt-4 pb-2 md:mt-5">
                {tab === "tracks" && (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[13px] font-semibold">制作清单</span>
                                    <button
                                        type="button"
                                        aria-label="制作清单说明"
                                        title="删除曲目后，可在「导出」里重新加载模板恢复"
                                        className="grid h-6 w-6 place-items-center rounded-md text-ore-dimmer transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                                        onClick={() =>
                                            notifications.show({
                                                title: "制作清单",
                                                message: "模板自带的曲目会自动出现。删除后可在「导出」里重新加载模板恢复。",
                                                color: "gray",
                                            })
                                        }
                                    >
                                        <Info size={13} />
                                    </button>
                                </div>
                                <p className="mt-0.5 text-[11px] text-ore-dim">模板曲目会自动出现</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <input
                                    ref={midiRef}
                                    type="file"
                                    accept=".mid,.midi"
                                    multiple
                                    hidden
                                    onChange={(event) => {
                                        const files = Array.from(event.target.files ?? []);
                                        event.target.value = "";
                                        if (files.length > 0) void addMidiFiles(files, { addToAddon: true });
                                    }}
                                />
                                {songs.length > 0 && (
                                    <>
                                        <Button
                                            type="button"
                                            color="ghost"
                                            size="sm"
                                            className="hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                                            onClick={() => {
                                                if (window.confirm("确定清空当前曲目列表？")) clearSongs();
                                            }}
                                        >
                                            清空
                                        </Button>
                                        <Button
                                            type="button"
                                            color="secondary"
                                            size="sm"
                                            onClick={() => setPickerOpen(true)}
                                        >
                                            <ListPlus size={13} /> 从我的音乐添加
                                        </Button>
                                        <Button type="button" size="sm" onClick={() => midiRef.current?.click()}>
                                            <Upload size={13} /> 导入 MIDI
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>

                        {songs.length === 0 ? (
                            <>
                            <div
                                className={[
                                    "mt-1 max-w-[560px] rounded-lg border p-5 transition-colors",
                                    dragActive
                                        ? "border-brand bg-[var(--pb-brand-tint)]"
                                        : "border-ore-border bg-ore-raised",
                                ].join(" ")}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setDragActive(true);
                                }}
                                onDragLeave={() => setDragActive(false)}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    setDragActive(false);
                                    const files = Array.from(event.dataTransfer.files).filter((file) =>
                                        /\.(mid|midi)$/i.test(file.name)
                                    );
                                    if (files.length > 0) void addMidiFiles(files, { addToAddon: true });
                                }}
                            >
                                <div className="flex items-start gap-3.5">
                                    <PianoKeys playing className="h-10 w-12 p-1.5" />
                                    <div className="min-w-0">
                                        <span className="inline-flex items-center gap-1.5 rounded-[4px] pb-tint-brand px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.12em]">
                                            开始制作
                                        </span>
                                        <div className="mt-1.5 text-[14.5px] font-semibold">从第一首曲子开始</div>
                                        <p className="mt-1 max-w-[380px] text-[11.5px] leading-relaxed text-ore-dim">
                                            导入 MIDI 会先存入「我的音乐」，再加入当前附加包。
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Button type="button" size="sm" onClick={() => midiRef.current?.click()}>
                                        <Upload size={13} /> 导入 MIDI
                                    </Button>
                                    <Button
                                        type="button"
                                        color="secondary"
                                        size="sm"
                                        onClick={() => setPickerOpen(true)}
                                    >
                                        <ListPlus size={13} /> 从我的音乐添加
                                    </Button>
                                </div>
                                <div className="mt-3 text-[10.5px] text-ore-dimmer">
                                    也可以把 .mid / .midi 文件拖到这里
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ore-dimmer">
                                <span className="text-ore-dim">接下来</span>
                                <span>选择音色</span>
                                <span aria-hidden="true">→</span>
                                <span>添加曲谱</span>
                                <span aria-hidden="true">→</span>
                                <span>导出 .mcaddon</span>
                            </div>
                            </>
                        ) : (
                            <>
                                <FileDropzone
                                    compact
                                    className="max-w-[520px]"
                                    accept={[".mid", ".midi"]}
                                    title="拖入 MIDI 文件"
                                    description="转换后存入「我的音乐」，并同时加入当前附加包"
                                    icon={<Music2 size={16} />}
                                    onDrop={(files) => void addMidiFiles(files, { addToAddon: true })}
                                />
                                <VirtualSongList
                                    className="h-[clamp(280px,calc(100dvh-360px),720px)] -mx-1 px-1"
                                    items={songs}
                                    rowHeight={rowHeight}
                                    gap={0}
                                    getKey={(song) => song.id}
                                    renderItem={renderTrackRow}
                                />
                            </>
                        )}
                    </div>
                )}

                {tab === "timbres" && (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <div className="text-[13px] font-semibold">音色包</div>
                                <p className="mt-0.5 max-w-[620px] text-[11.5px] leading-relaxed text-ore-dim">
                                    试听不会改变勾选；只有勾选的音色会写入导出包，标准钢琴始终内置。
                                </p>
                            </div>
                            <span className="text-[11px] tabular-nums text-ore-dimmer">
                                已选 {selectedTimbres.length} 套
                            </span>
                        </div>

                        {timbres.length === 0 ? (
                            <EmptyState compact title="音色清单加载中…" />
                        ) : (
                            <div className="flex flex-col border-t border-ore-divider">
                                {timbres.map((timbre) => {
                                    const selected = selectedTimbres.includes(timbre.id);
                                    const canPreview = timbre.bundled || Boolean(timbre.file);
                                    return (
                                        <div
                                            key={timbre.id}
                                            className={[
                                                "group relative flex items-center gap-3 border-b border-ore-divider/80 px-1 py-2.5 transition-colors",
                                                selected
                                                    ? "bg-[var(--pb-active)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:rounded-r before:bg-brand before:content-['']"
                                                    : "hover:bg-[var(--pb-hover)]",
                                            ].join(" ")}
                                        >
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 shrink-0 accent-[var(--pb-primary)]"
                                                checked={selected}
                                                disabled={timbre.required || !canPreview}
                                                onChange={(event) => toggleTimbre(timbre.id, event.currentTarget.checked)}
                                                aria-label={`选择音色 ${timbre.label}`}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                                                    {timbre.label}
                                                    {timbre.bundled && <SongBadge>内置</SongBadge>}
                                                    {timbre.required && <SongBadge tone="brand">必选</SongBadge>}
                                                    {previewTimbreId === timbre.id && <SongBadge tone="success">试听中</SongBadge>}
                                                </div>
                                                <div className="mt-0.5 text-[11.5px] text-ore-dim">{timbre.description}</div>
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
                                                className={[
                                                    "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40",
                                                    previewTimbreId === timbre.id
                                                        ? "bg-brand text-white"
                                                        : "text-ore-dim hover:bg-[var(--pb-hover)] hover:text-ore-text",
                                                ].join(" ")}
                                            >
                                                <Play size={14} />
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
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <div className="text-[13px] font-semibold">游戏内曲谱</div>
                                <p className="mt-0.5 max-w-[640px] text-[11.5px] leading-relaxed text-ore-dim">
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
                                icon={<FileImage size={22} />}
                                title="当前没有曲谱"
                                description="模板未包含曲谱，可导入图片、PDF 或曲谱包"
                            />
                        ) : (
                            <VirtualSongList
                                className="h-[clamp(280px,calc(100dvh-360px),720px)] -mx-1 border-t border-ore-divider px-1"
                                items={scores}
                                rowHeight={SCORE_ROW_HEIGHT}
                                gap={0}
                                getKey={(score, index) => `${score.id}-${index}`}
                                renderItem={renderScoreRow}
                            />
                        )}
                    </div>
                )}

                {tab === "export" && (
                    <div className="grid max-w-[1040px] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] lg:gap-12">
                        <div className="flex flex-col gap-7">
                            <section className="flex flex-col gap-3">
                                <h3 className={sectionLabel}>附加包信息</h3>
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
                                    rows={3}
                                    value={addonDesc}
                                    onInput={(event) => {
                                        const target = event.target as unknown as { value?: unknown };
                                        if (typeof target?.value === "string") setAddonDesc(target.value);
                                    }}
                                />
                                <label className="flex items-start gap-2.5 py-0.5">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 accent-[var(--pb-primary)]"
                                        checked={randomUuid}
                                        onChange={(event) => setRandomUuid(event.currentTarget.checked)}
                                    />
                                    <span>
                                        <span className="block text-[12.5px] font-medium">随机化 UUID</span>
                                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ore-dim">
                                            每次导出使用新的包 UUID，避免覆盖已安装的旧版本
                                        </span>
                                    </span>
                                </label>
                            </section>

                            <section className="flex flex-col gap-3 border-t border-ore-divider pt-6">
                                <h3 className={sectionLabel}>模板底包</h3>
                                <div className="flex flex-col">
                                    {[
                                        ["底包版本", templateVersion],
                                        ["模板曲目", `${template?.songs.length ?? 0} 首`],
                                        ["模板曲谱", `${template?.scores.length ?? 0} 张`],
                                    ].map(([label, value]) => (
                                        <div
                                            key={label}
                                            className="flex items-center justify-between border-b border-ore-divider/70 py-2 text-[12px] last:border-b-0"
                                        >
                                            <span className="text-ore-dim">{label}</span>
                                            <b className="font-medium">{value}</b>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[11.5px] leading-relaxed text-ore-dim">
                                    {template?.bpManifest.header?.description ?? "尚未加载模板"}
                                </p>
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
                                    size="sm"
                                    className="w-fit"
                                    onClick={() => templateRef.current?.click()}
                                >
                                    <RefreshCw size={13} /> 更换底包模板
                                </Button>
                            </section>
                        </div>

                        <aside className="flex flex-col gap-6 lg:border-l lg:border-ore-divider lg:pl-8">
                            <section className="flex flex-col gap-2">
                                <h3 className={sectionLabel}>制作摘要</h3>
                                <div className="flex flex-col">
                                    {summary.map((row) => (
                                        <div
                                            key={row.label}
                                            className="flex items-center justify-between border-b border-ore-divider/70 py-2 text-[12px] last:border-b-0"
                                        >
                                            <span className="text-ore-dim">{row.label}</span>
                                            <b className="font-medium">{row.value}</b>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className="flex flex-col gap-2.5">
                                <h3 className={sectionLabel}>导出前检查</h3>
                                <div className="flex flex-col gap-2">
                                    <CheckItem ok={Boolean(template)} label="底包模板已加载" />
                                    <CheckItem ok={songs.length > 0} label="曲目数量" optional />
                                    <CheckItem ok={selectedTimbres.length > 0} label="至少选择一套音色" />
                                    <CheckItem ok={scores.length > 0} label="曲谱（可选）" optional />
                                </div>
                            </section>

                            <div className="flex flex-col gap-2">
                                <Button
                                    type="button"
                                    className="h-10 w-full text-[13px]"
                                    loading={exporting}
                                    disabled={!template || exporting}
                                    onClick={() => void exportAddon()}
                                >
                                    <Download size={16} /> 导出附加包
                                </Button>
                                <p className="text-center text-[10.5px] leading-relaxed text-ore-dimmer">
                                    生成可直接导入 Minecraft 的 .mcaddon
                                </p>
                            </div>
                        </aside>
                    </div>
                )}
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

            <Dialog opened={pickerOpen} onClose={() => setPickerOpen(false)} title="从我的音乐添加" size="lg">
                <div className="flex flex-col gap-3">
                    <Textfield
                        placeholder="搜索我的音乐…"
                        value={pickerQuery}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") setPickerQuery(target.value);
                        }}
                    />
                    {pickerItems.length === 0 ? (
                        <div className="px-4 py-10 text-center text-[12.5px] text-ore-dim">
                            {myMusic.length === 0
                                ? "我的音乐还是空的，先去音乐库导入或从在线曲库添加"
                                : "没有可添加的曲目（都已在附加包里）"}
                        </div>
                    ) : (
                        <VirtualSongList
                            className="h-[min(360px,50vh)] rounded-md border border-ore-divider p-1"
                            items={pickerItems}
                            rowHeight={54}
                            gap={0}
                            getKey={(song) => song.id}
                            renderItem={(song, index) => (
                                <div className="flex h-full items-center gap-3 border-b border-ore-divider/60 px-2 last:border-b-0">
                                    <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-ore-dimmer">
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12.5px] font-medium">{song.name}</div>
                                        <div className="mt-0.5 text-[11px] text-ore-dim">
                                            {formatDuration(song.duration)} · {(song.noteCount ?? 0).toLocaleString()} 音符
                                        </div>
                                    </div>
                                    <Button type="button" size="sm" color="secondary" onClick={() => addToAddon(song)}>
                                        <Check size={13} /> 加入
                                    </Button>
                                </div>
                            )}
                        />
                    )}
                </div>
            </Dialog>

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
                    <p className="text-[11.5px] text-ore-dim">{titleRequest?.hint}</p>
                </div>
            </Dialog>
        </div>
    );
}

function CheckItem({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
    return (
        <div className="flex items-center gap-2 text-[12px]">
            <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    ok
                        ? "bg-[var(--pb-success)] text-white dark:text-[color:var(--pb-sunken)]"
                        : optional
                          ? "border border-ore-border text-ore-dimmer"
                          : "bg-[var(--pb-warning)] text-white dark:text-[color:var(--pb-sunken)]"
                }`}
            >
                {ok ? "✓" : optional ? "–" : "!"}
            </span>
            <span className={ok || optional ? "text-ore-dim" : "text-[color:var(--pb-warning)]"}>{label}</span>
        </div>
    );
}
