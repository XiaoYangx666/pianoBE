import type { PDFDocumentProxy } from "pdfjs-dist";

/** PDF 页面渲染倍率上限（2x 保证谱面文字清晰）。 */
const MAX_RENDER_SCALE = 2;
/** 页面过大时的兜底下限，避免缩放后模糊到不可读。 */
const MIN_RENDER_SCALE = 0.5;
/** 单页渲染的最大像素数；超过时自动降低倍率，防止超大 PDF 页面耗尽内存。 */
const MAX_RENDER_PIXELS = 12_000_000;

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * 按需加载 pdf.js 与其 worker（Vite 会把 worker 打包成独立资源）。
 * 只在真正导入 PDF 时才下载，不影响生成器首屏体积。
 */
function loadPdfjs(): Promise<PdfjsModule> {
    pdfjsPromise ??= (async () => {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
    })();
    return pdfjsPromise;
}

/** 已打开的 PDF 文档；close() 释放 worker 与文档缓存。 */
export interface OpenedPdf {
    doc: PDFDocumentProxy;
    close: () => Promise<void>;
}

/** 在浏览器内解析 PDF 文件（不会上传到服务器）。 */
export async function openPdf(file: File): Promise<OpenedPdf> {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data });
    try {
        const doc = await task.promise;
        return { doc, close: () => task.destroy() };
    } catch (e) {
        await task.destroy().catch(() => {});
        throw new Error(`无法解析 PDF（${(e as Error).message}）`);
    }
}

/**
 * 把 PDF 的第 pageNumber 页（1 基）渲染成 ImageBitmap。
 * 页面透明背景先铺白纸，避免转成 PNG 后谱面变透明。
 */
export async function renderPdfPage(
    doc: PDFDocumentProxy,
    pageNumber: number
): Promise<ImageBitmap> {
    const page = await doc.getPage(pageNumber);
    try {
        const base = page.getViewport({ scale: 1 });
        const pixels = Math.max(1, base.width * base.height);
        const scale = Math.min(
            MAX_RENDER_SCALE,
            Math.max(MIN_RENDER_SCALE, Math.sqrt(MAX_RENDER_PIXELS / pixels))
        );
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("当前浏览器不支持 Canvas，无法渲染 PDF 页面");

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport }).promise;

        const bitmap = await createImageBitmap(canvas);
        // createImageBitmap 已复制像素，尽早释放 canvas 占用的内存
        canvas.width = 0;
        canvas.height = 0;
        return bitmap;
    } finally {
        page.cleanup();
    }
}
