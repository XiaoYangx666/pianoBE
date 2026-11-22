import { useMemo, useRef } from "react";
import { Button, Textarea, Textfield } from "@piano/ui";
import { Download, RefreshCw } from "lucide-react";
import type { TemplateInfo } from "../../addon/template";
import { bytesToMB } from "../../store/generator";

const SECTION_LABEL = "text-[10px] font-semibold uppercase tracking-[0.14em] text-ore-dimmer";

export interface ExportPanelProps {
    template: TemplateInfo | null;
    templateVersion: string;
    addonName: string;
    addonDesc: string;
    randomUuid: boolean;
    songsCount: number;
    selectedPluginsCount: number;
    selectedPluginBytes: number;
    vfxReady: boolean;
    selectedTimbresCount: number;
    extraTimbreBytes: number;
    scoresCount: number;
    exporting: boolean;
    onSetAddonName: (value: string) => void;
    onSetAddonDesc: (value: string) => void;
    onSetRandomUuid: (value: boolean) => void;
    onApplyTemplate: (file: File) => void;
    onExportAddon: () => void;
}

export function ExportPanel({
    template,
    templateVersion,
    addonName,
    addonDesc,
    randomUuid,
    songsCount,
    selectedPluginsCount,
    selectedPluginBytes,
    vfxReady,
    selectedTimbresCount,
    extraTimbreBytes,
    scoresCount,
    exporting,
    onSetAddonName,
    onSetAddonDesc,
    onSetRandomUuid,
    onApplyTemplate,
    onExportAddon,
}: ExportPanelProps) {
    const templateRef = useRef<HTMLInputElement>(null);

    const summary = useMemo(
        () => [
            { label: "曲目", value: `${songsCount} 首` },
            {
                label: "VFX 插件",
                value:
                    selectedPluginsCount === 0
                        ? "0 个（零插件模式）"
                        : `${selectedPluginsCount} 个 (${(selectedPluginBytes / 1024).toFixed(0)} KB)`,
            },
            { label: "音色", value: `${selectedTimbresCount} 套` },
            { label: "曲谱", value: `${scoresCount} 张` },
            { label: "模板版本", value: templateVersion },
            {
                label: "附加音色",
                value: extraTimbreBytes > 0 ? `约 ${bytesToMB(extraTimbreBytes)}` : "仅内置",
            },
        ],
        [
            songsCount,
            selectedPluginsCount,
            selectedPluginBytes,
            selectedTimbresCount,
            scoresCount,
            templateVersion,
            extraTimbreBytes,
        ]
    );

    return (
        <div className="grid max-w-[1040px] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] lg:gap-12">
            <div className="flex flex-col gap-7">
                <section className="flex flex-col gap-3">
                    <h3 className={SECTION_LABEL}>附加包信息</h3>
                    <Textfield
                        label="Pack Name"
                        placeholder="钢琴附加包"
                        value={addonName}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") onSetAddonName(target.value);
                        }}
                    />
                    <Textarea
                        label="Description"
                        placeholder="Powered by PianoBE"
                        rows={3}
                        value={addonDesc}
                        onInput={(event) => {
                            const target = event.target as unknown as { value?: unknown };
                            if (typeof target?.value === "string") onSetAddonDesc(target.value);
                        }}
                    />
                    <label className="flex items-start gap-2.5 py-0.5">
                        <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-[var(--pb-primary)]"
                            checked={randomUuid}
                            onChange={(event) => onSetRandomUuid(event.currentTarget.checked)}
                        />
                        <span>
                            <span className="block text-[12.5px] font-medium">随机化 UUID</span>
                            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ore-dim">
                                每次导出使用新的包 UUID，避免覆盖已安装的旧版本
                            </span>
                        </span>
                    </label>
                </section>

                <section className="flex flex-col gap-3 border-t border-ore-divider pt-6">
                    <h3 className={SECTION_LABEL}>模板底包</h3>
                    <div className="flex flex-col">
                        {[
                            ["底包版本", templateVersion],
                            ["模板曲目", `${template?.songs.length ?? 0} 首`],
                            ["模板曲谱", `${template?.scores.length ?? 0} 张`],
                        ].map(([label, value]) => (
                            <div
                                key={label}
                                className="flex items-center justify-between border-b border-ore-divider/70 py-2 text-[12px] last:border-b-0"
                            >
                                <span className="text-ore-dim">{label}</span>
                                <b className="font-medium">{value}</b>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-ore-dim">
                        {template?.bpManifest.header?.description ?? "尚未加载模板"}
                    </p>
                    <input
                        ref={templateRef}
                        type="file"
                        accept=".mcaddon,.zip"
                        hidden
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) onApplyTemplate(file);
                        }}
                    />
                    <Button
                        type="button"
                        color="secondary"
                        size="sm"
                        className="w-fit"
                        onClick={() => templateRef.current?.click()}
                    >
                        <RefreshCw size={13} /> 更换底包模板
                    </Button>
                </section>
            </div>

            <aside className="flex flex-col gap-6 lg:border-l lg:border-ore-divider lg:pl-8">
                <section className="flex flex-col gap-2">
                    <h3 className={SECTION_LABEL}>制作摘要</h3>
                    <div className="flex flex-col">
                        {summary.map((row) => (
                            <div
                                key={row.label}
                                className="flex items-center justify-between border-b border-ore-divider/70 py-2 text-[12px] last:border-b-0"
                            >
                                <span className="text-ore-dim">{row.label}</span>
                                <b className="font-medium">{row.value}</b>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-2.5">
                    <h3 className={SECTION_LABEL}>导出前检查</h3>
                    <div className="flex flex-col gap-2">
                        <CheckItem ok={Boolean(template)} label="底包模板已加载" />
                        <CheckItem ok={songsCount > 0} label="曲目数量" optional />
                        <CheckItem
                            ok={vfxReady}
                            optional={selectedPluginsCount === 0 && vfxReady}
                            label={
                                vfxReady
                                    ? selectedPluginsCount === 0
                                        ? "零插件模式（无 VFX 特效）"
                                        : `VFX 插件已就绪（${selectedPluginsCount} 个）`
                                    : "存在缺少或未启用的曲目特效"
                            }
                        />
                        <CheckItem ok={selectedTimbresCount > 0} label="至少选择一套音色" />
                        <CheckItem ok={scoresCount > 0} label="曲谱（可选）" optional />
                    </div>
                </section>

                <div className="flex flex-col gap-2">
                    <Button
                        type="button"
                        className="h-10 w-full text-[13px]"
                        loading={exporting}
                        disabled={!template || exporting}
                        onClick={onExportAddon}
                    >
                        <Download size={16} /> 导出附加包
                    </Button>
                    <p className="text-center text-[10.5px] leading-relaxed text-ore-dimmer">
                        生成可直接导入 Minecraft 的 .mcaddon
                    </p>
                </div>
            </aside>
        </div>
    );
}

function CheckItem({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
    return (
        <div className="flex items-center gap-2 text-[12px]">
            <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    ok
                        ? "bg-[var(--pb-success)] text-white dark:text-[color:var(--pb-sunken)]"
                        : optional
                          ? "border border-ore-border text-ore-dimmer"
                          : "bg-[var(--pb-warning)] text-white dark:text-[color:var(--pb-sunken)]"
                }`}
            >
                {ok ? "✓" : optional ? "–" : "!"}
            </span>
            <span className={ok || optional ? "text-ore-dim" : "text-[color:var(--pb-warning)]"}>{label}</span>
        </div>
    );
}
