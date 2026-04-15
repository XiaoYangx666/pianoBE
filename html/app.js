/**
 * MC MIDI Addon Factory - 核心逻辑 (v2.1)
 */

let templateZip = null;
let musicData = []; // { name, duration, tracksCode, isOriginal }
let paths = { bp: "bp/", rp: "rp/" };
let manifestData = { bp: null, rp: null };

// --- 工具函数 ---
const generateUUID = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

const toFixed = (num, digits) =>
    typeof num === "number" ? Number(num.toFixed(digits)) : NaN;

const showLoading = (text) => {
    document.getElementById("loadingText").innerText = text;
    document.getElementById("loading").style.display = "flex";
};

const hideLoading = () =>
    (document.getElementById("loading").style.display = "none");

// --- 功能函数 ---

// 1. 加载并解析模板
async function loadTemplate(fileOrBlob) {
    showLoading("正在解析 Addon 模板...");
    try {
        const data = await fileOrBlob.arrayBuffer();
        templateZip = await JSZip.loadAsync(data);

        const files = Object.keys(templateZip.files);
        const bpMPath = files.find(
            (f) =>
                f.endsWith("manifest.json") &&
                (f.includes("bp") || f.includes("behavior"))
        );
        const rpMPath = files.find(
            (f) =>
                f.endsWith("manifest.json") &&
                (f.includes("rp") || f.includes("resource"))
        );

        if (!bpMPath || !rpMPath)
            throw new Error("模板内未找到完整的 bp/rp manifest.json");

        paths.bp = bpMPath.replace("manifest.json", "");
        paths.rp = rpMPath.replace("manifest.json", "");

        manifestData.bp = JSON.parse(
            await templateZip.file(bpMPath).async("string")
        );
        manifestData.rp = JSON.parse(
            await templateZip.file(rpMPath).async("string")
        );

        // 更新 UI 上的包信息
        document.getElementById("addonName").value =
            manifestData.bp.header.name || "";
        document.getElementById("addonDesc").value =
            manifestData.bp.header.description || "";

        // 显示底包原始信息
        const version = manifestData.bp.header.version;
        document.getElementById("tplVersion").innerText = Array.isArray(version)
            ? version.join(".")
            : version;
        document.getElementById("tplDescDisplay").innerText =
            manifestData.bp.header.description || "无描述";

        // 解析已有 MIDI
        await parseExistingMidis();
        renderList();
    } catch (err) {
        console.error(err);
        alert("模板加载失败: " + err.message);
    }
    hideLoading();
}

// 2. 解析已有音乐
async function parseExistingMidis() {
    const midisDir = `${paths.bp}scripts/midis/`.replace(/\/+/g, "/");
    const indexFile = templateZip.file(midisDir + "index.js");
    if (!indexFile) return;

    const content = await indexFile.async("string");
    const regex =
        /\{name:("(?:[^"\\]|\\.)*"),duration:([\d.]+),value:async\(\)=>\s*\(await\s*import\("\.\/(\d+)\.js"\)\)\.midi\d+\}/g;

    let match;
    const items = [];
    while ((match = regex.exec(content)) !== null) {
        const name = JSON.parse(match[1]);
        const duration = parseFloat(match[2]);
        const fileId = match[3];

        const jsFile = templateZip.file(`${midisDir}${fileId}.js`);
        if (jsFile) {
            const jsContent = await jsFile.async("string");
            const tracksMatch = jsContent.match(/tracks:(\[.*\])\};/);
            if (tracksMatch) {
                items.push({
                    name,
                    duration,
                    tracksCode: tracksMatch[1],
                    isOriginal: true,
                });
            }
        }
    }
    musicData = items;
}

// 3. 处理 MIDI 上传转换
async function handleMidiUpload(files) {
    if (!templateZip) {
        alert("请先等待模板加载完成！");
        return;
    }
    showLoading("解析 MIDI 中...");
    for (const file of Array.from(files)) {
        try {
            const buffer = await file.arrayBuffer();
            const midi = new Midi(buffer);
            const tracksCode =
                "[" +
                midi.tracks
                    .map((track) => {
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
                    .join(",") +
                "]";

            musicData.push({
                name: file.name.replace(/\.midi?$/i, ""),
                duration: midi.duration,
                tracksCode: tracksCode,
                isOriginal: false,
            });
        } catch (e) {
            console.error("转换出错:", file.name, e);
        }
    }
    renderList();
    hideLoading();
    document.getElementById("midiInput").value = "";
}

// 4. 渲染列表 (显示时长)
function renderList() {
    const listDiv = document.getElementById("midiList");
    const countSpan = document.getElementById("count");
    const genBtn = document.getElementById("generateBtn");

    countSpan.innerText = musicData.length;
    genBtn.disabled = !templateZip || musicData.length === 0;

    if (musicData.length === 0) {
        listDiv.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-gray-300 italic text-[10px] tracking-widest font-black uppercase">
                <p>Wait for MIDI Input</p>
            </div>`;
        return;
    }

    listDiv.innerHTML = musicData
        .map(
            (item, i) => `
        <div class="midi-item p-4 flex justify-between items-center group transition-colors">
            <div class="flex items-center gap-4 min-w-0">
                <div class="w-7 h-7 flex-shrink-0 bg-gray-100 text-gray-400 rounded-lg flex items-center justify-center text-[10px] font-black group-hover:bg-blue-600 group-hover:text-white transition-all">${i + 1}</div>
                <div class="min-w-0">
                    <div class="text-xs font-bold text-gray-700 truncate">${item.name}</div>
                    <div class="text-[9px] text-gray-400 mt-1 flex items-center gap-2">
                        <span class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-500">${Math.floor(item.duration)}s</span>
                        ${item.isOriginal ? '<span class="text-blue-400 font-bold tracking-tighter uppercase">#Template</span>' : '<span class="text-green-500 font-bold tracking-tighter uppercase">#New</span>'}
                    </div>
                </div>
            </div>
            <button onclick="removeMusic(${i})" class="p-2 text-gray-200 hover:text-red-400 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </div>
    `
        )
        .join("");
}

// 5. 生成 Addon
async function generateAddon() {
    showLoading("正在导出 Addon...");
    try {
        const name =
            document.getElementById("addonName").value || "Piano Addon";
        const desc =
            document.getElementById("addonDesc").value || "Generated Addon";
        const random = document.getElementById("randomUuid").checked;

        let bp = JSON.parse(JSON.stringify(manifestData.bp));
        let rp = JSON.parse(JSON.stringify(manifestData.rp));

        bp.header.name = name;
        bp.header.description = desc;
        rp.header.name = name + " RP";
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
        Object.keys(templateZip.files).forEach((f) => {
            if (f.startsWith(midisDir)) templateZip.remove(f);
        });

        let indexContent = "export const midis=[";
        musicData.forEach((item, i) => {
            const id = i + 1;
            templateZip.file(
                `${midisDir}${id}.js`,
                `export const midi${id}={name:${JSON.stringify(item.name)},duration:${item.duration},tracks:${item.tracksCode}};`
            );
            indexContent += `{name:${JSON.stringify(item.name)},duration:${item.duration},value:async()=> (await import("./${id}.js")).midi${id}},`;
        });
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

// 事件绑定
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
    if (confirm("清空列表？")) {
        musicData = [];
        renderList();
    }
};

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const res = await fetch("./template.mcaddon?v=" + Date.now());
        if (res.ok) await loadTemplate(await res.blob());
        else document.getElementById("tplVersion").innerText = "无默认底包";
    } catch (e) {
        document.getElementById("tplVersion").innerText = "加载失败";
    }
});
