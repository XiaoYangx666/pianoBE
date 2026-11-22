import { useCallback, useRef, useState } from "react";
import { Button, Dialog, EmptyState, SongBadge, Textfield, VirtualSongList } from "@piano/ui";
import { Eye, FileArchive, FileImage, Trash2 } from "lucide-react";
import type { TemplateInfo } from "../../addon/template";
import { ScoreThumb } from "../../components/ScoreThumb";
import { MAX_TITLE_CHARS, type ScoreEntry } from "../../scores/scores";

const SCORE_ROW_HEIGHT = 84;

interface TitleRequest {
    defaultTitle: string;
    hint: string;
    resolve: (value: string | null) => void;
}

export interface ScoresPanelProps {
    scores: readonly ScoreEntry[];
    template: TemplateInfo | null;
    onPreviewScore: (score: ScoreEntry) => void;
    onRemoveScore: (index: number) => void;
    onImportScorePackFiles: (files: File[]) => void;
    onImportScorePageFiles: (
        files: File[],
        requestTitle: (defaultTitle: string, hint: string) => Promise<string | null>
    ) => void;
}

export function ScoresPanel({
    scores,
    template,
    onPreviewScore,
    onRemoveScore,
    onImportScorePackFiles,
    onImportScorePageFiles,
}: ScoresPanelProps) {
    const scorePackRef = useRef<HTMLInputElement>(null);
    const scorePagesRef = useRef<HTMLInputElement>(null);
    const [titleRequest, setTitleRequest] = useState<TitleRequest | null>(null);
    const [titleValue, setTitleValue] = useState("");
    const [titleError, setTitleError] = useState("");

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
                            onClick={() => onPreviewScore(score)}
                        >
                            <Eye size={15} />
                        </button>
                        <button
                            type="button"
                            aria-label="移除曲谱"
                            title="移除曲谱"
                            className="grid h-8 w-8 place-items-center rounded-md text-ore-dim transition-colors hover:bg-[var(--pb-danger-soft)] hover:text-[color:var(--pb-danger)]"
                            onClick={() => onRemoveScore(index)}
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                </div>
            );
        },
        [onPreviewScore, onRemoveScore, template]
    );

    return (
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
                            if (files.length > 0) onImportScorePageFiles(files, requestTitle);
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
                            if (files.length > 0) onImportScorePackFiles(files);
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
                    items={scores as ScoreEntry[]}
                    rowHeight={SCORE_ROW_HEIGHT}
                    gap={0}
                    getKey={(score, index) => `${score.id}-${index}`}
                    renderItem={renderScoreRow}
                />
            )}

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
