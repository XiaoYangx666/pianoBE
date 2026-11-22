import { EmptyState, SongBadge } from "@piano/ui";
import { Play } from "lucide-react";
import type { TemplateInfo } from "../../addon/template";
import type { TimbreIndexEntry } from "../../addon/timbres";
import { bytesToMB } from "../../store/generator";

export interface TimbresPanelProps {
    timbres: readonly TimbreIndexEntry[];
    selectedTimbres: readonly string[];
    previewTimbreId: string;
    template: TemplateInfo | null;
    onToggleTimbre: (id: string, checked: boolean) => void;
    onSetPreviewTimbre: (id: string) => void;
}

export function TimbresPanel({
    timbres,
    selectedTimbres,
    previewTimbreId,
    template,
    onToggleTimbre,
    onSetPreviewTimbre,
}: TimbresPanelProps) {
    return (
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
                                    onChange={(event) => onToggleTimbre(timbre.id, event.currentTarget.checked)}
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
                                    onClick={() => onSetPreviewTimbre(timbre.id)}
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
    );
}
