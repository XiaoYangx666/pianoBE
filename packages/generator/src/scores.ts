import { readAddonArchive, type AddonTemplate } from "@bepack/addon";
import { canvasToQuantizedPng } from "./pngQuantize";

export type ScoreSource = "template" | "custom";

/** 生成器内的曲谱条目。 */
export interface ScoreEntry {
    id: string;
    title: string;
    /** DDUI 面板纹理（RP 根相对路径，含 .png）；每张对应一页原始谱面 */
    pages: string[];
    source: ScoreSource;
    /**
     * 原始页数（直接导入图片/PDF 时为源页面数）。
     * 旧曲谱包与模板曲谱不填，UI 回退为 pages.length。
     */
    pageCount?: number;
    /**
     * 自定义曲谱生成的 PNG 资源。
     * key 为 RP 根相对路径，如 textures/ui/piano_score/<id>/page_1.png。
     * 模板曲谱不填，导出时直接从模板读取原字节。
     */
    assets?: Map<string, Uint8Array>;
}

/** addon 内曲谱数据模块（相对 bp 根）。 */
export const SCORE_PACK_SCRIPT_PATH = "scripts/packages/addon/src/data/scorePack.js";

/** 整个 addon 的曲谱上限（模板已有 + 新导入）。 */
export const MAX_SCORES = 16;

/** 曲谱 id 必须满足的格式。 */
export const SCORE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** 曲谱包格式标识与版本。 */
const SCORE_PACK_FORMAT = "pianobe.score-pack";
const SCORE_PACK_VERSION = 1;

/** DDUI 单页预览尺寸：A4 竖版比例，一次只显示一页。 */
const UI_PAGE_WIDTH = 1280;
const UI_PAGE_HEIGHT = 1810;

/** 直接导入的单张曲谱页数上限（图片张数 / PDF 页数）。 */
export const MAX_PAGES_PER_SCORE = 64;

/** 谱架纹理：1024×1024，2×2 四个竖版槽位。 */
const STAND_TEXTURE_SIZE = 1024;
const STAND_SLOT_WIDTH = 352;
const STAND_SLOT_HEIGHT = 456;
const STAND_SLOT_ORIGINS = [
    [0, 0],
    [352, 0],
    [0, 456],
    [352, 456],
] as const;

/** 谱架硬件 UV 条带：坐标与 tools/grand_score.py 的 paint_hardware 一致。 */
const STAND_HARDWARE_TOP = 959;
const STAND_HARDWARE_ROWS = 26;
const STAND_HARDWARE_WIDTH = 26;
const STAND_HARDWARE_BANDS = [
    { x: 0, from: [49, 54, 60], to: [25, 28, 34] },
    { x: 64, from: [60, 64, 69], to: [36, 38, 42] },
] as const;

/** 纸张底色 #FFFBEB（RGB 255,251,235）。 */
const PAPER_COLOR = "#fffbeb";

/** 曲谱标题上限（全角字符）。 */
export const MAX_TITLE_CHARS = 24;

export function scoreUiDir(id: string): string {
    return `textures/ui/piano_score/${id}/`;
}

export function scoreStandPath(id: string): string {
    return `textures/entity/piano_score/${id}.png`;
}

/**
 * 从模板的 scorePack.js 解析 PIANO_SCORES。
 * 该文件是 rolldown 编译产物，可能是 const / export const，数组也可能出现在
 * 末尾的 export 列表里；因此只在标识符后紧跟 "=" 和 "[" 时提取，并做括号配平。
 */
export function parseTemplateScores(addon: AddonTemplate, bpPath: string): ScoreEntry[] {
    const text = addon.readTextSync(`${bpPath}${SCORE_PACK_SCRIPT_PATH}`);
    if (!text) return [];
    try {
        const raw = extractPianoScores(text);
        return raw ? normalizeTemplateScores(raw) : [];
    } catch (e) {
        // 旧模板没有曲谱数据，解析失败不能阻止模板加载。
        console.warn("[generator] 模板曲谱解析失败，按无曲谱处理：", e);
        return [];
    }
}

