import { useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { Button, IconButton } from "../primitives";
import { Dialog } from "./Dialog";
import { notify } from "../notify";

export async function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
}

export interface ImportCodeDialogProps {
    opened: boolean;
    onClose: () => void;
    songName: string;
    chunks: string[];
    /** 完整 PBE3 字节数；用于在弹窗里显示曲目大小 */
    bytes?: number;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 游戏内导入码：逐段复制或一次复制全部；每段不超过 4800 字符。 */
export function ImportCodeDialog({ opened, onClose, songName, chunks, bytes }: ImportCodeDialogProps) {
    const [copiedAll, setCopiedAll] = useState(false);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const copyAll = async () => {
        try {
            await copyText(chunks.join("\n"));
            setCopiedAll(true);
            notify({ title: "已复制全部分段", message: `${songName} · 共 ${chunks.length} 段`, color: "teal" });
            window.setTimeout(() => setCopiedAll(false), 1600);
        } catch {
            notify({ title: "复制失败", message: "请逐段手动复制", color: "red" });
        }
    };

    const copyChunk = async (chunk: string, index: number) => {
        await copyText(chunk);
        setCopiedIndex(index);
        window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500);
    };

    return (
        <Dialog
            opened={opened}
            onClose={onClose}
            title="游戏内导入码"
            size="md"
        >
            <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 text-xs leading-relaxed text-ore-dim">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[color:var(--pb-success)]" />
                    <span>
                        在游戏内打开「导入 MIDI」，把下面每一段逐段粘贴到输入框（可乱序）。单段不超过 4800
                        字符，共 {chunks.length} 段。
                    </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <div className="truncate text-sm font-semibold">{songName}</div>
                        {bytes !== undefined && (
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-ore-dim">
                                {formatSize(bytes)}
                            </span>
                        )}
                    </div>
                    <Button type="button" size="sm" onClick={() => void copyAll()}>
                        {copiedAll ? <Check size={13} /> : <Copy size={13} />}
                        复制全部
                    </Button>
                </div>

                <div className="grid max-h-[min(52vh,360px)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {chunks.map((chunk, index) => (
                        <div
                            key={index}
                            className="flex items-center gap-2.5 rounded-md border border-ore-border bg-[var(--pb-code)] p-2.5"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 text-[11px] text-ore-dim">
                                    第 {index + 1}/{chunks.length} 段 · {chunk.length} 字符
                                </div>
                                <code className="block truncate font-mono text-[11px] text-ore-dim">{chunk.slice(0, 48)}…</code>
                            </div>
                            <IconButton
                                size="sm"
                                aria-label="复制本段"
                                title={copiedIndex === index ? "已复制" : "复制本段"}
                                onClick={() => void copyChunk(chunk, index)}
                            >
                                {copiedIndex === index ? <Check size={14} className="text-[color:var(--pb-success)]" /> : <Copy size={14} />}
                            </IconButton>
                        </div>
                    ))}
                </div>
            </div>
        </Dialog>
    );
}
