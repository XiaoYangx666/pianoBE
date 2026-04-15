const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 设置目标文件夹 (当前目录)
const source = "./piano_source";
const outDir = "./piano_long";
const duration = 4;
const fadeDuration = 1;
const fadeStart = duration - fadeDuration;

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
}

fs.readdir(source, (err, files) => {
    if (err) {
        return console.log("无法读取目录: " + err);
    }

    files.forEach((file) => {
        // 只处理 .ogg 文件
        if (path.extname(file) === ".ogg") {
            console.log(`正在处理: ${file}`);

            const outFile = path.join(outDir, file);

            try {
                execSync(
                    `ffmpeg -loglevel error -i "${path.join(source, file)}" -t ${duration} -af "afade=t=out:st=${fadeStart}:d=${fadeDuration}" -y "${outFile}"`
                );

                console.log(`成功: ${file} 已裁剪至 ${duration} 秒`);
            } catch (error) {
                console.error(`处理失败 ${file}:`, error.message);
                // 如果失败则清理临时文件
                if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
            }
        }
    });

    console.log("所有音频文件处理完毕！");
});