/** 提取 PIANO_SCORES 数组（返回 JSON.parse 后的值）。 */
function extractPianoScores(source: string): unknown {
    const identifier = /\bPIANO_SCORES\b/g;
    let match: RegExpExecArray | null;
    while ((match = identifier.exec(source)) !== null) {
        let cursor = match.index + match[0].length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== "=") continue;
        cursor++;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== "[") continue;

        const end = matchBracket(source, cursor);
        if (end < 0) return null;
        // 编译产物可能保留尾逗号，JSON.parse 前先去掉。
        const json = source.slice(cursor, end + 1).replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(json);
    }
    return null;
}

/** 从 start 处的 "[" 开始做括号配平，跳过字符串内容。 */
function matchBracket(source: string, start: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === "\\") {
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            depth++;
        } else if (ch === "]") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function normalizeTemplateScores(raw: unknown): ScoreEntry[] {
    if (!Array.isArray(raw)) throw new Error("PIANO_SCORES 不是数组");

    const scores: ScoreEntry[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const title = typeof record.title === "string" ? record.title.trim() : "";
        const pages = Array.isArray(record.pages)
            ? record.pages
                  .filter((page): page is string => typeof page === "string" && page.trim().length > 0)
                  .map((page) => normalizeRelativePath(page.trim()))
            : [];
        const pageCount = typeof record.pageCount === "number" && Number.isInteger(record.pageCount) &&
            record.pageCount > 0 ? record.pageCount : undefined;

        if (!SCORE_ID_PATTERN.test(id)) {
            console.warn(`[generator] 模板曲谱 id 不合法，已跳过：${id || "(空)"}`);
            continue;
        }
        if (!title || pages.length === 0) {
            console.warn(`[generator] 模板曲谱 ${id} 缺少标题或页面，已跳过`);
            continue;
        }
        if (seen.has(id)) {
            console.warn(`[generator] 模板曲谱 id 重复，已跳过：${id}`);
            continue;
        }

        seen.add(id);
        scores.push({ id, title, pages, pageCount, source: "template" });
        if (scores.length >= MAX_SCORES) break;
    }
    return scores;
}

/**
 * 导入一个 .zip 曲谱包。
 * existing 为当前列表（模板曲谱 + 已导入曲谱），用于 id 去重与总数校验。
 * 任何错误都会抛出中文消息，由 UI 统一 alert；本包整体不生效。
 */
