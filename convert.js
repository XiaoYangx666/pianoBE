import fs from "fs";
import path from "path";
import pkg from "@tonejs/midi";
const { Midi } = pkg;

const inputDir = path.resolve("./midis");
const outputDir = path.resolve("./src/midis");

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const files = fs.readdirSync(inputDir).filter((f) => /\.midi?$/i.test(f));

const metaList = [];

let index = 1;

for (const file of files) {
    const filePath = path.join(inputDir, file);
    const buffer = fs.readFileSync(filePath);

    const midi = new Midi(buffer);

    const fileId = index++; // 1,2,3...
    const varName = `midi${fileId}`; // midi1, midi2...
    const outFile = `${fileId}.js`; // 1.js, 2.js...

    const data = {
        name: file.replace(/\.midi?$/i, ""),
        duration: midi.duration,
        durationTicks: midi.durationTicks,

        header: {
            name: midi.header.name,
            tempos: midi.header.tempos,
            timeSignatures: midi.header.timeSignatures,
            keySignatures: midi.header.keySignatures,
            ppq: midi.header.ppq,
        },

        tracks: midi.tracks.map((track) => ({
            name: track.name,
            channel: track.channel,
            instrument: track.instrument,
            controlChanges: track.controlChanges,
            pitchBends: track.pitchBends,

            notes: track.notes.map((n) => ({
                midi: n.midi,
                name: n.name,
                time: n.time,
                ticks: n.ticks,
                duration: n.duration,
                durationTicks: n.durationTicks,
                velocity: n.velocity,
            })),
        })),
    };

    // 写入单文件
    const content = `export const ${varName} = ${JSON.stringify(data, null, 2)};\n`;

    fs.writeFileSync(path.join(outputDir, outFile), content, "utf-8");

    metaList.push({
        varName,
        fileId,
        name: data.name,
        duration: data.duration,
    });
}

// ===== 生成 index.js =====
let indexContent = "";

// import
for (const item of metaList) {
    indexContent += `import { ${item.varName} } from "./${item.fileId}.js";\n`;
}

// 导出数组
indexContent += `\nexport const midis = [\n`;

for (const item of metaList) {
    indexContent += `  {\n`;
    indexContent += `    name: "${item.name}",\n`;
    indexContent += `    duration: ${item.duration},\n`;
    indexContent += `    value: ${item.varName}\n`;
    indexContent += `  },\n`;
}

indexContent += `];\n`;

fs.writeFileSync(path.join(outputDir, "index.js"), indexContent, "utf-8");

console.log(`✅ 已转换 ${files.length} 个 MIDI 文件`);
