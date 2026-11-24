import { renameSync, rmSync, writeFileSync } from "node:fs";

/**
 * 先写同目录临时文件再 rename：
 * 进程中断或磁盘写满时不会留下半个 .mid/.pbe3/JSON，Windows 上 rename 也可覆盖已有文件。
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
    try {
        writeFileSync(tmp, data);
        renameSync(tmp, path);
    } catch (error) {
        try {
            rmSync(tmp, { force: true });
        } catch {
            // 清理失败不掩盖原始错误
        }
        throw error;
    }
}
