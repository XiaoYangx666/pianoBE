import type { TemplateInfo } from "@piano/assembly";
import type { ScoreEntry } from "./scores";

async function readScorePageBytes(
    score: ScoreEntry,
    pagePath: string,
    template: TemplateInfo | null,
): Promise<Uint8Array | null> {
    const custom = score.assets?.get(pagePath);
    if (custom) return custom;
    if (!template) return null;
    const file = await template.addon.read(`${template.rpPath}${pagePath}`);
    return file ? file.bytes : null;
}

export async function readScorePageBlob(
    score: ScoreEntry,
    pagePath: string,
    template: TemplateInfo | null,
): Promise<Blob | null> {
    const bytes = await readScorePageBytes(score, pagePath, template);
    if (!bytes) return null;
    return new Blob([bytes.slice().buffer], { type: "image/png" });
}
