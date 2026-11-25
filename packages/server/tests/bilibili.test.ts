import { expect, test } from "bun:test";
import { BiliError, readBodyLimited } from "../src/services/bilibili";

function streamResponse(chunkSize: number, maxChunks: number): Response {
    let sent = 0;
    return new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent >= maxChunks) {
                    controller.close();
                    return;
                }
                sent++;
                controller.enqueue(new Uint8Array(chunkSize).fill(1));
            },
        })
    );
}

test("流式读取在累计字节超限时立即中止，而不是下载完再判断", async () => {
    let pulled = 0;
    const response = new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
                // 读取端应主动取消
                pulled = -1;
            },
        })
    );

    await expect(readBodyLimited(response, 2048)).rejects.toBeInstanceOf(BiliError);
    expect(pulled === -1 || pulled < 10).toBe(true);
});

test("未超限时按块拼回完整内容", async () => {
    const bytes = await readBodyLimited(streamResponse(100, 3), 1000);
    expect(bytes.byteLength).toBe(300);
    expect(bytes.every((value) => value === 1)).toBe(true);
});
