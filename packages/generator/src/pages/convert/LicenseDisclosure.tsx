import { ChevronRight, ExternalLink, ShieldCheck, Trash2 } from "lucide-react";

export interface LicenseDisclosureProps {
    modelReady?: boolean | null;
    onClearModel?: () => void;
}

/** 隐私、模型说明与许可：放在页面底部的折叠说明里，保留法律信息但不干扰主流程。 */
export function LicenseDisclosure({ modelReady, onClearModel }: LicenseDisclosureProps) {
    return (
        <details className="group mt-8 border-t border-ore-divider pt-3 text-[11px] text-ore-dim">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 transition-colors hover:text-ore-text [&::-webkit-details-marker]:hidden">
                <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                模型、隐私与许可
            </summary>
            <div className="mt-2.5 flex max-w-[720px] flex-col gap-2 leading-relaxed">
                <p className="flex items-start gap-1.5">
                    <ShieldCheck size={12} className="mt-0.5 shrink-0 text-ore-dimmer" />
                    音频解码、CQT 与 ONNX 推理全部在当前浏览器内完成，不会上传音频。
                    模型与运行时只有点击下载后才会联网，并保存在浏览器缓存中。
                </p>
                {modelReady && onClearModel && (
                    <button
                        type="button"
                        onClick={onClearModel}
                        className="inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                    >
                        <Trash2 size={11} />
                        清除已下载的模型缓存（约 22 MB）
                    </button>
                )}
                <p>
                    转录模型与推理链路来自{" "}
                    <a
                        href="https://github.com/gityag/Automated-Music-Transcription"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-brand underline-offset-2 hover:underline"
                    >
                        gityag/Automated-Music-Transcription
                        <ExternalLink size={10} />
                    </a>
                    ，模型权重以{" "}
                    <a
                        href="https://creativecommons.org/licenses/by-nc/4.0/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-brand underline-offset-2 hover:underline"
                    >
                        CC BY-NC 4.0
                        <ExternalLink size={10} />
                    </a>{" "}
                    授权，仅限非商业使用。
                </p>
                <p className="text-ore-dimmer">
                    本页面代码遵循 CC BY-NC 4.0 许可（与转录模型一致，禁止商业使用）。
                </p>
            </div>
        </details>
    );
}
