import type { ReactNode } from "react";
import { ExternalLink, Github, Music2, PackageOpen, ShieldCheck } from "lucide-react";
import { PageHeader, PianoKeys, SongBadge } from "@piano/ui";
import { ChangelogButton } from "../components/ChangelogButton";

const REPO_URL = "https://github.com/XiaoYangx666/pianoBE";
const ISSUES_URL = `${REPO_URL}/issues`;

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-ore-border bg-ore-raised p-4">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ore-dim">{title}</h2>
            <div className="mt-3 flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-ore-dim">{children}</div>
        </section>
    );
}

function LinkRow({ href, icon, title, description }: {
    href: string;
    icon: ReactNode;
    title: string;
    description: string;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 rounded-md border border-ore-divider px-3 py-2.5 transition-colors hover:bg-[var(--pb-hover)]"
        >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--pb-soft)] text-ore-dim group-hover:text-ore-text">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ore-text">{title}</span>
                <span className="mt-0.5 block text-[11px] text-ore-dim">{description}</span>
            </span>
            <ExternalLink size={13} className="shrink-0 text-ore-dimmer group-hover:text-ore-text" />
        </a>
    );
}

export function AboutPage() {
    return (
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 pt-4 md:px-0 md:pt-0">
            <div className="hidden md:block">
                <PageHeader title="关于" description="PianoBE 音乐工具、曲库与 Minecraft 附加包生成器。" />
            </div>

            <div className="mt-4 flex flex-col gap-3 md:mt-6">
                <div className="flex items-start gap-3 rounded-lg border border-ore-border bg-ore-raised p-4">
                    <PianoKeys playing={false} className="h-10 w-12 shrink-0 p-1.5" />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-semibold">PianoBE</span>
                            <SongBadge tone="brand">网页生成器</SongBadge>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-ore-dim">
                            浏览并试听 MIDI 曲库、把曲目导入本地「我的音乐」，再挑选音色与曲谱，
                            导出可直接安装的 Minecraft 基岩版 <span className="font-mono text-[11.5px]">.mcaddon</span>。
                        </p>
                    </div>
                </div>

                <Section title="能做什么">
                    <div className="flex items-start gap-2.5">
                        <Music2 size={15} className="mt-0.5 shrink-0 text-ore-dimmer" />
                        <span>
                            <b className="font-medium text-ore-text">音乐库</b>：试听在线曲库、导入 MIDI 文件或文件夹、
                            管理「我的音乐」并支持改名与游戏内导入码。
                        </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                        <PackageOpen size={15} className="mt-0.5 shrink-0 text-ore-dimmer" />
                        <span>
                            <b className="font-medium text-ore-text">附加包制作</b>：整理曲目、选择音色、添加曲谱，
                            一键导出附加包；曲目改名会同步写入 PBE2 文件头。
                        </span>
                    </div>
                </Section>

                <Section title="链接">
                    <LinkRow
                        href={REPO_URL}
                        icon={<Github size={16} />}
                        title="GitHub 仓库"
                        description="源码、更新日志与使用说明"
                    />
                    <LinkRow
                        href={ISSUES_URL}
                        icon={<ExternalLink size={16} />}
                        title="问题反馈"
                        description="遇到 bug 或有功能建议，欢迎提交 issue"
                    />
                    <div className="flex items-center justify-between gap-3 rounded-md border border-ore-divider px-3 py-2">
                        <span className="text-[12px] text-ore-dim">本工具的版本变化</span>
                        <ChangelogButton label="更新日志" />
                    </div>
                </Section>

                <Section title="许可与致谢">
                    <div className="flex items-start gap-2.5">
                        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ore-dimmer" />
                        <span>
                            项目以 <b className="font-medium text-ore-text">GPL-3.0-only</b> 许可发布。
                            钢琴音色采样来自 FluidR3、VCSL、Salamander 等开源音源，
                            具体来源与处理方式见仓库中的第三方声明。
                        </span>
                    </div>
                </Section>
            </div>
        </div>
    );
}
