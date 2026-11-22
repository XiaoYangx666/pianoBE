import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { ScoreEntry } from "../scores/scores";
import type { TemplateInfo } from "../addon/template";
import { readScorePageBlob } from "../scores/scoreAssets";

export function ScoreThumb({
    score,
    template,
    width = 52,
    height = 70,
}: {
    score: ScoreEntry;
    template: TemplateInfo | null;
    width?: number;
    height?: number;
}) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const pagePath = score.pages[0];

    useEffect(() => {
        let revoked = false;
        let objectUrl: string | null = null;
        setUrl(null);
        setFailed(false);
        if (!pagePath) {
            setFailed(true);
            return;
        }
        readScorePageBlob(score, pagePath, template)
            .then((blob) => {
                if (!blob) {
                    setFailed(true);
                    return;
                }
                objectUrl = URL.createObjectURL(blob);
                if (revoked) URL.revokeObjectURL(objectUrl);
                else setUrl(objectUrl);
            })
            .catch(() => setFailed(true));
        return () => {
            revoked = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [score, pagePath, template]);

    if (failed) {
        return (
            <div
                className="grid shrink-0 place-items-center rounded-md border border-ore-border bg-[var(--pb-soft)] text-ore-dim"
                style={{ width, height }}
            >
                <FileText size={18} />
            </div>
        );
    }

    if (!url) return <div className="shrink-0 animate-pulse rounded-md bg-[var(--pb-track)]" style={{ width, height }} />;

    return (
        <div className="shrink-0 overflow-hidden rounded-md border border-ore-border bg-[var(--pb-code)]" style={{ width, height }}>
            <img src={url} alt={score.title} loading="lazy" className="h-full w-full object-cover" />
        </div>
    );
}