export async function importScorePack(
    file: File,
    existing: readonly ScoreEntry[]
): Promise<ScoreEntry[]> {
    let archive;
    try {
        archive = await readAddonArchive(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
        throw new Error(`无法读取曲谱包压缩文件（${(e as Error).message}）`);
    }

    const packEntry = findScorePackJson(archive);
    let manifest: unknown;
    try {
        manifest = JSON.parse(new TextDecoder().decode(packEntry.bytes));
    } catch {
        throw new Error("score-pack.json 不是有效的 JSON");
    }
    if (!manifest || typeof manifest !== "object") {
        throw new Error("score-pack.json 内容不是对象");
    }

    const record = manifest as Record<string, unknown>;
    if (record.format !== SCORE_PACK_FORMAT) {
        throw new Error(`不支持的曲谱包格式：${String(record.format)}（应为 ${SCORE_PACK_FORMAT}）`);
    }
    if (record.version !== SCORE_PACK_VERSION) {
        throw new Error(`不支持的曲谱包版本：${String(record.version)}（当前支持 ${SCORE_PACK_VERSION}）`);
    }
    if (!Array.isArray(record.scores) || record.scores.length === 0) {
        throw new Error("score-pack.json 中没有曲谱");
    }

    if (existing.length + record.scores.length > MAX_SCORES) {
        throw new Error(
            `曲谱总数不能超过 ${MAX_SCORES} 张（当前已有 ${existing.length} 张，本包 ${record.scores.length} 张）`
        );
    }

    const baseDir = packEntry.path.includes("/")
        ? packEntry.path.slice(0, packEntry.path.lastIndexOf("/"))
        : "";
    const files = new Map(archive.map((entry) => [entry.path, entry.bytes]));
    const usedIds = new Set(existing.map((score) => score.id));
    const imported: ScoreEntry[] = [];

    for (let index = 0; index < record.scores.length; index++) {
        const raw = record.scores[index];
        if (!raw || typeof raw !== "object") {
            throw new Error(`第 ${index + 1} 张曲谱不是对象`);
        }
        imported.push(
            await buildScoreEntry(raw as Record<string, unknown>, index, baseDir, files, usedIds)
        );
    }
    return imported;
}

function findScorePackJson(
    archive: readonly { path: string; bytes: Uint8Array }[]
): { path: string; bytes: Uint8Array } {
    const matches = archive.filter(
        (entry) => entry.path === "score-pack.json" || entry.path.endsWith("/score-pack.json")
    );
    if (matches.length === 0) throw new Error("曲谱包缺少 score-pack.json");
    if (matches.length > 1) {
        throw new Error("曲谱包中存在多个 score-pack.json，请只保留一个");
    }
    return matches[0];
}

async function buildScoreEntry(
    raw: Record<string, unknown>,
    index: number,
    baseDir: string,
    files: ReadonlyMap<string, Uint8Array>,
    usedIds: Set<string>
): Promise<ScoreEntry> {
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) throw new Error(`第 ${index + 1} 张曲谱缺少 title`);
    if (Array.from(title).length > MAX_TITLE_CHARS) {
        throw new Error(`曲谱标题过长（最多 ${MAX_TITLE_CHARS} 个字符）：${title}`);
    }

    const pagePaths = readPathList(raw.pages, "pages", title);
    const standPaths =
        raw.standPages === undefined ? pagePaths : readPathList(raw.standPages, "standPages", title);

    const requestedId = typeof raw.id === "string" ? raw.id.trim() : "";
    let id: string;
    if (requestedId) {
        if (!SCORE_ID_PATTERN.test(requestedId)) {
            throw new Error(`曲谱 id 不合法：${requestedId}（需匹配 ${SCORE_ID_PATTERN.source}）`);
        }
        if (usedIds.has(requestedId)) {
            throw new Error(`曲谱 id 冲突：${requestedId} 已存在`);
        }
        id = requestedId;
    } else {
        id = uniqueScoreId(slugifyTitle(title), usedIds);
    }
    usedIds.add(id);

    const assets = new Map<string, Uint8Array>();
    const pages: string[] = [];

    for (let pageIndex = 0; pageIndex < pagePaths.length; pageIndex++) {
        const relative = pagePaths[pageIndex];
        const bytes = readPackImage(files, baseDir, relative, `曲谱《${title}》页面`);
        const bitmap = await decodeImage(bytes, relative);
        try {
            const uiPath = `${scoreUiDir(id)}page_${pageIndex + 1}.png`;
            assets.set(uiPath, await renderUiPage(bitmap));
            pages.push(uiPath);
        } finally {
            bitmap.close();
        }
    }

    // 谱架最多展示前 4 页，多余页面仍保留在 DDUI 面板中。
    const standBitmaps: ImageBitmap[] = [];
    try {
        for (const relative of standPaths.slice(0, STAND_SLOT_ORIGINS.length)) {
            const bytes = readPackImage(files, baseDir, relative, `曲谱《${title}》谱架页面`);
            standBitmaps.push(await decodeImage(bytes, relative));
        }
        assets.set(scoreStandPath(id), await renderStandTexture(standBitmaps));
    } finally {
        for (const bitmap of standBitmaps) bitmap.close();
    }

    return { id, title, pages, source: "custom", assets };
}

/** 直接导入（图片/PDF）的曲谱源：按 0 基下标按需解码页面，避免一次性占用大量内存。 */
export interface RealScoreSource {
    /** 已由用户确认的标题 */
    title: string;
    /** 源页面数（图片张数或 PDF 页数） */
    pageCount: number;
    /** 解码第 index 页；调用方只在 [0, pageCount) 范围内调用 */
    loadPage: (index: number) => Promise<ImageBitmap>;
}

