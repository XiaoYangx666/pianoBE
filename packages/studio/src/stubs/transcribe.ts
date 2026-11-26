export type TranscribeStage = "decode" | "model" | "cqt" | "infer" | "notes" | "done";

export interface TranscribeProgress {
    stage: TranscribeStage;
    message: string;
    percent: number;
}

export interface TranscribeOutput {
    midi: Uint8Array;
    duration: number;
    notes: Array<{ pitch: number; start: number; end: number; velocity: number }>;
}

export class AssetsNotReadyError extends Error {}

export interface AssetDownloadProgress {
    file: string;
    loaded: number;
    total: number;
    percent: number;
    message: string;
}

export async function isModelDownloaded(): Promise<boolean> {
    return false;
}

export async function downloadModelAssets(): Promise<void> {
    throw new Error("服务器管理版不包含浏览器端转录模型");
}

export async function clearModelAssets(): Promise<void> {}

export function releaseAmtSession(): void {}

export function scheduleAmtSessionDispose(): void {}

export function cancelAmtSessionDispose(): void {}

export async function transcribeAudio(): Promise<TranscribeOutput> {
    throw new Error("服务器管理版不包含浏览器端转录功能");
}
