import "./styles.css";
import { loadTemplate, type TemplateInfo } from "./template";
import { generateAddonZip } from "./export";
import { midiFileToEntry } from "./convert";
import type { SongEntry } from "./types";

const TIME_SCALE = 40;

let template: TemplateInfo | null = null;
let songs: SongEntry[] = [];

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

// ---------- 模板 ----------
async function applyTemplate(fileOrBlob: Blob) {
    showLoading("解析 Addon 模板...");
    try {
        template = await loadTemplate(fileOrBlob);
        addonName.value = template.bpManifest.header?.name ?? "";
        addonDesc.value = template.bpManifest.header?.description ?? "";
        const ver = template.bpManifest.header?.version;
        tplVersion.innerText = Array.isArray(ver) ? ver.join(".") : typeof ver === "string" ? ver : "Unknown";
        tplDesc.innerText = template.bpManifest.header?.description ?? "无原始描述";
        songs = template.songs;
        renderList();
    } catch (e) {
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
            if (songs.some((s) => s.id === entry.id)) {
                skip++;
                continue;
            }
            songs.push(entry);
        } catch (e) {
            console.error(e);
        }
    }
    if (skip > 0) alert(`${skip} 个重复文件已被跳过`);
    renderList();
    hideLoading();
}

function renderList() {
    countEl.innerText = String(songs.length);
    generateBtn.disabled = !template;

    if (songs.length === 0) {
        midiList.innerHTML =
            '<div class="empty">未添加音乐，将生成空包</div>';
        return;
    }

    midiList.innerHTML = songs
        .map(
            (item, i) => `
        <div class="item">
            <div class="idx">${i + 1}</div>
            <div class="info">
                <div class="name">${escapeHtml(item.name)}</div>
                <div class="tags">
                    <span class="tag blue">${item.noteCount || 0} NOTES</span>
                    <span class="tag">${formatDuration(item.duration)}</span>
                    <span class="id">${item.id}</span>
                    ${
                        item.isOriginal
                            ? '<span class="tag orig">#Templated</span>'
                            : '<span class="tag new">#New</span>'
                    }
                </div>
            </div>
            <button class="remove" data-idx="${i}" title="移除">✕</button>
        </div>`
        )
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
        alert("打包失败: " + (e as Error).message);
    }
    hideLoading();
}

// ---------- 事件 ----------
midiInput.onchange = (e) => handleMidiUpload((e.target as HTMLInputElement).files);
templateInput.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) applyTemplate(f);
};
generateBtn.onclick = generateAddon;
clearBtn.onclick = () => {
    if (confirm("确定清空当前列表？")) {
        songs = [];
        renderList();
    }
};
midiList.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button.remove");
    if (btn) {
        songs.splice(Number(btn.dataset.idx), 1);
        renderList();
    }
};

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const res = await fetch("./template.mcaddon?v=" + Date.now());
        if (res.ok) await applyTemplate(await res.blob());
        else tplVersion.innerText = "未加载默认底包";
    } catch {
        tplVersion.innerText = "底包加载失败";
    }
});