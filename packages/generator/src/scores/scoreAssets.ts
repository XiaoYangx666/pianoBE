import type { ScoreEntry } from "./scores";
import type { TemplateInfo } from "../addon/template";

/**
 * 读取曲谱页面的 PNG 字节：
 * - 自定义曲谱：assets 里保存了量化后的 PNG
 * - 模板曲谱：从模板 RP 的原路径读取
 */
async function readScorePageBytes(
    score: ScoreEntry,
    pagePath: string,
    template: TemplateInfo | null
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
    template: TemplateInfo | null
): Promise<Blob | null> {
    const bytes = await readScorePageBytes(score, pagePath, template);
    if (!bytes) return null;
    return new Blob([bytes.slice().buffer], { type: "image/png" });
}