/**
 * 直接导入真实谱面：不做重新排版，只按原样缩放到谱架槽位与面板单页图。
 * - 面板：每页生成一张 1280×1810 竖版预览图
 * - 谱架：1024×1024，只用前 4 页
 * 页面图片由 loadPage 逐页提供，渲染完立即释放，支持较大的 PDF。
 */
export async function buildRealPageScore(
    source: RealScoreSource,
    usedIds: Set<string>
): Promise<ScoreEntry> {
    const title = assertScoreTitle(source.title);
    if (!Number.isInteger(source.pageCount) || source.pageCount <= 0) {
        throw new Error(`曲谱《${title}》没有可导入的页面`);
    }
    if (source.pageCount > MAX_PAGES_PER_SCORE) {
        throw new Error(
            `曲谱《${title}》共 ${source.pageCount} 页，超过单张曲谱上限 ${MAX_PAGES_PER_SCORE} 页`
        );
    }

    const id = uniqueScoreId(slugifyTitle(title), usedIds);
    usedIds.add(id);

    const assets = new Map<string, Uint8Array>();
    const pages: string[] = [];
    /** 谱架只取前 4 页，这些 bitmap 要保留到全部面板页渲染结束后再绘制谱架纹理 */
    const standBitmaps: ImageBitmap[] = [];

    try {
        for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex++) {
            const image = await source.loadPage(pageIndex);
            try {
                const uiPath = `${scoreUiDir(id)}page_${pageIndex + 1}.png`;
                assets.set(uiPath, await renderUiPage(image));
                pages.push(uiPath);
                if (pageIndex < STAND_SLOT_ORIGINS.length) standBitmaps.push(image);
            } finally {
                // 进入谱架的 bitmap 由外层 finally 统一释放
                if (pageIndex >= STAND_SLOT_ORIGINS.length) image.close();
            }
        }
        assets.set(scoreStandPath(id), await renderStandTexture(standBitmaps));
    } finally {
        for (const bitmap of standBitmaps) bitmap.close();
    }

    return {
        id, title, pages, pageCount: source.pageCount, source: "custom", assets,
    };
}

/** 校验并规范化曲谱标题（去首尾空白、长度上限）。 */
export function assertScoreTitle(raw: string): string {
    const title = raw.trim();
    if (!title) throw new Error("曲谱标题不能为空");
    if (Array.from(title).length > MAX_TITLE_CHARS) {
        throw new Error(`曲谱标题过长（最多 ${MAX_TITLE_CHARS} 个字符）：${title}`);
    }
    return title;
}

function readPathList(value: unknown, field: string, title: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`曲谱《${title}》缺少 ${field}`);
    }
    return value.map((item, index) => {
        if (typeof item !== "string" || !item.trim()) {
            throw new Error(`曲谱《${title}》的 ${field} 第 ${index + 1} 项不是有效路径`);
        }
        return normalizeRelativePath(item.trim());
    });
}

function readPackImage(
    files: ReadonlyMap<string, Uint8Array>,
    baseDir: string,
    relative: string,
    label: string
): Uint8Array {
    const path = resolvePackPath(baseDir, relative);
    const bytes = files.get(path);
    if (!bytes) throw new Error(`${label}文件不存在：${relative}`);
    return bytes;
}

function resolvePackPath(baseDir: string, relative: string): string {
    const parts = (baseDir ? baseDir.split("/") : []).concat(relative.split("/"));
    const output: string[] = [];
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (output.length === 0) throw new Error(`页面路径越界：${relative}`);
            output.pop();
            continue;
        }
        output.push(part);
    }
    return output.join("/");
}

function normalizeRelativePath(raw: string): string {
    return raw.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

/** 从标题生成 ASCII slug；中文等非 ASCII 字符会被移除，空结果回退为 score。 */
function slugifyTitle(title: string): string {
    const slug = title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
    return slug || "score";
}

function uniqueScoreId(base: string, used: ReadonlySet<string>): string {
    const normalized = SCORE_ID_PATTERN.test(base) ? base : "score";
    if (!used.has(normalized)) return normalized;
    for (let n = 2; n < 1000; n++) {
        const suffix = `-${n}`;
        const candidate = `${normalized.slice(0, 32 - suffix.length)}${suffix}`;
        if (!used.has(candidate)) return candidate;
    }
    throw new Error("无法生成唯一的曲谱 id");
}

function mimeType(path: string): string {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "bmp") return "image/bmp";
    return "image/png";
}

