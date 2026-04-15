import fs from "fs";
import path from "path";
import pkg from "@tonejs/midi";
const { Midi } = pkg;

// ===== 1. 读取命令行参数 =====
const inputDir = path.resolve(process.argv[2] || "./midis/files");
const outputDir = path.resolve(process.argv[3] || "./midis/js");

function toFixed(num, digits) {
    if (typeof num !== "number") return NaN;
    return Number(num.toFixed(digits));
}

fs.rmSync(outputDir, { recursive: true });
// ===== 2. 创建输出目录 =====
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const files = fs.readdirSync(inputDir).filter((f) => /\.midi?$/i.test(f));

const metaList = [];
let index = 1;

// ===== 3. 主转换逻辑 =====
for (const file of files) {
    const filePath = path.join(inputDir, file);
    const buffer = fs.readFileSync(filePath);

    const midi = new Midi(buffer);

    const fileId = index++;
    const varName = `midi${fileId}`;
    const outFile = `${fileId}.js`;

    const tracksCode = midi.tracks
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
        .join(",");

    const content =
        `export const ${varName}={` +
        `name:${JSON.stringify(file.replace(/\.midi?$/i, ""))},` +
        `duration:${midi.duration},` +
        `tracks:[${tracksCode}]` +
        `};`;

    fs.writeFileSync(path.join(outputDir, outFile), content, "utf-8");

    metaList.push({
        varName,
        fileId,
        name: file.replace(/\.midi?$/i, ""),
        duration: midi.duration,
    });
}

// ===== 4. 生成 index.js =====
let indexContent = "export const midis=[";

for (const item of metaList) {
    indexContent += `{name:${JSON.stringify(item.name)},duration:${item.duration},value:async()=> (await import("./${item.fileId}.js")).${item.varName}},`;
}

indexContent += "];";

fs.writeFileSync(path.join(outputDir, "index.js"), indexContent, "utf-8");

// ===== 5. 输出日志 =====
console.log(`✅ 已转换 ${files.length} 个 MIDI 文件`);
console.log(`📥 输入目录: ${inputDir}`);
console.log(`📤 输出目录: ${outputDir}`);
