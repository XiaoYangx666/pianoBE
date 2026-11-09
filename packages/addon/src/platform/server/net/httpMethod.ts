import type { HttpRequestMethod as OfficialHttpRequestMethod } from "@minecraft/server-net";

/**
 * HttpRequestMethod 本地枚举（与 @minecraft/server-net 1.26.44 同形：
 * 帕斯卡命名、字符串值 'Get'/'Post'/...）。
 *
 * 官方模块是纯类型包（npm 上只有 .d.ts、没有运行时代码），bun 测试/工具链
 * 无法对其做值导入，故本地声明同形枚举，**全链路统一使用**：类型直接别名到
 * 官方类型（type-only，编译期擦除，bun 无感），值用本地字面量
 * （与官方成员值一致）。原生层按值校验枚举成员，直接赋值即可，无需二次归一化。
 */
export type HttpRequestMethod = OfficialHttpRequestMethod;

export const HttpRequestMethod = {
    Delete: "Delete" as OfficialHttpRequestMethod,
    Get: "Get" as OfficialHttpRequestMethod,
    Head: "Head" as OfficialHttpRequestMethod,
    Patch: "Patch" as OfficialHttpRequestMethod,
    Post: "Post" as OfficialHttpRequestMethod,
    Put: "Put" as OfficialHttpRequestMethod,
};