export async function decodeImage(bytes: Uint8Array, name: string): Promise<ImageBitmap> {
    // 复制成独占 ArrayBuffer，避免 SharedArrayBuffer 类型与 BlobPart 不兼容
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    try {
        return await createImageBitmap(new Blob([copy], { type: mimeType(name) }));
    } catch {
        throw new Error(`无法解码图片：${name}（请使用 PNG/JPEG/WebP 等浏览器支持的格式）`);
    }
}

interface CanvasPair {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): CanvasPair {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持 Canvas，无法处理曲谱图片");
    return { canvas, ctx };
}

function drawContain(
    ctx: CanvasRenderingContext2D,
    image: ImageBitmap,
    x: number,
    y: number,
    width: number,
    height: number
): void {
    drawContainRegion(ctx, image, 0, 0, image.width, image.height, x, y, width, height);
}

function drawContainRegion(
    ctx: CanvasRenderingContext2D,
    image: ImageBitmap,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
    width: number,
    height: number
): void {
    const scale = Math.min(width / sw, height / sh);
    const drawWidth = sw * scale;
    const drawHeight = sh * scale;
    ctx.drawImage(
        image,
        sx, sy, sw, sh,
        x + (width - drawWidth) / 2,
        y + (height - drawHeight) / 2,
        drawWidth,
        drawHeight
    );
}

/**
 * 单页预览：整页按 contain 缩放到 1280×1810 的 A4 竖版画布。
 * 面板每次只显示一页，页数多时用上一页/下一页翻页。
 */
async function renderUiPage(image: ImageBitmap): Promise<Uint8Array> {
    const { canvas, ctx } = createCanvas(UI_PAGE_WIDTH, UI_PAGE_HEIGHT);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, UI_PAGE_WIDTH, UI_PAGE_HEIGHT);
    drawContain(ctx, image, 0, 0, UI_PAGE_WIDTH, UI_PAGE_HEIGHT);
    return canvasToQuantizedPng(canvas, ctx);
}

async function renderStandTexture(images: readonly ImageBitmap[]): Promise<Uint8Array> {
    const { canvas, ctx } = createCanvas(STAND_TEXTURE_SIZE, STAND_TEXTURE_SIZE);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, STAND_TEXTURE_SIZE, STAND_TEXTURE_SIZE);
    paintStandHardware(ctx);
    images.slice(0, STAND_SLOT_ORIGINS.length).forEach((image, index) => {
        const [x, y] = STAND_SLOT_ORIGINS[index];
        drawContain(ctx, image, x, y, STAND_SLOT_WIDTH, STAND_SLOT_HEIGHT);
    });
    return canvasToQuantizedPng(canvas, ctx);
}

/** 绘制谱架木条/挡板的 UV 条带，避免它们采样到纸色。 */
function paintStandHardware(ctx: CanvasRenderingContext2D): void {
    for (const band of STAND_HARDWARE_BANDS) {
        for (let row = 0; row < STAND_HARDWARE_ROWS; row++) {
            const t = row / (STAND_HARDWARE_ROWS - 1);
            const color = band.from.map((from, index) =>
                Math.round(from + (band.to[index] - from) * t)
            );
            ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
            ctx.fillRect(band.x, STAND_HARDWARE_TOP + row, STAND_HARDWARE_WIDTH, 1);
        }
    }
}

/** 生成 scorePack.js：只导出常量，不含函数。 */
export function serializeScorePackModule(
    scores: readonly ScoreEntry[],
    resourcePackId: string
): string {
    const data = scores.map(({ id, title, pageCount, pages }) => ({
        id,
        title,
        ...(pageCount !== undefined ? { pageCount } : {}),
        pages,
    }));
    return (
        `export const SCORE_RESOURCE_PACK_ID = ${JSON.stringify(resourcePackId)};\n` +
        `export const PIANO_SCORES = ${JSON.stringify(data, null, 4)};\n`
    );
}
