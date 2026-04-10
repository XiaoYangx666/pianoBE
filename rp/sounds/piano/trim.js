const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 设置目标文件夹 (当前目录)
const directoryPath = "./";
const duration = 2; // 裁剪为 2 秒

fs.readdir(directoryPath, (err, files) => {
    if (err) {
        return console.log("无法读取目录: " + err);
    }

    files.forEach((file) => {
        // 只处理 .ogg 文件
        if (path.extname(file) === ".ogg") {
            console.log(`正在处理: ${file}`);

            const tempFile = `temp_${file}`;

            try {
                // 执行 ffmpeg 裁剪命令
                // -i: 输入
                // -t 2: 时长 2 秒
                // -c copy: 不重新编码 (速度最快)
                // -y: 覆盖输出
                execSync(
                    `ffmpeg -i "${file}" -t ${duration} -c copy -y "${tempFile}"`
                );

                // 替换原文件
                fs.unlinkSync(file);
                fs.renameSync(tempFile, file);

                console.log(`成功: ${file} 已裁剪至 ${duration} 秒`);
            } catch (error) {
                console.error(`处理失败 ${file}:`, error.message);
                // 如果失败则清理临时文件
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        }
    });

    console.log("所有音频文件处理完毕！");
});
