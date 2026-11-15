import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, SongBadge } from "@piano/ui";
import type { ScoreEntry } from "../scores";
import type { TemplateInfo } from "../template";
import { readScorePageBlob } from "../scoreAssets";

export function ScorePreviewModal({
    score,
    template,
    opened,
    onClose,
}: {
    score: ScoreEntry | null;
    template: TemplateInfo | null;
    opened: boolean;
    onClose: () => void;
}) {
    const [page, setPage] = useState(0);
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const pageCount = score?.pages.length ?? 0;

    useEffect(() => {
        if (opened) setPage(0);
    }, [opened, score?.id]);

    useEffect(() => {
        if (!opened || !score) return;
        const pagePath = score.pages[page];
        if (!pagePath) return;
        let cancelled = false;
        let objectUrl: string | null = null;
        setLoading(true);
        setUrl(null);
        readScorePageBlob(score, pagePath, template)
            .then((blob) => {
                if (cancelled) return;
                if (!blob) {
                    setUrl(null);
                    return;
                }
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            })
            .catch(() => setUrl(null))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opened, score, page, template]);

    return (
        <Dialog
            opened={opened}
            onClose={onClose}
            size="lg"
            title={
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{score?.title ?? "曲谱预览"}</span>
                    {score && <SongBadge>{score.source === "template" ? "模板" : "自定义"}</SongBadge>}
                </span>
            }
            footer={
                <div className="flex w-full items-center justify-center gap-4">
                    <button
                        type="button"
                        aria-label="上一页"
                        disabled={page <= 0}
                        onClick={() => setPage((value) => Math.max(0, value - 1))}
                        className="grid h-8 w-8 place-items-center rounded-md border border-ore-border text-ore-dim hover:text-ore-text disabled:opacity-40"
                    >
                        <ChevronLeft size={17} />
                    </button>
                    <span className="text-sm tabular-nums text-ore-dim">
                        {pageCount === 0 ? "0 / 0" : `${page + 1} / ${pageCount}`}
                    </span>
                    <button
                        type="button"
                        aria-label="下一页"
                        disabled={page >= pageCount - 1}
                        onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                        className="grid h-8 w-8 place-items-center rounded-md border border-ore-border text-ore-dim hover:text-ore-text disabled:opacity-40"
                    >
                        <ChevronRight size={17} />
                    </button>
                </div>
            }
        >
            <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-lg bg-[var(--pb-code)]">
                {loading && <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                {!loading && url && <img src={url} alt={score?.title ?? "曲谱"} className="block max-h-[68vh] max-w-full object-contain shadow-lg" />}
                {!loading && !url && <span className="text-sm text-ore-dim">这一页无法加载</span>}
            </div>
        </Dialog>
    );
}
