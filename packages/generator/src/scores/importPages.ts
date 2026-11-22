import {
    MAX_PAGES_PER_SCORE,
    MAX_SCORES,
    MAX_TITLE_CHARS,
    buildRealPageScore,
    decodeImage,
    type ScoreEntry,
} from "./scores";
import { openPdf, renderPdfPage, type OpenedPdf } from "./pdf";

/** 直接导入支持的图片扩展名（与 index.html 的 accept 一致）。 */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export interface ImportPagesOptions {
    /**
     * 弹窗让用户确认/编辑曲谱标题。
     * 返回 null 表示跳过这张曲谱（不导入）。
     */
    requestTitle: (defaultTitle: string, hint: string) => Promise<string | null>;
    /** 进度文案，用于全屏 loading。 */
    onProgress?: (text: string) => void;
}

export interface ImportPagesResult {
    /** 成功生成的曲谱条目（尚未写入全局列表） */
    scores: ScoreEntry[];
    /** 逐条中文错误，由 UI 汇总 alert */
    errors: string[];
}

/**
 * 直接导入真实谱面：
 * - 所有图片按选择顺序合并成一张曲谱（连续页面）
 * - 每个 PDF 各自一张曲谱，每页渲染成一页
 * - 图片与 PDF 可以同时选择
 * 总数受 MAX_SCORES 限制，单张曲谱页数受 MAX_PAGES_PER_SCORE 限制。
 */
export async function importScorePages(
    files: readonly File[],
    existing: readonly ScoreEntry[],
    options: ImportPagesOptions
): Promise<ImportPagesResult> {
    const images: File[] = [];
    const pdfs: File[] = [];
    const unsupported: string[] = [];

    for (const file of files) {
        const ext = fileExtension(file.name);
        if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) images.push(file);
        else if (ext === "pdf") pdfs.push(file);
        else unsupported.push(file.name);
    }

    const planned = (images.length > 0 ? 1 : 0) + pdfs.length;
    if (planned === 0) {
        const detail = unsupported.length ? `：${unsupported.join("、")}` : "";
        throw new Error(`没有可导入的图片或 PDF${detail}`);
    }
    const remaining = MAX_SCORES - existing.length;
    if (planned > remaining) {
        throw new Error(
            `曲谱总数不能超过 ${MAX_SCORES} 张（当前已有 ${existing.length} 张，本次选择 ${planned} 张）`
        );
    }

    const progress = options.onProgress ?? (() => {});
    const usedIds = new Set(existing.map((score) => score.id));
    const errors: string[] = unsupported.map(
        (name) => `${name}：不支持的格式（仅支持 PNG/JPEG/WebP 图片或 PDF）`
    );
    const scores: ScoreEntry[] = [];

    // ---- 图片：全部合并成一张曲谱 ----
    if (images.length > 0) {
        const label = images.length === 1 ? images[0].name : `${images.length} 张图片`;
        if (images.length > MAX_PAGES_PER_SCORE) {
            errors.push(`${label}：共 ${images.length} 页，超过单张曲谱上限 ${MAX_PAGES_PER_SCORE} 页`);
        } else {
            const title = await options.requestTitle(
                defaultTitle(images[0].name),
                `${images.length} 张图片将按选择顺序作为同一张曲谱的连续页面`
            );
            if (title !== null) {
                try {
                    progress(`渲染曲谱图片（${images.length} 页）...`);
                    scores.push(
                        await buildRealPageScore(
                            {
                                title,
                                pageCount: images.length,
                                loadPage: async (index) => {
                                    const file = images[index];
                                    const bytes = new Uint8Array(await file.arrayBuffer());
                                    return decodeImage(bytes, file.name);
                                },
                            },
                            usedIds
                        )
                    );
                } catch (e) {
                    errors.push(`图片曲谱：${(e as Error).message}`);
                }
            }
        }
    }

    // ---- PDF：每个文件一张曲谱 ----
    for (const file of pdfs) {
        let opened: OpenedPdf | null = null;
        try {
            progress(`解析 PDF：${file.name}`);
            opened = await openPdf(file);
            const doc = opened.doc;
            const pageCount = doc.numPages;
            if (pageCount <= 0) throw new Error("PDF 中没有页面");
            if (pageCount > MAX_PAGES_PER_SCORE) {
                throw new Error(
                    `共 ${pageCount} 页，超过单张曲谱上限 ${MAX_PAGES_PER_SCORE} 页`
                );
            }

            const title = await options.requestTitle(
                defaultTitle(file.name),
                `PDF 共 ${pageCount} 页；谱架只展示前 4 页，面板保留全部页面`
            );
            if (title === null) continue;

            const pdf = doc;
            progress(`渲染 PDF：${file.name}（${pageCount} 页）...`);
            scores.push(
                await buildRealPageScore(
                    {
                        title,
                        pageCount,
                        loadPage: (index) => renderPdfPage(pdf, index + 1),
                    },
                    usedIds
                )
            );
        } catch (e) {
            errors.push(`${file.name}：${(e as Error).message}`);
        } finally {
            await opened?.close().catch(() => {});
        }
    }

    return { scores, errors };
}

function fileExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** 去掉扩展名作为默认标题，并截断到标题长度上限。 */
function defaultTitle(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    return Array.from(base.trim()).slice(0, MAX_TITLE_CHARS).join("") || "未命名曲谱";
}
