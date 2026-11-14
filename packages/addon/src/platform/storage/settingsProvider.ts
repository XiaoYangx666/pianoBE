import { normalizePbeSettings, type PbeSettings } from "@domain/settings/pbeSettings";

/**
 * 当前生效的管理员设置缓存。
 *
 * 存储层（钢琴/存储卡容量）每个 tick 都可能读取上限，不能每次都走
 * sapi-pro Configdb 解析；由 `pbeSettingsStore` 在加载/保存时更新这里。
 */
let current: PbeSettings = normalizePbeSettings(undefined);

export function currentPbeSettings(): PbeSettings {
    return current;
}

export function setCurrentPbeSettings(value: unknown): PbeSettings {
    current = normalizePbeSettings(value);
    return current;
}
