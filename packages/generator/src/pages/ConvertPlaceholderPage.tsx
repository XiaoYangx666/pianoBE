import { Tag, PageHeader } from "@piano/ui";
import { AudioWaveform, ExternalLink } from "lucide-react";

/** 为未来的音频转 MIDI 预留的独立一级页面。 */
export function ConvertPlaceholderPage() {
    return (
        <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 pt-4 md:px-0 md:pt-0">
            <PageHeader
                eyebrow="MIDI Convert"
                title="MIDI 转换"
                description="把音频转换成分轨 MIDI，并直接进入音乐库的试听、导入码与制作清单流程。"
                actions={<Tag>规划中</Tag>}
            />
            <div className="mt-8 flex flex-col items-center gap-3 border-t border-ore-divider py-14 text-center">
                <AudioWaveform size={28} className="text-ore-dimmer" />
                <div className="text-[14px] font-semibold">音频转 MIDI 正在规划</div>
                <p className="max-w-[440px] text-[12.5px] leading-relaxed text-ore-dim">
                    未来的转换流程为「音频上传 → 转换参数 → 处理进度 → MIDI 结果」，
                    转换完成后直接进入现有音乐库，不需要新的播放器或制作流程。
                </p>
                <a
                    href="https://github.com/XiaoYangx666/pianoBE"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-ore-dim transition-colors hover:bg-[var(--pb-hover)] hover:text-ore-text"
                >
                    <ExternalLink size={13} />
                    GitHub 路线图
                </a>
            </div>
        </div>
    );
}
