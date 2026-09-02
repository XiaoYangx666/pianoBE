import "./styles.css";
import { loadTemplate, type TemplateInfo } from "./template";
import { generateAddonZip } from "./export";
import { midiFileToEntry } from "./convert";
import { loadLibraryIndex, loadLibrarySong, libraryMetaToEntry, type LibraryMeta } from "./library";
import { previewPlayer } from "./player";
import type { SongEntry } from "./types";

const TIME_SCALE = 40;

// ---------- 内联 SVG 图标（不用 emoji，避免跨平台渲染差异） ----------
const ICON_PLAY =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 3v10l8-5z" fill="currentColor"/></svg>';
const ICON_STOP =
    '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg>';
const ICON_PLUS =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_CHECK =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X =
    '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MUSIC =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.5 12.5V4L13 2.8v7.7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4.8" cy="12.5" r="1.7" fill="currentColor"/><circle cx="11.2" cy="10.5" r="1.7" fill="currentColor"/></svg>';
const SPINNER = '<span class="mini-spinner"></span>';

let template: TemplateInfo | null = null;
let songs: SongEntry[] = [];
let library: LibraryMeta[] | null = null;
let libFilter = "";

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const loadingText = $<HTMLParagraphElement>("loadingText");
const loading = $<HTMLDivElement>("loading");
const addonName = $<HTMLInputElement>("addonName");
const addonDesc = $<HTMLTextAreaElement>("addonDesc");
const randomUuid = $<HTMLInputElement>("randomUuid");
const tplVersion = $<HTMLSpanElement>("tplVersion");
const tplDesc = $<HTMLSpanElement>("tplDesc");
const generateBtn = $<HTMLButtonElement>("generateBtn");
const midiInput = $<HTMLInputElement>("midiInput");
const templateInput = $<HTMLInputElement>("templateInput");
const midiList = $<HTMLDivElement>("midiList");
const countEl = $<HTMLSpanElement>("count");
const clearBtn = $<HTMLButtonElement>("clearBtn");
const libCount = $<HTMLSpanElement>("libCount");
const libSearch = $<HTMLInputElement>("libSearch");
const libList = $<HTMLDivElement>("libList");
const openLibBtn = $<HTMLButtonElement>("openLibBtn");
const libModal = $<HTMLDivElement>("libModal");
const libClose = $<HTMLButtonElement>("libClose");

const showLoading = (text: string) => {
    loadingText.innerText = text;
    loading.style.display = "flex";
};
const hideLoading = () => (loading.style.display = "none");

