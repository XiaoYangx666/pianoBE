import { Button } from "@piano/ui";
import { Check, ChevronRight, CloudDownload, Loader2, Trash2 } from "lucide-react";
import type { AssetDownloadProgress } from "../../amt/transcribe";

export interface ModelSettingsProps {
    modelReady: boolean | null;
    downloading: boolean;
    downloadProgress: AssetDownloadProgress | null;
    onDownload: () => void;
    onClear: () => void;
    lowLoad: boolean;
    onLowLoadChange: (value: boolean) => void;
    disabled?: boolean;
}

/** 模型与高级设置：未下载时给入口，就绪后收成一行状态。 */
export function ModelSettings({
    modelReady,
    downloading,
    downloadProgress,
    onDownload,
    onClear,
    lowLoad,
    onLowLoadChange,
    disabled,
}: ModelSettingsProps) {
    const percent = downloadProgress?.percent ?? 0;

    return (
        <div className="flex flex-col gap-2">
            {modelReady === null && (
                <div className="flex items-center gap-1.5 text-[11px] text-ore-dim">
                    <Loader2 size={12} className="animate-spin" />
                    正在检查本地模型缓存…
                </div>
            )}

            {modelReady === false && (
                <div className="rounded-md border border-ore-divider px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <CloudDownload size={18} className="shrink-0 text-ore-dimmer" />
                        <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-medium">需要先下载转录模型</div>
                            <div className="mt-0.5 text-[11px] text-ore-dim">
                                约 22 MB，包含模型与推理运行时；下载后保存在浏览器缓存，不会自动联网。
                            </div>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            disabled={downloading || modelReady === null || disabled}
                            onClick={onDownload}
                        >
                            {downloading ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
                            {downloading ? "下载中…" : "下载模型"}
                        </Button>
                    </div>
                    {downloading && (
                        <div className="mt-2.5">
                            <div className="flex items-center justify-between text-[10.5px] text-ore-dim">
                                <span className="truncate">{downloadProgress?.message ?? "准备下载…"}</span>
                                <span className="ml-3 tabular-nums">{Math.round(percent)}%</span>
                            </div>
                            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--pb-soft)]">
                                <div
                                    className="h-full rounded-full bg-brand transition-[width] duration-200"
                                    style={{ width: `${percent}%` }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {modelReady && (
                <div className="flex items-center gap-1.5 text-[11px] text-ore-dim">
                    <Check size={12} className="text-[color:var(--pb-primary-light)]" />
                    转录模型已就绪
                </div>
            )}

            <details className="group text-[11px] text-ore-dim">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-ore-text [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                    高级设置
                </summary>
                <div className="mt-2 flex flex-col gap-2.5 border-l border-ore-divider pl-3">
                    <label className="flex cursor-pointer items-start gap-2 leading-relaxed">
                        <input
                            type="checkbox"
                            className="mt-0.5 accent-[var(--pb-brand)]"
                            checked={lowLoad}
                            disabled={disabled}
                            onChange={(event) => onLowLoadChange(event.target.checked)}
                        />
                        <span>
                            <b className="font-medium text-ore-text">低负载模式</b>
                            ：限制线程并在分块之间让出主线程，电脑不会卡，但转换略慢。
                        </span>
                    </label>
                    {modelReady && (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={onClear}
                            className="inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text disabled:opacity-40"
                        >
                            <Trash2 size={11} />
                            清除已下载的模型缓存
                        </button>
                    )}
                </div>
            </details>
        </div>
    );
}
