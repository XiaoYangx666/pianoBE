import type { Vector3 } from "@minecraft/server";
import type { MusicStorageKv } from "@piano/core";

/** 世界/实体/物品动态属性的最小公共结构。 */
export interface DynamicPropertyHolder {
    getDynamicProperty(identifier: string): boolean | number | string | Vector3 | undefined;
    setDynamicProperty(identifier: string, value?: string): void;
    getDynamicPropertyIds(): string[];
    getDynamicPropertyTotalByteCount?(): number;
}

/**
 * 动态属性 → 音乐存储键值。
 *
 * `holder` 用函数传入是为了在实体被替换/重建后重新解析；
 * 失效时返回空视图，绝不写到旧对象上。
 */
export class DynamicPropertyKv implements MusicStorageKv {
    constructor(
        private readonly holder: () => DynamicPropertyHolder | undefined,
        private readonly prefix: string
    ) {}

    keys(): string[] {
        const holder = this.holder();
        if (!holder) return [];
        try {
            return holder.getDynamicPropertyIds().filter(key => key.startsWith(this.prefix));
        } catch {
            return [];
        }
    }

    get(key: string): string | undefined {
        const holder = this.holder();
        if (!holder) return undefined;
        try {
            const value = holder.getDynamicProperty(key);
            return typeof value === "string" ? value : undefined;
        } catch {
            return undefined;
        }
    }

    set(key: string, value: string): void {
        const holder = this.holder();
        if (!holder) throw new Error("存储目标已失效");
        holder.setDynamicProperty(key, value);
    }

    delete(key: string): void {
        const holder = this.holder();
        if (!holder) return;
        try {
            holder.setDynamicProperty(key);
        } catch {
            // 目标失效时删除无意义，交给上层 prune。
        }
    }

    /** 引擎报告的动态属性总字节（含键名与其它命名空间），用于实机自检。 */
    totalBytes(): number | undefined {
        try {
            return this.holder()?.getDynamicPropertyTotalByteCount?.();
        } catch {
            return undefined;
        }
    }
}
