import { useRef, useState, type ReactNode } from "react";

export interface FileDropzoneProps {
    /** 允许的扩展名，例如 [".mid", ".midi"] */
    accept?: string[];
    multiple?: boolean;
    disabled?: boolean;
    title: string;
    description?: ReactNode;
    icon?: ReactNode;
    onDrop: (files: File[]) => void;
    /** 紧凑模式：作为按钮式的导入区域使用 */
    compact?: boolean;
}

function matchesAccept(file: File, accept?: string[]): boolean {
    if (!accept || accept.length === 0) return true;
    const name = file.name.toLowerCase();
    return accept.some((ext) => name.endsWith(ext.toLowerCase()));
}

/**
 * 统一的文件拖拽入口：MIDI、音色、曲谱图片/PDF/ZIP 都走这里。
 * 点击与拖拽都可触发；具体解析交给各应用的业务模块。
 */
export function FileDropzone({
    accept,
    multiple = true,
    disabled,
    title,
    description,
    icon,
    onDrop,
    compact = false,
}: FileDropzoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleFiles = (list: FileList | null) => {
        if (!list || list.length === 0) return;
        const files = Array.from(list).filter((file) => matchesAccept(file, accept));
        if (files.length > 0) onDrop(multiple ? files : files.slice(0, 1));
    };

    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            className={[
                "flex cursor-pointer items-center rounded-lg border border-dashed transition-colors",
                compact ? "gap-2.5 px-4 py-3" : "flex-col gap-3 px-6 py-7 text-center",
                dragging ? "border-brand bg-brand/10" : "border-ore-border bg-[var(--pb-soft)] hover:border-brand/60",
                disabled ? "pointer-events-none opacity-50" : "",
            ].join(" ")}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inputRef.current?.click();
                }
            }}
            onDragOver={(event) => {
                event.preventDefault();
                if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!disabled) handleFiles(event.dataTransfer.files);
            }}
        >
            {icon && (
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand/35 bg-brand/12 text-[color:var(--pb-primary-light)]">
                    {icon}
                </div>
            )}
            <div className={compact ? "min-w-0 text-left" : ""}>
                <div className={compact ? "text-[13px] font-semibold" : "text-[15px] font-semibold"}>{title}</div>
                {description && <div className="mt-0.5 text-xs text-ore-dim">{description}</div>}
            </div>
            <input
                ref={inputRef}
                type="file"
                hidden
                multiple={multiple}
                accept={accept?.join(",")}
                onChange={(event) => {
                    handleFiles(event.target.files);
                    event.target.value = "";
                }}
            />
        </div>
    );
}
