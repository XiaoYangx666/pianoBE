import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Dialog } from "@piano/ui";
import { useGenerator } from "../store/generator";

interface ChangelogEntry {
    version?: string;
    date: string;
    content: string[];
}

/** 解析 addon 的 rp/changelog.txt：版本头（v1.2.0 (2026-06-19) / Preview-26-04-16）+ 编号条目。 */
function parseAddonChangelog(text: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    let current: ChangelogEntry | null = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (/^(v\d+(\.\d+)+|preview)/i.test(line)) {
            const dateStr = line
                .replace(/^v\d+(\.\d+)+[\s(（]*/i, "")
                .replace(/^preview[\s-]*/i, "");
            const m4 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
            const m2 = dateStr.match(/^(\d{2})-(\d{2})-(\d{2})/);
            current = {
                version: line.replace(/\s*[\(（]\d{2,4}-\d{2}-\d{2}[\)）]\s*$/, "").trim(),
                date: m4 ? `${m4[1]}-${m4[2]}-${m4[3]}` : m2 ? `20${m2[1]}-${m2[2]}-${m2[3]}` : "",
                content: [],
            };
            entries.push(current);
        } else if (current) {
            current.content.push(line.replace(/^\d+[.、]\s*/, "").replace(/^[-•]\s*/, ""));
        }
    }
    return entries;
}

function LogEntries({ entries }: { entries: ChangelogEntry[] | null }) {
    if (!entries) {
        return (
            <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="h-3 animate-pulse rounded bg-[var(--pb-track)]" style={{ width: `${90 - i * 15}%` }} />
                ))}
            </div>
        );
    }
    if (entries.length === 0) {
        return <p className="py-6 text-center text-sm text-ore-dim">暂无更新记录</p>;
    }
    return (
        <div className="space-y-5">
            {entries.map((entry, index) => (
                <div key={`${entry.version ?? entry.date}-${index}`}>
                    <div className="mb-1.5 flex items-center gap-2">
                        {entry.version && (
                            <span className="rounded border border-brand/40 bg-brand/12 px-1.5 py-px text-[11px] font-medium text-[color:var(--pb-primary-light)]">
                                {entry.version}
                            </span>
                        )}
                        {entry.date && <span className="text-[11px] text-ore-dim">{entry.date}</span>}
                    </div>
                    <ul className="space-y-1 pl-1">
                        {entry.content.map((item, i) => (
                            <li key={i} className="text-[13px] leading-relaxed text-ore-dim">
                                · {item}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

export function ChangelogModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
    const [tab, setTab] = useState<"project" | "addon">("project");
    const [project, setProject] = useState<ChangelogEntry[] | null>(null);
    const [addon, setAddon] = useState<ChangelogEntry[] | null>(null);
    const [addonError, setAddonError] = useState<string | null>(null);
    const template = useGenerator((state) => state.template);

    useEffect(() => {
        if (!opened) return;
        if (!project) {
            fetch(`./changelog.json?t=${Date.now()}`)
                .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
                .then((data: ChangelogEntry[]) => setProject(data))
                .catch(() => setProject([]));
        }
        if (!addon) {
            if (!template) {
                setAddon([]);
                setAddonError("尚未加载模板包");
                return;
            }
            template.addon
                .readText(`${template.rpPath}changelog.txt`)
                .then((text) => {
                    if (text === undefined) {
                        setAddonError("当前模板包不含更新日志");
                        setAddon([]);
                        return;
                    }
                    setAddonError(null);
                    setAddon(parseAddonChangelog(text));
                })
                .catch(() => {
                    setAddonError("模板包更新日志读取失败");
                    setAddon([]);
                });
        }
    }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

    // 更换模板后重新读取模板包日志
    useEffect(() => {
        setAddon(null);
        setAddonError(null);
    }, [template]);

    const tabClass = (active: boolean) =>
        [
            "rounded-md px-3 py-1.5 text-xs transition-colors",
            active ? "bg-brand/18 text-[color:var(--pb-primary-light)]" : "text-ore-dim hover:bg-[var(--pb-hover)]",
        ].join(" ");

    return (
        <Dialog
            opened={opened}
            onClose={onClose}
            title="更新日志"
            size="lg"
            footer={
                <div className="flex w-full items-center gap-4 text-xs text-ore-dim">
                    <a href="https://github.com/XiaoYangx666/pianoBE" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ore-text">
                        GitHub <ExternalLink size={11} />
                    </a>
                    <a href="https://www.bilibili.com/video/BV1jLD9BzE5D/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ore-text">
                        Bilibili <ExternalLink size={11} />
                    </a>
                </div>
            }
        >
            <div className="mb-3 flex gap-1.5">
                <button type="button" className={tabClass(tab === "project")} onClick={() => setTab("project")}>
                    项目更新日志
                </button>
                <button type="button" className={tabClass(tab === "addon")} onClick={() => setTab("addon")}>
                    模板包更新日志
                </button>
            </div>
            <div className="max-h-[440px] overflow-y-auto pr-1">
                {tab === "project" ? (
                    <LogEntries entries={project} />
                ) : (
                    <>
                        {addonError && (
                            <div className="mb-3 rounded-md border border-ore-border bg-[var(--pb-soft)] px-3 py-2 text-xs text-ore-dim">
                                {addonError}
                            </div>
                        )}
                        <LogEntries entries={addon} />
                    </>
                )}
            </div>
        </Dialog>
    );
}
