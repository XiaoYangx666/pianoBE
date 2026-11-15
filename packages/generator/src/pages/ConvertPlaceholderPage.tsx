import { Tag } from "@piano/ui";
import { AudioWaveform, ExternalLink } from "lucide-react";
import { PageHeader } from "@piano/ui";

/** 为未来的音频转 MIDI 预留的独立一级页面。 */
export function ConvertPlaceholderPage() {
    return (
        <div className="flex flex-col gap-5">
            <PageHeader
                eyebrow="MIDI Convert"
                title="MIDI 转换"
                description="把音频转换成分轨 MIDI，并直接进入音乐库的试听、导入码与制作清单流程。"
                actions={<Tag>规划中</Tag>}
            />
            <div className="rounded-xl border border-ore-border bg-ore-raised p-6">
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-brand/35 bg-brand/12 text-[color:var(--pb-primary-light)]">
                        <AudioWaveform size={26} />
                    </div>
                    <div className="text-[15px] font-semibold">音频转 MIDI 正在规划</div>
                    <p className="max-w-[440px] text-sm leading-relaxed text-ore-dim">
                        未来的转换流程为「音频上传 → 转换参数 → 处理进度 → MIDI 结果」，
                        转换完成后直接进入现有音乐库，不需要新的播放器或制作流程。
                    </p>
                    <a
                        href="https://github.com/XiaoYangx666/pianoBE"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-ore-border px-3 py-1.5 text-xs text-ore-dim transition-colors hover:border-brand/60 hover:text-ore-text"
                    >
                        <ExternalLink size={14} />
                        GitHub 路线图
                    </a>
                </div>
            </div>
        </div>
    );
}