const formatDuration = (scaled: number) => {
    const s = Math.floor(scaled / TIME_SCALE);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

// ---------- 预览 ----------
/** 正在加载采样/启动播放的曲目（按钮显示 ⏳，避免全屏遮罩闪烁） */
let pendingPreviewId: string | null = null;

async function togglePreview(entryOrPromise: SongEntry | Promise<SongEntry>) {
    if (!previewPlayer.available) return alert("底包模板未加载，无法预览听歌");
    let entry: SongEntry;
    try {
        entry = await entryOrPromise;
    } catch (e) {
        console.error("[generator] 曲目加载失败：", e);
        return alert("曲目加载失败: " + (e as Error).message);
    }
    if (previewPlayer.playingId === entry.id) {
        previewPlayer.stop();
        return;
    }
    // 不弹全屏遮罩：按钮显示 ⏳，播放引擎已预热采样，基本即时出声
    pendingPreviewId = entry.id;
    renderList();
    renderLibrary();
    try {
        await previewPlayer.play(entry);
    } catch (e) {
        console.error("[generator] 预览失败：", e);
        alert("预览失败: " + (e as Error).message);
    }
    pendingPreviewId = null;
    renderList();
    renderLibrary();
}

// ---------- 模板 ----------
async function applyTemplate(fileOrBlob: Blob) {
    showLoading("解析 Addon 模板...");
    try {
        template = await loadTemplate(fileOrBlob);
        previewPlayer.bindTemplate(template);
        // 后台预热采样（OfflineAudioContext 解码，点试听时零等待、不闪遮罩）
        previewPlayer.warmup().catch(() => {});
        addonName.value = template.bpManifest.header?.name ?? "";
        addonDesc.value = template.bpManifest.header?.description ?? "";
        const ver = template.bpManifest.header?.version;
        tplVersion.innerText = Array.isArray(ver) ? ver.join(".") : typeof ver === "string" ? ver : "Unknown";
        tplDesc.innerText = template.bpManifest.header?.description ?? "无原始描述";
        songs = template.songs;
        renderList();
        renderLibrary();
    } catch (e) {
        console.error("[generator] 模板加载失败：", e);
        previewPlayer.bindTemplate(null);
        alert("模板加载失败: " + (e as Error).message);
    }
    hideLoading();
}

// ---------- 曲目 ----------
async function handleMidiUpload(files: FileList | null) {
    if (!files?.length) return;
    if (!template) return alert("请先等待模板加载完成！");
    showLoading("正在转换 MIDI...");

    let skip = 0;
    for (const file of Array.from(files)) {
        try {
            const entry = await midiFileToEntry(file);
            // 自动去重：已在列表或已在内置曲库的都跳过（曲库的走曲库面板添加）
            const inLibrary = library?.some((m) => m.id === entry.id) ?? false;
            if (songs.some((s) => s.id === entry.id) || inLibrary) {
                skip++;
                continue;
            }
            songs.push(entry);
        } catch (e) {
            console.error(e);
        }
    }
    if (skip > 0) alert(`${skip} 个重复文件已被跳过（已在列表或曲库中）`);
    renderList();
    renderLibrary();
    hideLoading();
}

// ---------- 曲库 ----------
async function addFromLibrary(id: string) {
    if (!library) return;
    if (songs.some((s) => s.id === id)) return;
    const meta = library.find((m) => m.id === id);
    if (!meta) return;
    showLoading("加载曲目...");
    try {
        const song = await loadLibrarySong(meta);
        songs.push(libraryMetaToEntry(meta, song));
    } catch (e) {
        console.error("[generator] 曲库加载失败：", e);
        alert("曲库加载失败: " + (e as Error).message);
    }
    renderList();
    renderLibrary();
    hideLoading();
}

/** 渲染曲库列表（搜索过滤 + 播放/添加按钮状态） */
function renderLibrary() {
    if (!library) {
        libList.innerHTML = '<div class="empty">曲库加载中...</div>';
        return;
    }
    libCount.innerText = String(library.length);
    const kw = libFilter.trim().toLowerCase();
    const items = library.filter(
        (m) => !kw || m.name.toLowerCase().includes(kw) || m.id === kw
    );
    if (items.length === 0) {
        libList.innerHTML = '<div class="empty">没有匹配的曲目</div>';
        return;
    }
    const added = new Set(songs.map((s) => s.id));
    libList.innerHTML = items
        .map((m) => {
            const playing = (pendingPreviewId ?? previewPlayer.playingId) === m.id;
            const inList = added.has(m.id);
            return `<div class="item lib-item">
            <button class="btn-play ${playing ? "on" : ""}" data-play="${m.id}" title="试听">${playing ? (pendingPreviewId === m.id ? SPINNER : ICON_STOP) : ICON_PLAY}</button>
            <div class="info">
                <div class="name">${escapeHtml(m.name)}</div>
                <div class="tags">
                    <span class="tag blue">${m.noteCount.toLocaleString()} NOTES</span>
                    <span class="tag">${formatDuration(m.duration)}</span>
                    <span class="id">${m.id}</span>
                </div>
            </div>
            <button class="btn-add" data-add="${m.id}" ${inList ? "disabled" : ""} title="${inList ? "已在列表中" : "添加到列表"}">${inList ? ICON_CHECK : ICON_PLUS}</button>
        </div>`;
        })
        .join("");
}

// ---------- 主列表 ----------
function renderList() {
    countEl.innerText = String(songs.length);
    generateBtn.disabled = !template;

    if (songs.length === 0) {
        midiList.innerHTML =
            '<div class="empty">未添加音乐，将生成空包</div>';
        return;
    }

    midiList.innerHTML = songs
        .map((item, i) => {
            const playing = (pendingPreviewId ?? previewPlayer.playingId) === item.id;
            return `<div class="item">
            <div class="idx">${i + 1}</div>
            <div class="info">
                <div class="name">${escapeHtml(item.name)}</div>
                <div class="tags">
                    <span class="tag blue">${item.noteCount?.toLocaleString() || 0} NOTES</span>
                    <span class="tag">${formatDuration(item.duration)}</span>
                    <span class="id">${item.id}</span>
                    ${
                        item.isOriginal
                            ? '<span class="tag orig">#Templated</span>'
                            : item.fromLibrary
                              ? '<span class="tag lib">#Library</span>'
                              : '<span class="tag new">#New</span>'
                    }
                </div>
            </div>
            <button class="btn-play ${playing ? "on" : ""}" data-play="main:${i}" ${previewPlayer.available ? "" : "disabled"} title="${previewPlayer.available ? "试听" : "需先加载底包模板"}">${playing ? (pendingPreviewId === item.id ? SPINNER : ICON_STOP) : ICON_PLAY}</button>
            <button class="remove" data-idx="${i}" title="移除">${ICON_X}</button>
        </div>`;
        })
        .join("");
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => {
        const map: Record<string, string> = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        };
        return map[ch];
    });
}

