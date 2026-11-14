import {
    DEFAULT_MUSIC_STORAGE_BYTES,
    MUSIC_STORAGE_MAX_BYTES,
    MUSIC_STORAGE_MIN_BYTES,
    normalizeStorageLimit,
} from "@piano/core";

/** 全局管理员设置（世界级，不区分玩家）。 */
export interface PbeSettings {
    /** 是否允许普通玩家创建/提交 MIDI 导入任务；管理员不受限制 */
    allowPlayerImport: boolean;
    /** 每架钢琴内置音乐存储容量（字节） */
    pianoStorageBytes: number;
    /** 每张音乐存储卡容量（字节） */
    cardStorageBytes: number;
}

export const DEFAULT_PBE_SETTINGS: PbeSettings = {
    allowPlayerImport: false,
    pianoStorageBytes: DEFAULT_MUSIC_STORAGE_BYTES,
    cardStorageBytes: DEFAULT_MUSIC_STORAGE_BYTES,
};

export const PBE_STORAGE_LIMITS = {
    min: MUSIC_STORAGE_MIN_BYTES,
    max: MUSIC_STORAGE_MAX_BYTES,
} as const;

/** 容错解析世界动态属性中的配置对象。 */
export function normalizePbeSettings(value: unknown): PbeSettings {
    if (!value || typeof value !== "object") return { ...DEFAULT_PBE_SETTINGS };
    const raw = value as Record<string, unknown>;
    return {
        allowPlayerImport:
            typeof raw.allowPlayerImport === "boolean"
                ? raw.allowPlayerImport
                : DEFAULT_PBE_SETTINGS.allowPlayerImport,
        pianoStorageBytes: normalizeStorageLimit(raw.pianoStorageBytes, DEFAULT_PBE_SETTINGS.pianoStorageBytes),
        cardStorageBytes: normalizeStorageLimit(raw.cardStorageBytes, DEFAULT_PBE_SETTINGS.cardStorageBytes),
    };
}
