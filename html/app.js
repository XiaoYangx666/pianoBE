/**
 * MC MIDI Addon Factory - 修改版 (适配 CRC32 和新脚本格式)
 */

let templateZip = null;
let musicData = [];
let paths = { bp: "bp/", rp: "rp/" };
let manifestData = { bp: null, rp: null };
let templateChangelog = "";

const generateUUID = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

const formatDuration = (seconds) => {
    if (isNaN(seconds)) return "0s";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const toFixed = (num, digits) =>
    typeof num === "number" ? Number(num.toFixed(digits)) : NaN;

const showLoading = (text) => {
    document.getElementById("loadingText").innerText = text;
    document.getElementById("loading").style.display = "flex";
};
const hideLoading = () =>
    (document.getElementById("loading").style.display = "none");

window.openLog = async (tab = "web") => {
    const logModal = document.getElementById("logModal");
    const logBody = document.getElementById("logBody");
    if (!logModal || !logBody) return;

    logModal.classList.add("active");

    // 渲染选项卡头部
    const tabHtml = `
        <div class="flex gap-4 border-b border-gray-100 mb-6">
            <button onclick="renderLogContent('web')" id="tab-web" class="pb-2 px-1 text-xs font-bold transition-all border-b-2">网页更新</button>
            <button onclick="renderLogContent('tpl')" id="tab-tpl" class="pb-2 px-1 text-xs font-bold transition-all border-b-2">底包更新</button>
        </div>
        <div id="logList" class="space-y-6">加载中...</div>
    `;
    logBody.innerHTML = tabHtml;
    renderLogContent(tab);
};

window.renderLogContent = async (type) => {
    const listContainer = document.getElementById("logList");
    if (!listContainer) return;

    // 切换按钮样式
    document.querySelectorAll('[id^="tab-"]').forEach((btn) => {
        btn.classList.remove("border-blue-600", "text-blue-600");
        btn.classList.add("border-transparent", "text-gray-400");
    });

    const activeBtn = document.getElementById("tab-" + type);
    if (activeBtn) {
        activeBtn.classList.add("border-blue-600", "text-blue-600");
        activeBtn.classList.remove("border-transparent", "text-gray-400");
    }

    if (type === "web") {
        try {
            const res = await fetch("./changelog.json?t=" + Date.now());
            if (!res.ok) throw new Error();
            const data = await res.json();
            listContainer.innerHTML = data
                .map(
                    (item) => `
                <div class="border-l-4 border-blue-500 pl-4 py-1">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="font-black text-blue-600">${item.version}</span>
                        <span class="text-[9px] text-gray-400 font-mono tracking-tighter">${item.date}</span>
                    </div>
                    <ul class="list-disc list-inside text-gray-600 leading-relaxed text-[13px]">
                        ${item.content.map((c) => `<li>${c}</li>`).join("")}
                    </ul>
                </div>
            `
                )
                .join("");
        } catch (e) {
            listContainer.innerHTML = `<p class="text-gray-400 italic">未发现网页更新日志。</p>`;
        }
    } else {
        // 显示从包里解析出的日志
        if (templateChangelog) {
            listContainer.innerHTML = `<div class="bg-gray-50 p-4 rounded-xl text-gray-600 whitespace-pre-wrap font-mono text-[12px] leading-relaxed">${templateChangelog}</div>`;
        } else {
            listContainer.innerHTML = `<div class="text-center py-10 text-gray-400 italic">当前底包内未发现 changelog.txt 或未加载底包</div>`;
        }
    }
};

window.closeLog = () => {
    const logModal = document.getElementById("logModal");
    if (logModal) logModal.classList.remove("active");
};

// --- 核心：加载模板 ---
async function loadTemplate(fileOrBlob) {
    showLoading("解析 Addon 模板...");
    try {
        const data = await fileOrBlob.arrayBuffer();
        templateZip = await JSZip.loadAsync(data);

        const files = Object.keys(templateZip.files);
        const bpM = files.find(
            (f) =>
                f.endsWith("manifest.json") &&
                (f.includes("bp") || f.includes("behavior"))
        );
        const rpM = files.find(
            (f) =>
                f.endsWith("manifest.json") &&
                (f.includes("rp") || f.includes("resource"))
        );

        if (!bpM || !rpM) throw new Error("模板不完整");

        paths.bp = bpM.replace("manifest.json", "");
        paths.rp = rpM.replace("manifest.json", "");

        manifestData.bp = JSON.parse(
            await templateZip.file(bpM).async("string")
        );
        manifestData.rp = JSON.parse(
            await templateZip.file(rpM).async("string")
        );

        const logFile = files.find((f) =>
            f.toLowerCase().includes("changelog.txt")
        );
        if (logFile)
            templateChangelog = await templateZip.file(logFile).async("string");

        document.getElementById("addonName").value =
            manifestData.bp.header.name || "";
        document.getElementById("addonDesc").value =
            manifestData.bp.header.description || "";

        const ver = manifestData.bp.header.version;
        document.getElementById("tplVersion").innerText = Array.isArray(ver)
            ? ver.join(".")
            : typeof ver === "string"
              ? ver
              : "Unknown";
        document.getElementById("tplDescDisplay").innerText =
            manifestData.bp.header.description || "无原始描述";

        await parseExistingMidis();
        renderList();
    } catch (e) {
        console.error(e);
        alert("模板加载失败: " + e.message);
    }
    hideLoading();
}

// 解析已有音乐 (适配新格式 export default)
async function parseExistingMidis() {
    const midisDir = `${paths.bp}scripts/midis/`.replace(/\/+/g, "/");
    const indexFile = templateZip.file(midisDir + "index.js");
    if (!indexFile) return;

    try {
        const content = await indexFile.async("string");
        const regex =
            /\{id:("(?:[^"\\]|\\.)*"),name:("(?:[^"\\]|\\.)*"),duration:([\d.]+),value:async\(\)=>\s*\(await\s*import\("\.\/([^"]+)\.js"\)\)\.default\}/g;
        let match;
        const items = [];
        while ((match = regex.exec(content)) !== null) {
            const id = JSON.parse(match[1]);
            const name = JSON.parse(match[2]);
            const duration = parseFloat(match[3]);
            const fileId = match[4];

            const jsFile = templateZip.file(`${midisDir}${fileId}.js`);
            if (jsFile) {
                const jsContent = await jsFile.async("string");
                const tracksMatch = jsContent.match(/tracks:(\[.*\])\};/);
                if (tracksMatch) {
                    // 估算音符数（通过计算 "notes:" 出现的次数或 Float32Array 内容）
                    // 简单方法：统计 new Float32Array 里的数字个数除以 4
                    const noteMatches = jsContent.match(
                        /Float32Array\(\[(.*?)\]\)/g
                    );
                    let noteCount = 0;
                    if (noteMatches) {
                        noteMatches.forEach((m) => {
                            const nums = m.match(/[\d.]+/g);
                            if (nums) noteCount += nums.length / 4;
                        });
                    }

                    items.push({
                        id,
                        name,
                        duration,
                        noteCount: Math.floor(noteCount),
                        tracksCode: tracksMatch[1],
                        isOriginal: true,
                    });
                }
            }
        }
        musicData = items;
    } catch (e) {
        console.warn("解析已有音乐失败", e);
    }
}

// 转换 MIDI (逻辑同步脚本)
async function handleMidiUpload(files) {
    if (!templateZip) return alert("请先等待模板加载完成！");
    showLoading("正在转换 MIDI...");

    let skipCount = 0;
    for (const file of Array.from(files)) {
        try {
            const buffer = await file.arrayBuffer();
            const fileId = (CRC32.buf(new Uint8Array(buffer)) >>> 0).toString(
                16
            );

            // 1. 去重检查
            if (musicData.some((m) => m.id === fileId)) {
                skipCount++;
                continue;
            }

            const midi = new Midi(buffer);
            let totalNotes = 0;

            const tracksCode = midi.tracks
                .map((track) => {
                    totalNotes += track.notes.length; // 2. 统计音符
                    const flat = [];
                    for (const n of track.notes) {
                        flat.push(
                            n.midi,
                            toFixed(n.time, 2),
                            toFixed(n.duration, 1),
                            toFixed(n.velocity, 1)
                        );
                    }
                    return `{instrument:${JSON.stringify(track.instrument)},notes:new Float32Array([${flat.join(",")}])}`;
                })
                .join(",");

            musicData.push({
                id: fileId,
                name: file.name.replace(/\.midi?$/i, ""),
                duration: midi.duration, // 3. 存储原始秒数
                noteCount: totalNotes,
                tracksCode: `[${tracksCode}]`,
                isOriginal: false,
            });
        } catch (e) {
            console.error(e);
        }
    }
    if (skipCount > 0) alert(`${skipCount} 个重复文件已被跳过`);
    renderList();
    hideLoading();
}

// 导出 (逻辑同步脚本)
async function generateAddon() {
    showLoading("导出打包中...");
    try {
        const name =
            document.getElementById("addonName").value || "Piano Addon";
        const desc =
            document.getElementById("addonDesc").value ||
            "Powered by MIDI Factory";
        const random = document.getElementById("randomUuid").checked;

        let bp = JSON.parse(JSON.stringify(manifestData.bp));
        let rp = JSON.parse(JSON.stringify(manifestData.rp));
        bp.header.name = name;
        bp.header.description = desc;
        rp.header.name = name + " (RP)";
        rp.header.description = desc;

        if (random) {
            const oldB = bp.header.uuid,
                oldR = rp.header.uuid;
            const newB = generateUUID(),
                newR = generateUUID();
            bp.header.uuid = newB;
            rp.header.uuid = newR;
            bp.dependencies.forEach((d) => {
                if (d.uuid === oldR) d.uuid = newR;
            });
            rp.dependencies.forEach((d) => {
                if (d.uuid === oldB) d.uuid = newB;
            });
            bp.modules.forEach((m) => (m.uuid = generateUUID()));
            rp.modules.forEach((m) => (m.uuid = generateUUID()));
        }

        templateZip.file(
            `${paths.bp}manifest.json`,
            JSON.stringify(bp, null, 4)
        );
        templateZip.file(
            `${paths.rp}manifest.json`,
            JSON.stringify(rp, null, 4)
        );

        const midisDir = `${paths.bp}scripts/midis/`.replace(/\/+/g, "/");
        // 清理原有 JS
        Object.keys(templateZip.files).forEach((f) => {
            if (f.startsWith(midisDir)) templateZip.remove(f);
        });

        // 生成脚本 (格式: export default)
        let indexContent = "export const midis=[";
        for (const item of musicData) {
            const content = `export default {id:${JSON.stringify(item.id)},name:${JSON.stringify(item.name)},duration:${item.duration},tracks:${item.tracksCode}};`;

            templateZip.file(`${midisDir}${item.id}.js`, content);

            indexContent +=
                `{` +
                `id:${JSON.stringify(item.id)},` +
                `name:${JSON.stringify(item.name)},` +
                `duration:${toFixed(item.duration, 2)},` +
                `value:async()=> (await import("./${item.id}.js")).default` +
                `},`;
        }
        templateZip.file(`${midisDir}index.js`, indexContent + "];");

        const blob = await templateZip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${name.replace(/\s+/g, "_")}.mcaddon`;
        a.click();
    } catch (e) {
        alert("打包失败: " + e.message);
    }
    hideLoading();
}

function renderList() {
    const listDiv = document.getElementById("midiList");
    document.getElementById("count").innerText = musicData.length;
    document.getElementById("generateBtn").disabled = !templateZip;

    if (musicData.length === 0) {
        listDiv.innerHTML = `<div class="py-20 text-center text-gray-300 text-[10px] font-black uppercase italic tracking-widest leading-none">未添加音乐，将生成空包</div>`;
        return;
    }

    listDiv.innerHTML = musicData
        .map(
            (item, i) => `
        <div class="midi-item p-4 flex justify-between items-center group bg-white border-b border-gray-50 transition-all">
            <div class="flex items-center gap-4 min-w-0">
                <div class="w-7 h-7 flex-shrink-0 bg-gray-100 text-gray-400 rounded-lg flex items-center justify-center text-[10px] font-black group-hover:bg-blue-600 group-hover:text-white transition-colors">${i + 1}</div>
                <div class="min-w-0">
                    <div class="text-[13px] font-bold text-gray-700 truncate">${item.name}</div>
                    <div class="text-[9px] text-gray-400 font-mono mt-1 flex flex-wrap items-center gap-2">
                        <span class="bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded font-bold">${item.noteCount || 0} NOTES</span>
                        <!-- 这里修改了时长显示格式 -->
                        <span class="bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">${formatDuration(item.duration)}</span>
                        <span class="text-gray-300 hidden sm:inline">ID: ${item.id}</span>
                        ${item.isOriginal ? '<span class="text-blue-400 font-bold uppercase tracking-tighter">#Templated</span>' : '<span class="text-green-500 font-bold uppercase tracking-tighter">#New</span>'}
                    </div>
                </div>
            </div>
            <button onclick="removeMusic(${i})" class="text-gray-200 hover:text-red-500 p-2 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </div>`
        )
        .join("");
}

// 其余 UI 事件保持不变 ...
window.removeMusic = (index) => {
    musicData.splice(index, 1);
    renderList();
};
document.getElementById("midiInput").onchange = (e) =>
    handleMidiUpload(e.target.files);
document.getElementById("templateInput").onchange = (e) =>
    loadTemplate(e.target.files[0]);
document.getElementById("generateBtn").onclick = generateAddon;
document.getElementById("clearBtn").onclick = () => {
    if (confirm("确定清空当前列表？")) {
        musicData = [];
        renderList();
    }
};

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const res = await fetch("./template.mcaddon?v=" + Date.now());
        if (res.ok) await loadTemplate(await res.blob());
        else document.getElementById("tplVersion").innerText = "未加载默认底包";
    } catch (e) {
        document.getElementById("tplVersion").innerText = "底包加载失败";
    }
});
