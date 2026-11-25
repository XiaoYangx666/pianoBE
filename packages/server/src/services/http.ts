/**
 * 带超时的 fetch：外部 API / 音频下载卡住时及时失败，
 * 避免转录任务永久停留在「下载中」。
 *
 * 调用方还可以通过 `init.signal` 传入取消信号（例如任务被放弃），
 * 此时内部超时与外部取消任一触发都会终止请求。
 */
export function fetchWithTimeout(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs = 15_000
): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
}
