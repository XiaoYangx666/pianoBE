/**
 * 区块在运行时卸载后，脚本 API 访问其中的位置会抛 `LocationInUnloadedChunkError`。
 * 这类错误是正常的世界状态变化，调用方应按“未加载”处理，而不是当作运行时故障。
 */
export function isUnloadedChunkError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const { name, message } = error as { name?: unknown; message?: unknown };
    if (name === "LocationInUnloadedChunkError") return true;
    // 少数情况下引擎只保留 message，不保留 name。
    return typeof message === "string" && message.includes("not in a chunk currently loaded");
}
