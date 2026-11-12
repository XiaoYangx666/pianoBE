/** 全局管理员设置（世界级，不区分玩家）。 */
export interface PbeSettings {
    /** 是否允许普通玩家创建/提交 MIDI 导入任务；管理员不受限制 */
    allowPlayerImport: boolean;
}

export const DEFAULT_PBE_SETTINGS: PbeSettings = {
    allowPlayerImport: false,
};

/** 容错解析世界动态属性中的配置对象。 */
export function normalizePbeSettings(value: unknown): PbeSettings {
    if (!value || typeof value !== "object") return { ...DEFAULT_PBE_SETTINGS };
    const raw = value as Record<string, unknown>;
    return {
        allowPlayerImport:
            typeof raw.allowPlayerImport === "boolean"
                ? raw.allowPlayerImport
                : DEFAULT_PBE_SETTINGS.allowPlayerImport,
    };
}
