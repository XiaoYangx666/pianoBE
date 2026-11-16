import type { ReleaseMode, ScheduleMode, VelocityMode } from "@piano/core/audioLab";

/** Audio Lab 的两套音源：正式 FluidR3 三档 / 实验 VCSL 三层力度。 */
export type LabSampleSet = "fluidr3" | "vcsl";

export interface LabConfig {
    sampleSet: LabSampleSet;
    velocityMode: VelocityMode;
    scheduleMode: ScheduleMode;
    releaseMode: ReleaseMode;
    releaseSeconds: number;
    /** 0 = 三层响度完全对齐；1 = 保留原始层间电平差 */
    layerDynamics: number;
    velocityExponent: number;
    tickSeconds: number;
}

export function defaultConfig(): LabConfig {
    return {
        sampleSet: "vcsl",
        velocityMode: "layers3",
        scheduleMode: "exact",
        releaseMode: "noteoff",
        releaseSeconds: 0.12,
        layerDynamics: 0,
        velocityExponent: 1.6,
        tickSeconds: 0.05,
    };
}

export function configSummary(config: LabConfig): string {
    const source = config.sampleSet === "vcsl" ? "VCSL 施坦威 B" : "FluidR3";
    const velocity =
        config.sampleSet === "fluidr3"
            ? "单层 + 音量"
            : config.velocityMode === "single"
              ? "单层 + 音量"
              : config.velocityMode === "layers2"
                ? "2 层"
                : "3 层";
    return `${source} · ${velocity} · ${config.scheduleMode} · ${config.releaseMode}`;
}

export interface VcslLayerInfo {
    id: string;
    label: string;
    description: string;
}

export interface VcslSampleInfo {
    file: string;
    lufs: number | null;
    peak: number | null;
    /** 相对 vl3 的电平偏移（dB），用于层间响度对齐 */
    levelOffset?: number;
}

export interface VcslKeyInfo {
    sourceNote: string;
    transpose: number;
    baseGain: number;
    layers: Record<string, VcslSampleInfo>;
}

export interface VcslManifest {
    generatedAt: string;
    source: string;
    sourceUrl: string;
    sampleSeconds: number;
    sampleRate: number;
    referenceVelocity: number;
    layers: VcslLayerInfo[];
    keys: Record<string, VcslKeyInfo>;
    totals: { files: number; bytes: number };
}

let manifestPromise: Promise<VcslManifest> | null = null;

export function loadVcslManifest(): Promise<VcslManifest> {
    if (!manifestPromise) {
        manifestPromise = fetch("/lab/vcsl/manifest.json", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) throw new Error(`实验音源清单加载失败 (${response.status})`);
                return (await response.json()) as VcslManifest;
            })
            .catch((error) => {
                manifestPromise = null;
                throw error;
            });
    }
    return manifestPromise;
}

/** VCSL 层索引 → 清单层 id。 */
export const VCSL_LAYER_IDS = ["vl2", "vl3", "vl4"] as const;

export function vcslSampleUrl(layerIndex: number, sampleKey: string, version?: string): string {
    const layer = VCSL_LAYER_IDS[Math.max(0, Math.min(2, layerIndex))];
    const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
    return `/lab/vcsl/${layer}/${sampleKey.replace("#", "sharp")}.ogg${suffix}`;
}

export function vcslSampleInfo(
    manifest: VcslManifest,
    noteKey: string,
    layerIndex: number
): VcslSampleInfo | undefined {
    return manifest.keys[noteKey]?.layers[VCSL_LAYER_IDS[layerIndex]];
}

export function vcslBaseGain(manifest: VcslManifest, noteKey: string): number {
    return manifest.keys[noteKey]?.baseGain ?? 0;
}

/** FluidR3 的文件路径与 core 的 pianoSoundId 一致。 */
export function fluidr3SampleUrl(dir: string, sampleKey: string): string {
    return `/piano/${dir}/${sampleKey.replace("#", "sharp")}.ogg`;
}


