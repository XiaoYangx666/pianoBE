import { Button } from "@piano/ui";
import { Clock3, Loader2, X } from "lucide-react";
import { formatElapsed } from "./format";

export interface ProgressPanelProps {
    message: string;
    percent: number;
    elapsedMs: number | null;
    onCancel: () => void;
}

/** 转换进行中：只保留当前状态、进度、耗时和取消。 */
export function ProgressPanel({ message, percent, elapsedMs, onCancel }: ProgressPanelProps) {
    return (
        <div className="flex flex-col gap-2.5 border-t border-ore-divider pt-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
                <Loader2 size={14} className="animate-spin text-ore-dim" />
                <span className="min-w-0 flex-1 truncate">{message}</span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-ore-dim">
                    <Clock3 size={11} />
                    {formatElapsed(elapsedMs)} · {Math.round(percent)}%
                </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--pb-soft)]">
                <div
                    className="h-full rounded-full bg-brand transition-[width] duration-200"
                    style={{ width: `${percent}%` }}
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-ore-dimmer">
                    转换在本地完成，期间可以取消；音频和模型都不会上传。
                </span>
                <Button type="button" size="sm" color="ghost" onClick={onCancel}>
                    <X size={12} />
                    取消
                </Button>
            </div>
        </div>
    );
}
