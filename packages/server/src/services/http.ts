/**
 * 带超时的 fetch：外部 API / 音频下载卡住时及时失败，
 * 避免转录任务永久停留在「下载中」。
 */
export function fetchWithTimeout(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs = 15_000
): Promise<Response> {
    return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