// ---------- 导出 ----------
async function generateAddon() {
    if (!template) return;
    showLoading("导出打包中...");
    try {
        const name = addonName.value.trim() || "Piano Addon";
        const desc = addonDesc.value.trim() || "Powered by PianoBE";
        const blob = await generateAddonZip(template, songs, {
            name,
            desc,
            randomUuid: randomUuid.checked,
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${name.replace(/\s+/g, "_")}.mcaddon`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
        console.error("[generator] 导出失败：", e);
        alert("打包失败: " + (e as Error).message);
    }
    hideLoading();
}

// ---------- 事件 ----------
// 曲库弹窗
openLibBtn.onclick = () => {
    if (!library) loadLibraryIndex().then((idx) => {
        library = idx;
        renderLibrary();
    });
    renderLibrary();
    libModal.hidden = false;
};
libClose.onclick = () => (libModal.hidden = true);
libModal.onclick = (e) => {
    if (e.target === libModal) libModal.hidden = true;
};
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !libModal.hidden) libModal.hidden = true;
});

midiInput.onchange = (e) => handleMidiUpload((e.target as HTMLInputElement).files);
templateInput.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) applyTemplate(f);
};
generateBtn.onclick = generateAddon;
clearBtn.onclick = () => {
    if (confirm("确定清空当前列表？")) {
        songs = [];
        previewPlayer.stop();
        renderList();
        renderLibrary();
    }
};

// 播放状态变化 → 刷新两个列表的 ▶/⏹
previewPlayer.onStateChange = () => {
    renderList();
    renderLibrary();
};

// 主列表：移除 / 试听
midiList.onclick = (e) => {
    const target = e.target as HTMLElement;
    const playBtn = target.closest<HTMLButtonElement>("button.btn-play");
    if (playBtn) {
        const ref = playBtn.dataset.play ?? "";
        const idx = Number(ref.replace("main:", ""));
        const entry = songs[idx];
        if (entry) togglePreview(entry);
        return;
    }
    const btn = target.closest<HTMLButtonElement>("button.remove");
    if (btn) {
        const idx = Number(btn.dataset.idx);
        const removed = songs.splice(idx, 1)[0];
        if (removed && previewPlayer.playingId === removed.id) previewPlayer.stop();
        renderList();
        renderLibrary();
    }
};

// 曲库：试听 / 添加（事件委托，搜索过滤后重渲染不丢绑定）
libList.onclick = (e) => {
    const target = e.target as HTMLElement;
    const playBtn = target.closest<HTMLButtonElement>("button.btn-play");
    if (playBtn) {
        const id = playBtn.dataset.play ?? "";
        const meta = (library ?? []).find((m) => m.id === id);
        if (meta) togglePreview(awaitLibrarySong(meta));
        return;
    }
    const addBtn = target.closest<HTMLButtonElement>("button.btn-add");
    if (addBtn) {
        const id = addBtn.dataset.add ?? "";
        if (id) addFromLibrary(id);
    }
};

// 曲库试听需要异步取二进制：用 Promise 包装避免事件里 await
const awaitingSongs = new Map<string, Promise<ReturnType<typeof libraryMetaToEntry>>>();
function awaitLibrarySong(meta: LibraryMeta) {
    let p = awaitingSongs.get(meta.id);
    if (!p) {
        p = loadLibrarySong(meta).then((song) => libraryMetaToEntry(meta, song));
        p.catch(() => awaitingSongs.delete(meta.id));
        awaitingSongs.set(meta.id, p);
    }
    return p;
}

libSearch.oninput = (e) => {
    libFilter = (e.target as HTMLInputElement).value;
    renderLibrary();
};

window.addEventListener("DOMContentLoaded", async () => {
    // 曲库目录与默认底包并行加载
    loadLibraryIndex().then((idx) => {
        library = idx;
        renderLibrary();
    });
    try {
        const res = await fetch("./template.mcaddon?v=" + Date.now());
        if (res.ok) await applyTemplate(await res.blob());
        else tplVersion.innerText = "未加载默认底包";
    } catch (e) {
        console.error("[generator] 默认底包加载失败：", e);
        tplVersion.innerText = "底包加载失败";
    }
});